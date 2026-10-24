'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { actionLinks, checkActionLink, linkFacts, parseActionLink } from '@/lib/action-links';
import {
  NON_QSE_LINK_MESSAGE, QHSE_ONLY_CREATE_MESSAGE, actionDateErrors, actionHref, actionRights, admissibleSources, canCreateAction, canRemoveProof,
  isNonQseLinkKind, missingFields, sourceEditable, textTooLong, type ActionCompletion, type MissingField,
} from '@/lib/action-rules';
import {
  ACTION_AVANCEMENTS, ACTION_SOURCES, ACTION_TEXT_MAX, DOMAIN_KEYS, EVENT_AUDIT_LINK_KINDS, ORIGIN_REF_MAX, PRIORITY_KEYS, SOURCE_KEYS,
  SOURCE_LINK_KINDS, type SourceKey,
} from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite } from '@/lib/guard';
import type { ActionInsert } from '@/lib/queries';
import { getSession, inSite } from '@/lib/session';
import { today } from '@/lib/today';
import { deleteAttachment, removeStoredFile, saveUpload } from '@/lib/uploads';
import {
  ACTION_FIELD_LABELS, ActionLinkError, COST_MAX, HOURS_MAX, actionFieldDetails, createActionRecord, filesProblem, nameBook, newSiteProblem,
  notifyReassigned, ownOrInSite, pilotProblem, readNewActionFields, type ActionField,
} from './action-create';
import { logChange } from './changelog';
import { actionProofTitle, notify, qhseAnimatorIds } from './notify';
import { STALE_EDIT, VERSION_FIELD, staleEditError } from './versions';

// Création et modification d'une action du plan d'actions QSE (ACT-20), preuves (ACT-25). Champs postés : plan du
// paquet 1 § 2.14. Ordre des contrôles (CLAUDE.md) : droits → validation → chargement → requireInSite → une transaction
// avec ses entrées de journal (byId explicite) → revalidatePath('/', 'layout').
//   - Création : service QHSE seulement (ACT-22, réponses du 15/10/2026), depuis le plan comme depuis un écran source ;
//     un seul site, actif, du périmètre (jamais « Tous les sites ») ; élément lié (`link`) facultatif : il impose la source
//     (admissibleSources, D20), le site (celui de l'élément) et la référence d'origine par défaut (linkFacts) ; habilitation,
//     plan de prévention et permis refusés (aucune action QSE) ; sans élément, référence d'origine obligatoire.
//   - Modification : QHSE ; jamais une action abandonnée ; avancement affiché (`from`) contrôlé ; source lue seulement
//     tant qu'elle est vide (reprise), élément jamais changé ; règles de dates et de longueur sur les seules valeurs
//     modifiées (D24) ; champs obligatoires manquants (« à compléter ») exigés ; vérification planifiée figée une fois
//     « Vérifiée » ; transfert vers un site actif du périmètre, jamais hors du site de l'élément lié.
//   - Preuves : le responsable (tous sites, D19) ou le QHSE (site sélectionné) ; jamais sur une action abandonnée ;
//     retrait (seule suppression physique admise, spec § 10) avant « Vérifiée » : QHSE, ou le responsable actuel pour sa
//     propre preuve. Preuve du responsable hors QHSE : une notification par fichier à chaque animateur QHSE (ACT-31).

const ABANDONED = 'Action abandonnée : consultation seule.';
const STALE = "L'action a changé entre-temps : la fiche est actualisée.";
const DENIED = 'Votre rôle ne permet pas cette modification.';
const SOURCE_MISMATCH = "Source incompatible avec l'élément lié.";
const SITE_OF_ELEMENT = 'Site différent de celui de l’élément lié.';

/** Champ du formulaire d'un champ obligatoire manquant (missingFields). */
const MISSING_FIELD: Record<MissingField, string> = {
  source: 'source', problem: 'problem', domain: 'domain', priority: 'priority', siteId: 'siteId', verifyDueOn: 'verifyDueOn', doneOn: 'doneOn',
  closedOn: 'closedOn', verifyMethod: 'verifyMethod', efficacyNote: 'efficacyNote', effective: 'effective',
};

