'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { actionLinks, detachAllLinks, parseActionLink } from '@/lib/action-links';
import { MOVE_KINDS, actionDateErrors, followUpLinkMode, followUpProblem, transitionKind } from '@/lib/action-rules';
import { fmtDate } from '@/lib/dates';
import {
  ACTION_AVANCEMENTS, ACTION_SOURCES, ACTION_TEXT_MAX, FOLLOW_REASONS, SOURCE_LINK_KINDS, VERIFY_METHODS, VERIFY_METHOD_KEYS,
  type FollowReason,
} from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite } from '@/lib/guard';
import type { ActionInsert, ActionRow } from '@/lib/queries';
import { today } from '@/lib/today';
import { HOURS_MAX, createActionRecord, fmtActionField, nameBook, newSiteProblem, pilotProblem, readNewActionFields } from './action-create';
import { StaleActionError, insertComment, writeAvancement } from './action-core';
import { logChange, type ChangeDetail } from './changelog';

// Cycle de vie d'une action (docs/specs/actions-qse.md § 6, § 7) : toutes les transitions sont faites par le service QHSE
// (requireApprover) ; le responsable n'en fait aucune (D2). Chaque server action reçoit l'avancement que la fiche
// affichait (`from`) : s'il a changé entre-temps, la demande est refusée et la fiche actualisée. Ordre des contrôles :
// droits → validation → chargement → requireInSite → une transaction (writeAvancement : journal « status » structuré, D11).
//   - moveAction : paliers libres, Reportée, reprise, Terminée (date effective), retour depuis Terminée (MOVE_KINDS) ;
//   - verifyAction : Terminée → Vérifiée, actions de suite dans la même transaction (non efficace, nouveau risque, D21) ;
//   - reopenAction : Vérifiée → Terminée, motif obligatoire, champs de vérification effacés (gardés au journal) ;
//   - abandonAction (remplace cancelAction) : motif obligatoire, liens détachables détachés (DUE-04), état définitif.

const STALE = "L'action a changé entre-temps : la fiche est actualisée.";
const NOT_ALLOWED = "Changement d'avancement non permis.";
const RESULTS = ['efficace', 'non_efficace'] as const;

/** Charge l'action et contrôle l'avancement affiché et le site ; renvoie l'action ou un état d'erreur. */
async function loadForTransition(db: DbOrTx, id: string, from: string): Promise<{ row: ActionRow } | { state: FormState }> {
  const [row] = await db.select().from(t.actions).where(eq(t.actions.id, id));
  if (!row) return { state: { error: 'Action introuvable.' } };
  // Site d'abord : l'avancement d'une action hors du site sélectionné ou du périmètre n'est jamais révélé.
  const blocked = await requireInSite(row.siteId);
  if (blocked) return { state: { error: blocked } };
  if (row.status !== from) {
    revalidatePath('/', 'layout');
    return { state: { error: STALE } };
  }
  return { row };
}

/** Exécute la transaction d'une transition ; une action changée entre-temps (StaleActionError) donne le refus « actualisée ». */
async function runTransition<T>(db: DbOrTx, fn: (tx: DbOrTx) => Promise<T>): Promise<{ ok: T } | { state: FormState }> {
  try {
    return { ok: await db.transaction(fn) };
  } catch (e) {
    if (!(e instanceof StaleActionError)) throw e;
    revalidatePath('/', 'layout');
    return { state: { error: STALE } };
  }
}

const dateDetail = (field: string, from: string | null | undefined, to: string | null | undefined): ChangeDetail[] =>
  (from ?? null) === (to ?? null) ? [] : [{ field, from: from ? fmtDate(from) : null, to: to ? fmtDate(to) : null }];