/** Crée (QHSE seulement, ACT-22) ou modifie une action du plan d'actions QSE (ACT-20). */
export async function saveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = formReader(fd).opt('id');
  return id ? updateAction(id, fd) : createAction(fd);
}

// ─── Création ───────────────────────────────────────────────────────────────

async function createAction(fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!canCreateAction(session.role)) return { error: QHSE_ONLY_CREATE_MESSAGE };
  const f = formReader(fd);
  const source = f.oneOf('source', SOURCE_KEYS, { required: true });
  const link = f.opt('link');
  const originField = f.str('originRef', { max: ORIGIN_REF_MAX });
  const v = readNewActionFields(f);
  const estimatedCost = f.decimal('estimatedCost', { min: 0, max: COST_MAX });
  const actualCost = f.decimal('actualCost', { min: 0, max: COST_MAX });
  if (!link && !originField) f.fail('originRef', "Précisez la référence d'origine : aucun élément lié.");
  const now = today();
  const dates = actionDateErrors({ openedOn: now, dueOn: v.dueOn, verifyDueOn: v.verifyDueOn }, now, { dueOn: true, verifyDueOn: true });
  Object.entries(dates.fieldErrors).forEach(([k, msg]) => f.fail(k, msg));
  const parsed = link ? parseActionLink(link) : null;
  if (link && !parsed) f.fail('link', 'Type de rattachement inconnu.');
  if (parsed && isNonQseLinkKind(parsed.kind)) f.fail('link', NON_QSE_LINK_MESSAGE);
  if (!f.ok) return f.state();

  const db = await getDb();
  const pilot = await pilotProblem(db, v.pilotId, now);
  if (pilot) return { error: 'Certains champs sont à corriger.', fieldErrors: { pilotId: pilot } };

  // Élément lié : écran de la source ouvert en saisie, site de l'élément dans le périmètre et le site sélectionné.
  let originRef = originField;
  if (link && parsed) {
    const checked = await checkActionLink(db, session.role, link);
    if ('error' in checked) return { error: checked.error, fieldErrors: { link: checked.error } };
    const el = await linkFacts(db, link);
    if (!el) return { error: 'Élément introuvable : le rattachement est impossible.', fieldErrors: { link: 'Élément introuvable.' } };
    const admitted = admissibleSources(parsed.kind, el.facts);
    const target = ACTION_SOURCES[source!].target;
    if (!admitted.includes(source!) || !SOURCE_LINK_KINDS[target].includes(parsed.kind)) {
      return { error: SOURCE_MISMATCH, fieldErrors: { source: SOURCE_MISMATCH } };
    }
    if (!inSite(el.siteId, v.siteId)) {
      return { error: `L'action doit concerner le site de son élément lié (${el.reference}) : choisissez ce site.`, fieldErrors: { siteId: SITE_OF_ELEMENT } };
    }
    if (!originRef) originRef = el.reference;
  }
  const siteError = await newSiteProblem(v.siteId);
  if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };

  let created: string;
  try {
    created = await db.transaction(async (tx) => (await createActionRecord(tx, {
      source: source!, originRef, pilotId: v.pilotId, priority: v.priority!, dueOn: v.dueOn!, domain: v.domain!, problem: v.problem, detail: v.detail,
      verifyDueOn: v.verifyDueOn!, riskLevel: v.riskLevel, estimatedCost, actualCost, siteId: v.siteId, links: link ? [link] : [], strictLinks: true,
    }, { byId: session.user.id, byName: session.user.name, today: now })).id);
  } catch (e) {
    if (e instanceof ActionLinkError) return { error: e.message, fieldErrors: { link: e.message } };
    throw e;
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: created, ...(dates.warnings.length ? { warnings: dates.warnings } : {}) };
}

// ─── Modification ───────────────────────────────────────────────────────────