/** Change l'avancement (transitions de MOVE_KINDS : step, report, resume, finish, unfinish), QHSE seulement (ACT-21). */
export async function moveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', ACTION_AVANCEMENTS, { required: true });
  const to = f.oneOf('to', ACTION_AVANCEMENTS, { required: true });
  const doneField = f.date('doneOn');
  const verifyField = f.date('verifyDueOn');
  const dueField = f.date('dueOn');
  const comment = f.str('comment', { max: ACTION_TEXT_MAX });
  if (!f.ok) return f.state();
  const kind = transitionKind(from!, to!);
  if (!kind || !MOVE_KINDS.includes(kind)) return { error: NOT_ALLOWED, fieldErrors: { to: NOT_ALLOWED } };

  const db = await getDb();
  const loaded = await loadForTransition(db, id, from!);
  if ('state' in loaded) return loaded.state;
  const a = loaded.row;

  const now = today();
  const patch: Partial<ActionInsert> = {};
  const details: ChangeDetail[] = [];
  let warnings: string[] = [];
  if (kind === 'finish') {
    // Date effective obligatoire (par défaut aujourd'hui), entre la date d'ouverture et aujourd'hui ; vérification
    // planifiée obligatoire quand l'action n'en a pas.
    const doneOn = doneField ?? now;
    const verifyDueOn = verifyField ?? a.verifyDueOn;
    const dates = actionDateErrors({ openedOn: a.openedOn, dueOn: a.dueOn, verifyDueOn, doneOn }, now, { doneOn: true, verifyDueOn: verifyDueOn !== a.verifyDueOn });
    Object.entries(dates.fieldErrors).forEach(([k, msg]) => f.fail(k, msg));
    if (!verifyDueOn) f.fail('verifyDueOn', 'Date obligatoire : planifiez la vérification.');
    if (!f.ok) return f.state();
    warnings = dates.warnings;
    Object.assign(patch, { doneOn, verifyDueOn });
    details.push(...dateDetail('Date effective', a.doneOn, doneOn), ...dateDetail('Vérification planifiée', a.verifyDueOn, verifyDueOn));
  } else if (kind === 'unfinish') {
    patch.doneOn = null;
    details.push(...dateDetail('Date effective', a.doneOn, null));
  } else if (kind === 'resume' && dueField && dueField !== a.dueOn) {
    const dates = actionDateErrors({ openedOn: a.openedOn, dueOn: dueField, verifyDueOn: a.verifyDueOn }, now, { dueOn: true });
    Object.entries(dates.fieldErrors).forEach(([k, msg]) => f.fail(k, msg));
    if (!f.ok) return f.state();
    warnings = dates.warnings;
    patch.dueOn = dueField;
    details.push(...dateDetail('Date cible', a.dueOn, dueField));
  }

  const done = await runTransition(db, async (tx) => {
    await writeAvancement(tx, a, to!, { byId: session.user.id, reason: comment || null, patch, details });
    // Commentaire facultatif (report, …) : ajouté au fil, daté et signé (ACT-24).
    if (comment) await insertComment(tx, { actionId: a.id, authorId: session.user.id, authorRole: session.role, body: comment });
  });
  if ('state' in done) return done.state;
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id, ...(warnings.length ? { warnings } : {}) };
}

/** Lien de l'action vérifiée repris par ses actions de suite (D21). */
type Carried = { link: string; label: string; siteId: string | null; move: boolean };

/**
 * Liens de l'action vérifiée repris par ses actions de suite (D21, followUpLinkMode) : l'élément de la source (événement :
 * rattaché aussi ; constat ou élément du programme : déplacé, le constat avant l'élément ; un élément qui ne correspond pas
 * à la source — ligne reprise, D22 — n'est pas repris), les liens à plusieurs actions (risque, revue, document, filière,
 * enlèvement : rattachés aussi) et les liens à action unique (exigence, contrôle, version, décision : déplacés vers la
 * première suite). Habilitation, plan de prévention, permis : jamais repris.
 */
async function carriedLinks(db: DbOrTx, a: ActionRow): Promise<Carried[]> {
  const sourceKinds = a.source ? SOURCE_LINK_KINDS[ACTION_SOURCES[a.source].target] : [];
  const links = await actionLinks(db, a.id);
  const out: Carried[] = [];
  const siteOf = async (link: string) => {
    const parsed = parseActionLink(link);
    return (parsed && (await parsed.def.siteOf?.(db, parsed.args))) ?? null;
  };
  const sourceAudit = ['finding', 'plan'].map((k) => links.find((l) => l.kind === k && sourceKinds.includes(k))).find(Boolean);
  for (const l of links) {
    const mode = followUpLinkMode(l.kind);
    if (mode === 'none') continue;
    if (mode === 'source') {
      if (!sourceKinds.includes(l.kind)) continue;
      if (l.kind !== 'event' && l !== sourceAudit) continue;
    }
    const move = mode === 'single' || (mode === 'source' && l.kind !== 'event');
    out.push({ link: l.link, label: l.label, siteId: await siteOf(l.link), move });
  }
  return out;
}