/** Sites des éléments liés d'une action (événement, rattachements, sources d'origine) : un transfert doit les respecter. */
async function elementSites(db: DbOrTx, actionId: string): Promise<{ label: string; siteId: string }[]> {
  const out: { label: string; siteId: string }[] = [];
  for (const l of await actionLinks(db, actionId)) {
    const parsed = parseActionLink(l.link);
    const siteId = parsed ? await parsed.def.siteOf?.(db, parsed.args) : null;
    if (siteId) out.push({ label: l.label, siteId });
  }
  return out;
}

/** Sources admises par l'événement ou l'audit d'une action dont la source est vide (reprise) ; null : aucune contrainte. */
async function sourcesOfElement(db: DbOrTx, actionId: string): Promise<readonly SourceKey[] | null> {
  const kinds = EVENT_AUDIT_LINK_KINDS as readonly string[];
  const links = (await actionLinks(db, actionId)).filter((l) => kinds.includes(l.kind));
  if (!links.length) return null;
  const admitted = new Set<SourceKey>();
  for (const l of links) {
    const el = await linkFacts(db, l.link);
    if (el) admissibleSources(l.kind, el.facts).forEach((s) => admitted.add(s));
  }
  return [...admitted];
}

async function updateAction(id: string, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const from = f.oneOf('from', ACTION_AVANCEMENTS, { required: true });
  const pilotId = f.str('pilotId', { required: true });
  const priority = f.oneOf('priority', PRIORITY_KEYS, { required: true });
  const dueOn = f.date('dueOn', { required: true });
  const domain = f.oneOf('domain', DOMAIN_KEYS, { required: true });
  const problem = f.str('problem', { required: true });
  const detail = f.str('detail', { required: true });
  const riskLevel = f.int('riskLevel', { min: 0, max: 4 });
  const estimatedCost = f.decimal('estimatedCost', { min: 0, max: COST_MAX });
  const actualCost = f.decimal('actualCost', { min: 0, max: COST_MAX });
  const siteId = f.str('siteId', { required: true });
  if (siteId === 'all') f.fail('siteId', 'Choisissez un site : une action porte un seul site.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const [cur] = await db.select().from(t.actions).where(eq(t.actions.id, id));
  if (!cur) return { error: 'Action introuvable.' };
  // Site d'abord : rien de l'état d'une action hors du site sélectionné ou du périmètre n'est révélé (avancement, abandon).
  const blocked = await requireInSite(cur.siteId);
  if (blocked) return { error: blocked };
  if (cur.status === 'abandonnee') return { error: ABANDONED };
  if (cur.status !== from) {
    revalidatePath('/', 'layout');
    return { error: STALE };
  }

  // Champs selon l'avancement (§ 2.14, D17) : vérification planifiée figée une fois Vérifiée ; date effective à Terminée
  // et Vérifiée ; pointage à Vérifiée. Nature, constat, résultat et date de vérification ne changent que par « Rouvrir »
  // puis une nouvelle vérification (D17, décision de l'Integration du 15/10/2026).
  const verified = cur.status === 'verifiee';
  const withDone = cur.status === 'terminee' || verified;
  const verifyDueOn = verified ? cur.verifyDueOn : f.date('verifyDueOn');
  const doneOn = withDone ? f.date('doneOn') : cur.doneOn;
  const verifyMethod = cur.verifyMethod;
  const efficacyNote = cur.efficacyNote;
  const hours = verified && fd.has('hours') ? f.decimal('hours', { min: 0, max: HOURS_MAX }) : cur.hours;
  // Source : posée une fois, puis verrouillée ; lue seulement tant qu'elle est vide (reprise).
  const source = sourceEditable(cur) ? f.oneOf('source', SOURCE_KEYS) : cur.source;
  if (!f.ok) return f.state();

  const next: ActionCompletion & Record<string, unknown> = {
    status: cur.status, source, problem, domain, priority, siteId, verifyDueOn, doneOn, closedOn: cur.closedOn, verifyMethod, efficacyNote,
    effective: cur.effective,
  };
  // Champs obligatoires manquants (« à compléter ») exigés, parmi ceux que le formulaire porte à cet avancement.
  const editable: MissingField[] = ['source', 'problem', 'domain', 'priority', 'siteId', 'verifyDueOn', ...(withDone ? ['doneOn' as const] : [])];
  missingFields(next).filter((m) => editable.includes(m)).forEach((m) => f.fail(MISSING_FIELD[m], 'Champ obligatoire.'));
  // D24 : longueurs et dates contrôlées pour les seules valeurs modifiées.
  if (textTooLong(problem, cur.problem)) f.fail('problem', `${ACTION_TEXT_MAX} caractères au maximum.`);
  if (textTooLong(detail, cur.detail)) f.fail('detail', `${ACTION_TEXT_MAX} caractères au maximum.`);
  const now = today();
  const dates = actionDateErrors({ openedOn: cur.openedOn, dueOn, verifyDueOn, doneOn, closedOn: cur.closedOn }, now, {
    dueOn: dueOn !== cur.dueOn, verifyDueOn: verifyDueOn !== cur.verifyDueOn, doneOn: doneOn !== cur.doneOn,
  });
  Object.entries(dates.fieldErrors).forEach(([k, msg]) => f.fail(k, msg));
  if (!f.ok) return f.state();

  if (pilotId !== cur.pilotId) {
    const pilot = await pilotProblem(db, pilotId, now);
    if (pilot) return { error: 'Certains champs sont à corriger.', fieldErrors: { pilotId: pilot } };
  }
  if (source !== cur.source) {
    const admitted = await sourcesOfElement(db, cur.id);
    if (admitted && !admitted.includes(source!)) return { error: SOURCE_MISMATCH, fieldErrors: { source: SOURCE_MISMATCH } };
  }
  if (siteId !== cur.siteId) {
    // Transfert (QHSE) : site actif du périmètre, jamais hors du site d'un élément lié.
    const siteError = await newSiteProblem(siteId);
    if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
    const off = (await elementSites(db, cur.id)).find((e) => e.siteId !== siteId);
    if (off) return { error: `L'action doit concerner le site de son élément lié (${off.label}) : choisissez ce site.`, fieldErrors: { siteId: SITE_OF_ELEMENT } };
  }

  const patch = {
    pilotId, priority: priority!, dueOn: dueOn!, domain: domain!, problem, detail, riskLevel, estimatedCost, actualCost, siteId,
    verifyDueOn, doneOn, verifyMethod, efficacyNote, hours, source,
  } satisfies Partial<ActionInsert>;
  const before = Object.fromEntries((Object.keys(ACTION_FIELD_LABELS) as ActionField[]).map((k) => [k, cur[k]]));
  const result = await db.transaction(async (tx) => {
    // QUA-12 : fiche modifiée depuis l'ouverture du formulaire (autre modification, commentaire, preuve) : rien n'est écrasé.
    if (await staleEditError(tx, 'action', cur.id, fd.get(VERSION_FIELD))) return 'changed' as const;
    const details = actionFieldDetails(before, patch, await nameBook(tx));
    if (!details.length) return 'unchanged' as const;
    const done = await tx.update(t.actions).set(patch).where(and(eq(t.actions.id, cur.id), eq(t.actions.status, cur.status))).returning({ id: t.actions.id });
    if (!done.length) return 'stale' as const;
    await logChange(tx, {
      entityType: 'action', entityId: cur.id, action: 'update', byId: session.user.id, details,
      summary: `Modifiée : ${details.map((d) => d.field.toLowerCase()).join(', ')}`,
    });
    // Nouveau responsable : même notification qu'à la création (§ 22.15).
    if (pilotId !== cur.pilotId) await notifyReassigned(tx, { id: cur.id, detail }, pilotId, { id: session.user.id, name: session.user.name });
    return 'saved' as const;
  });
  if (result === 'stale' || result === 'changed') {
    revalidatePath('/', 'layout');
    return { error: result === 'changed' ? STALE_EDIT : STALE };
  }
  if (result === 'saved') revalidatePath('/', 'layout');
  return { ok: true, id: cur.id, ...(dates.warnings.length ? { warnings: dates.warnings } : {}) };
}

// ─── Preuves (pièces jointes de l'action) ───────────────────────────────────

/** Joint des preuves à une action (ACT-25) : responsable ou QHSE, jamais sur une action abandonnée. */
export async function addActionFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  const session = await getSession();
  const f = formReader(fd);
  const actionId = f.str('actionId', { required: true });
  const files = f.files('files');
  if (!actionId) return { error: 'Action introuvable.' };
  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, actionId));
  if (!a) return { error: 'Action introuvable.' };
  const rights = actionRights(session.role, session.user.id, a);
  if (!rights.qhse && !rights.responsible) return { error: DENIED };
  const blocked = await ownOrInSite(a, rights.responsible);
  if (blocked) return { error: blocked };
  if (!rights.canAttach) return { error: ABANDONED };
  if (!files.length) return { error: 'Choisissez au moins un fichier.' };
  const invalid = await filesProblem(files, session.user.id);
  if (invalid) return { error: invalid };

  await db.transaction(async (tx) => {
    for (const file of files) await saveUpload(file, 'action', actionId, session.user.id, { db: tx });
    await logChange(tx, {
      entityType: 'action', entityId: actionId, action: 'attach', byId: session.user.id,
      summary: `${files.length} preuve${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''}`,
      details: files.map((file) => ({ field: 'Fichier', from: null, to: file.name.slice(0, 200) || 'fichier' })),
    });
    // ACT-31 : preuve du responsable (hors QHSE) → chaque animateur QHSE, une notification par fichier.
    if (rights.responsible && !rights.qhse) {
      const animators = await qhseAnimatorIds(tx);
      for (const file of files) {
        for (const personId of animators) {
          await notify(tx, {
            personId, type: 'action_preuve', entityType: 'action', entityId: actionId, byId: session.user.id,
            title: actionProofTitle(actionId, session.user.name, file.name.slice(0, 200) || 'fichier'), href: actionHref(actionId),
          });
        }
      }
    }
  });
  revalidatePath('/', 'layout');
  return { count: files.length };
}