/** Vérification d'efficacité d'une action Terminée, actions de suite comprises (ACT-23). */
export async function verifyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', ACTION_AVANCEMENTS, { required: true });
  const closedField = f.date('closedOn');
  const verifyMethod = f.oneOf('verifyMethod', VERIFY_METHOD_KEYS, { required: true });
  const efficacyNote = f.str('efficacyNote', { required: true, max: ACTION_TEXT_MAX });
  const result = f.oneOf('effective', RESULTS, { required: true });
  const newRisk = f.bool('newRisk');
  const hoursField = f.decimal('hours', { min: 0, max: HOURS_MAX });
  // Sections « Nouvelle action » : source, élément lié et référence d'origine repris de l'action vérifiée, jamais lus.
  const sections: { reason: FollowReason; prefix: 'ne_' | 'nr_'; v: ReturnType<typeof readNewActionFields> }[] = [];
  if (result === 'non_efficace') sections.push({ reason: 'non_efficace', prefix: 'ne_', v: readNewActionFields(f, 'ne_', { problemRequired: false }) });
  if (newRisk) sections.push({ reason: 'nouveau_risque', prefix: 'nr_', v: readNewActionFields(f, 'nr_') });
  if (!f.ok) return f.state();
  if (transitionKind(from!, 'verifiee') !== 'verify') return { error: NOT_ALLOWED };

  const db = await getDb();
  const loaded = await loadForTransition(db, id, from!);
  if ('state' in loaded) return loaded.state;
  const a = loaded.row;

  const now = today();
  // Pointage : champ absent de la demande → valeur actuelle gardée (jamais effacée sans être saisie) ; vide → effacé.
  const hours = fd.has('hours') ? hoursField : a.hours;
  const closedOn = closedField ?? now;
  const dates = actionDateErrors({ openedOn: a.openedOn, doneOn: a.doneOn, closedOn }, now, { closedOn: true });
  Object.entries(dates.fieldErrors).forEach(([k, msg]) => f.fail(k, msg));
  const warnings: string[] = [];
  for (const s of sections) {
    const d = actionDateErrors({ openedOn: now, dueOn: s.v.dueOn, verifyDueOn: s.v.verifyDueOn }, now, { dueOn: true, verifyDueOn: true });
    Object.entries(d.fieldErrors).forEach(([k, msg]) => f.fail(`${s.prefix}${k}`, msg));
    warnings.push(...d.warnings.map((w) => `${FOLLOW_REASONS[s.reason]} : ${w}`));
  }
  if (!f.ok) return f.state();

  // Contrôles des suites avant la transaction : responsable présent, site actif du périmètre, site des éléments repris.
  const carried = sections.length ? await carriedLinks(db, a) : [];
  for (const [i, s] of sections.entries()) {
    const pilot = await pilotProblem(db, s.v.pilotId, now);
    if (pilot) return { error: 'Certains champs sont à corriger.', fieldErrors: { [`${s.prefix}pilotId`]: pilot } };
    const siteError = await newSiteProblem(s.v.siteId);
    if (siteError) return { error: siteError, fieldErrors: { [`${s.prefix}siteId`]: siteError } };
    // Liens que cette suite recevra (les liens déplacés vont à la première seulement, comme dans la transaction).
    const off = carried.find((c) => (!c.move || i === 0) && c.siteId && c.siteId !== s.v.siteId);
    if (off) {
      return { error: `L'action de suite doit concerner le site de l'élément lié (${off.label}) : choisissez ce site.`, fieldErrors: { [`${s.prefix}siteId`]: 'Site différent de celui de l’élément lié.' } };
    }
  }

  const effective = result === 'efficace';
  const done = await runTransition(db, async (tx) => {
    const names = await nameBook(tx);
    await writeAvancement(tx, a, 'verifiee', {
      byId: session.user.id,
      patch: { closedOn, verifyMethod: verifyMethod!, efficacyNote, effective, newRisk, verifiedById: session.user.id, hours },
      details: [
        ...dateDetail('Date de vérification', a.closedOn, closedOn),
        { field: 'Nature de la vérification', from: null, to: VERIFY_METHODS[verifyMethod!] },
        { field: 'Résultat', from: null, to: effective ? 'Efficace' : 'Non efficace' },
        ...(newRisk ? [{ field: 'Nouveau risque généré', from: null, to: 'Oui' }] : []),
        ...((a.hours ?? null) !== (hours ?? null) ? [{ field: 'Pointage', from: fmtActionField('hours', a.hours, names), to: fmtActionField('hours', hours, names) }] : []),
      ],
    });
    const ids: string[] = [];
    for (const [i, s] of sections.entries()) {
      // Première suite (non efficace d'abord) : reçoit aussi les liens déplacés (D21).
      const links = carried.filter((c) => !c.move || i === 0);
      const problem = s.v.problem || followUpProblem(a.id, closedOn, efficacyNote);
      const { id: newId, links: applied } = await createActionRecord(tx, {
        source: a.source, originRef: a.originRef, pilotId: s.v.pilotId, priority: s.v.priority!, dueOn: s.v.dueOn!, domain: s.v.domain!, problem,
        detail: s.v.detail, verifyDueOn: s.v.verifyDueOn!, riskLevel: s.v.riskLevel, siteId: s.v.siteId,
        followsActionId: a.id, followReason: s.reason, links: links.map((c) => c.link),
      }, { byId: session.user.id, byName: session.user.name, today: now, summary: `Action de suite de ${a.id} créée (${FOLLOW_REASONS[s.reason].toLowerCase()})` });
      ids.push(newId);
      for (const c of links.filter((x) => x.move && applied.includes(x.link))) {
        await logChange(tx, { entityType: 'action', entityId: a.id, action: 'unlink', byId: session.user.id, summary: `${c.label} repris par l'action de suite ${newId}` });
      }
      await logChange(tx, {
        entityType: 'action', entityId: a.id, action: 'follow_up', byId: session.user.id,
        summary: `Action de suite ${newId} créée (${FOLLOW_REASONS[s.reason].toLowerCase()})`,
      });
    }
    return ids;
  });
  if ('state' in done) return done.state;
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id, ...(done.ok.length ? { ids: done.ok } : {}), ...(warnings.length ? { warnings } : {}) };
}

/** Rouvre une action Vérifiée (retour à Terminée — à vérifier, motif obligatoire). */
export async function reopenAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', ACTION_AVANCEMENTS, { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  if (transitionKind(from!, 'terminee') !== 'reopen') return { error: NOT_ALLOWED };

  const db = await getDb();
  const loaded = await loadForTransition(db, id, from!);
  if ('state' in loaded) return loaded.state;
  const a = loaded.row;

  const done = await runTransition(db, async (tx) => {
    const names = await nameBook(tx);
    // Champs de la vérification effacés, anciennes valeurs au journal ; actions de suite et liens déplacés restent en place.
    await writeAvancement(tx, a, 'terminee', {
      byId: session.user.id, reason,
      patch: { closedOn: null, verifyMethod: null, efficacyNote: null, effective: null, newRisk: false, verifiedById: null },
      details: [
        ...dateDetail('Date de vérification', a.closedOn, null),
        ...(a.verifyMethod ? [{ field: 'Nature de la vérification', from: VERIFY_METHODS[a.verifyMethod] ?? a.verifyMethod, to: null }] : []),
        ...(a.efficacyNote ? [{ field: 'Constat de vérification', from: '(texte précédent)', to: null }] : []),
        ...(a.effective != null ? [{ field: 'Résultat', from: a.effective ? 'Efficace' : 'Non efficace', to: null }] : []),
        ...(a.newRisk ? [{ field: 'Nouveau risque généré', from: 'Oui', to: null }] : []),
        ...(a.verifiedById ? [{ field: 'Vérifiée par', from: names.person(a.verifiedById), to: null }] : []),
      ],
    });
  });
  if ('state' in done) return done.state;
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id };
}

/** Abandonne une action ouverte, Reportée ou Terminée (motif obligatoire, liens détachés). */
export async function abandonAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', ACTION_AVANCEMENTS, { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  if (transitionKind(from!, 'abandonnee') !== 'abandon') {
    return { error: from === 'verifiee' ? "Action vérifiée : rouvrez-la avant de l'abandonner." : from === 'abandonnee' ? 'Action déjà abandonnée.' : NOT_ALLOWED };
  }

  const db = await getDb();
  const loaded = await loadForTransition(db, id, from!);
  if ('state' in loaded) return loaded.state;
  const a = loaded.row;

  const done = await runTransition(db, async (tx) => {
    // L'événement, la revue et les sources d'origine restent lisibles sur l'action abandonnée (keptOnCancel) : non listés.
    const detached = await detachAllLinks(tx, a.id);
    await writeAvancement(tx, a, 'abandonnee', {
      byId: session.user.id, reason,
      patch: { cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason },
      details: detached.map((d) => ({ field: 'Détachée de', from: d.label, to: null })),
    });
    // Aussi dans l'historique des sources qui en ont un (DUE-04).
    for (const d of detached) {
      if (d.logEntity) await logChange(tx, { ...d.logEntity, action: 'unlink', byId: session.user.id, reason, summary: `Action ${a.id} abandonnée : détachée` });
    }
  });
  if ('state' in done) return done.state;
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id };
}