/** Retire une preuve ajoutée par erreur (seule suppression physique admise, spec § 10). */
export async function removeActionFile(attachmentId: string): Promise<{ error?: string }> {
  const session = await getSession();
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!row || row.entityType !== 'action') return { error: 'Pièce jointe introuvable.' };
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, row.entityId));
  if (!a) return { error: 'Action introuvable.' };
  const rights = actionRights(session.role, session.user.id, a);
  if (!rights.qhse && !rights.responsible) return { error: DENIED };
  const blocked = await ownOrInSite(a, rights.responsible);
  if (blocked) return { error: blocked };
  if (a.status === 'verifiee' || a.status === 'abandonnee') return { error: 'Action vérifiée ou abandonnée : les preuves ne peuvent plus être retirées.' };
  if (!canRemoveProof(rights, a.status, row.uploadedBy, session.user.id)) return { error: "Seul l'auteur de l'envoi, responsable de l'action, ou le service QHSE peut retirer cette preuve." };
  // Ligne supprimée et journal écrits dans la même transaction ; le fichier n'est effacé qu'après validation. Deux
  // retraits simultanés : un seul supprime la ligne, donc un seul est journalisé.
  const removed = await db.transaction(async (tx) => {
    const gone = await deleteAttachment(attachmentId, { db: tx });
    if (!gone) return null;
    await logChange(tx, {
      entityType: 'action', entityId: a.id, action: 'detach', byId: session.user.id,
      summary: 'Preuve retirée', details: [{ field: 'Fichier', from: row.fileName, to: null }],
    });
    return gone;
  });
  if (!removed) return { error: 'Pièce jointe introuvable.' };
  await removeStoredFile(removed);
  revalidatePath('/', 'layout');
  return {};
}
