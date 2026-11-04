'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addMonths, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { canApprove, isClosedActionStatus } from '@/lib/domain';
import { readCursusTitles } from '@/lib/foreign/cursus';
import { unavailableMessage } from '@/lib/foreign/labels';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';
import { nextSort } from '@/lib/sort-order';

// Habilitations et formations : exigences par salarié, personnel et titres suivis. Décision CV-01 du 04/11/2026 (lot 2
// de M-02) : Cursus fait foi pour le catalogue des titres (D08) et les titres détenus (D09) ; Vigie les consulte. Plus de
// saisie de formation, d'attestation, de session collective (HAB-06) ni d'évaluation à froid (HAB-13), plus de création ni
// de renommage d'un titre (HAB-12) ni de prérequis saisis (HAB-10) : un titre se suit en le choisissant dans le catalogue
// de Cursus (followTitle), « ne plus suivre » = archivage motivé.
// Plan d'actions : aucune formation ni aucun recyclage ne donne lieu à une action QSE (réponses du service QHSE du
// 15/10/2026, le service RH gère cette partie) ; ces server actions ne lisent ni n'écrivent aucune action, sauf pour
// protéger le rattachement d'une action de recyclage reprise (actions.qualification_person_id / qualification_title_id,
// HAB-04) encore non close.

const done = () => revalidatePath('/', 'layout');

/** Journal de l'exigence « titre requis pour ce salarié » (case de la matrice, HAB-03) : identifiant « personne|titre ». */
const requirementKey = (personId: string, titleId: string) => `${personId}|${titleId}`;

/**
 * Saisie réservée aux rôles qui ont accès à l'écran « Habilitations et formations » (hors salariés et lecture seule) :
 * le chef de projet saisit ailleurs mais n'a pas cet écran, il ne modifie rien ici.
 */
const requireSkillsEditor = () => requireEditor('skills');

/** Refus d'une modification des titres suivis hors QHSE (HAB-12). */
const TITLES_RESERVED = "Titres suivis communs à tous les sites : réservés à l'animateur QHSE et à la direction.";

/**
 * Titres suivis (ajout, intitulé, validité, archivage, restauration) : communs à tous les sites (aucun siteId), ils
 * relèvent du service QHSE et de la direction (HAB-12), comme tout élément commun à tous les sites (ALL_SITES_RESERVED).
 */
async function requireTitlesEditor() {
  const { session, error } = await requireSkillsEditor();
  if (error) return { session, error };
  return canApprove(session.role) ? { session, error: null } : { session, error: TITLES_RESERVED };
}

/** Salarié sorti de l'effectif à la date du jour (archivé : plus de saisie sur sa fiche ni ses formations). */
const hasLeft = (p: { leftOn: string | null }) => !!p.leftOn && p.leftOn <= today();

/**
 * Actions de recyclage reprises encore non closes (ni Vérifiée ni Abandonnée, Terminée comprise) rattachées aux exigences
 * d'un titre ou d'un salarié.
 */
async function openRenewals(db: DbOrTx, by: { titleId: string } | { personId: string }) {
  // Actions des exigences en vigueur (une case dont le titre n'est plus requis ne retient plus rien).
  const rows = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions)
    .innerJoin(t.qualificationRequirements, and(
      eq(t.qualificationRequirements.personId, t.actions.qualificationPersonId), eq(t.qualificationRequirements.titleId, t.actions.qualificationTitleId),
    ))
    .where('titleId' in by ? eq(t.actions.qualificationTitleId, by.titleId) : eq(t.actions.qualificationPersonId, by.personId));
  return rows.filter((a) => !isClosedActionStatus(a.status)).map((a) => a.id).sort();
}

/**
 * Rend un titre requis (ou non) pour un salarié (les titres détenus sont lus dans Cursus).
 * Retirer l'exigence est refusé tant que l'action de recyclage reprise rattachée n'est pas close (le lien serait perdu).
 */
export async function setRequirement(personId: string, titleId: string, required: boolean): Promise<{ error?: string }> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  if (typeof personId !== 'string' || typeof titleId !== 'string') return { error: 'Salarié ou titre introuvable.' };
  const db = await getDb();
  const [[person], [title]] = await Promise.all([
    db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, personId)),
    db.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, archivedAt: t.trainingTitles.archivedAt }).from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
  ]);
  if (!person || !title) return { error: 'Salarié ou titre introuvable.' };
  if (title.archivedAt) return { error: "Titre qui n'est plus suivi : suivez-le à nouveau pour modifier ses exigences." };
  if (hasLeft(person)) return { error: "Salarié sorti de l'effectif." };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const where = and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId));
  const log = (tx: DbOrTx, on: boolean) => logChange(tx, {
    entityType: 'qualification_requirement', entityId: requirementKey(personId, titleId), action: on ? 'create' : 'delete', byId: session.user.id,
    summary: on ? `Titre « ${title.label} » requis pour ce salarié` : `Titre « ${title.label} » n'est plus requis`,
  });
  if (required) {
    await db.transaction(async (tx) => {
      const added = await tx.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing().returning({ personId: t.qualificationRequirements.personId });
      if (added.length) await log(tx, true);
    });
  } else {
    const renewals = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions)
      .where(and(eq(t.actions.qualificationPersonId, personId), eq(t.actions.qualificationTitleId, titleId)));
    const action = renewals.filter((a) => !isClosedActionStatus(a.status)).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (action) {
      return { error: `L'action ${action.id} (recyclage) n'est pas close : le service QHSE doit la clôturer ou l'abandonner avant le retrait de l'exigence.` };
    }
    await db.transaction(async (tx) => {
      const removed = await tx.delete(t.qualificationRequirements).where(where).returning({ personId: t.qualificationRequirements.personId });
      if (removed.length) await log(tx, false);
    });
  }
  done();
  return {};
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Champs de la fiche salarié suivis par le journal (HAB-03). */
const PERSON_LABELS = {
  name: 'Nom', job: 'Poste', service: 'Service', siteId: 'Site de rattachement', inSkillsMatrix: 'Suivi dans la matrice', email: 'E-mail', matricule: 'Matricule',
} as const;

/**
 * Ajoute ou modifie un salarié (saisie provisoire, en attendant le connecteur Cursus). Fiche d'un salarié sorti : réintégrer d'abord.
 * Identifiant généré (jamais tiré du nom : deux homonymes sont deux fiches) ; doublons refusés sur l'e-mail (sans tenir compte
 * de la casse) et le matricule, clés de rapprochement avec Entra ID et Cursus.
 */
export async function savePerson(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const [sites, people] = await Promise.all([
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    db.select({
      id: t.people.id, sort: t.people.sort, siteId: t.people.siteId, leftOn: t.people.leftOn, email: t.people.email, matricule: t.people.matricule,
      name: t.people.name, job: t.people.job, service: t.people.service, inSkillsMatrix: t.people.inSkillsMatrix,
    }).from(t.people),
  ]);
  const f = formReader(fd);
  const id = f.opt('id');
  const name = f.str('name', { required: true, max: 80 });
  const job = f.str('job', { max: 80 });
  const service = f.str('service', { max: 60 });
  const siteId = f.oneOf('siteId', sites.map((s) => s.id), { required: true });
  const inSkillsMatrix = f.bool('inSkillsMatrix');
  const email = f.str('email', { max: 254 }).toLowerCase() || null;
  const matricule = f.str('matricule', { max: 40 }) || null;
  if (email && !EMAIL.test(email)) f.fail('email', 'Adresse e-mail invalide.');
  if (email && people.some((p) => p.id !== id && p.email?.toLowerCase() === email)) f.fail('email', 'Une autre fiche porte déjà cet e-mail.');
  if (matricule && people.some((p) => p.id !== id && p.matricule === matricule)) f.fail('matricule', 'Une autre fiche porte déjà ce matricule.');
  if (!f.ok) return f.state();

  // E-mail et matricule : champs absents du formulaire (saisie partielle) = inchangés.
  const values = {
    name, job, service, siteId, inSkillsMatrix,
    ...(fd.has('email') ? { email } : {}),
    ...(fd.has('matricule') ? { matricule } : {}),
  };
  if (id) {
    const prev = people.find((p) => p.id === id);
    if (!prev) return { error: 'Salarié introuvable.' };
    if (hasLeft(prev)) return { error: "Salarié sorti de l'effectif : réintégrez-le pour modifier sa fiche." };
    const blocked = (await requireInSite(prev.siteId)) ?? (siteId !== prev.siteId ? await requireInSite(siteId, { create: true }) : null);
    if (blocked) return { error: blocked };
    const siteLabel = (sid: string | null) => (sid ? sites.find((s) => s.id === sid)?.label ?? sid : null);
    const fmt = (v: unknown) => (v == null || v === '' ? null : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v));
    const details = diffFields({ ...prev, siteId: siteLabel(prev.siteId) }, { ...values, siteId: siteLabel(values.siteId) }, PERSON_LABELS, fmt);
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'person', id, fd.get(VERSION_FIELD));
      await tx.update(t.people).set(values).where(eq(t.people.id, id));
      if (details.length) await logChange(tx, { entityType: 'person', entityId: id, action: 'update', summary: 'Fiche salarié modifiée', details });
    }));
    if (stale) return { error: stale };
    done();
    return { ok: true, id };
  }
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };
  const newId = randomUUID();
  const sort = nextSort(people);
  await db.transaction(async (tx) => {
    await tx.insert(t.people).values({ id: newId, ...values, sort });
    await logChange(tx, { entityType: 'person', entityId: newId, action: 'create', summary: 'Salarié ajouté' });
  });
  done();
  return { ok: true, id: newId };
}

/**
 * Sortie de l'effectif (archivage, jamais de suppression) : date de sortie et motif. À partir de cette date, le salarié
 * quitte la matrice, les signaux et les listes ; ses exigences restent consultables (titres tenus par Cursus). Saisie provisoire (connecteur Cursus).
 * Refusée tant qu'un recyclage rattaché à ses exigences est ouvert.
 */
export async function setPersonLeft(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const leftOn = f.date('leftOn', { required: true });
  // Motif de la sortie : règle commune des motifs (QUA-22, formReader.reason).
  const leftReason = f.reason('leftReason');
  if (leftOn && leftOn < addMonths(today(), -12)) f.fail('leftOn', "La date de sortie ne peut pas remonter à plus d'un an.");
  if (!f.ok) return f.state();
  const db = await getDb();
  const [person] = await db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Salarié introuvable.' };
  if (hasLeft(person)) return { error: "Salarié déjà sorti de l'effectif." };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const open = await openRenewals(db, { personId: id });
  if (open.length) return { error: `Recyclage encore ouvert (${open.join(', ')}) : le service QHSE doit clôturer ou abandonner ces actions avant la déclaration de sortie.` };
  await db.transaction(async (tx) => {
    await tx.update(t.people).set({ leftOn, leftReason }).where(eq(t.people.id, id));
    await logChange(tx, { entityType: 'person', entityId: id, action: 'archive', summary: `Sortie de l'effectif le ${fmtDate(leftOn!)}`, reason: leftReason });
  });
  done();
  return { ok: true, id };
}

/** Réintègre un salarié sorti (ou annule une sortie déclarée), motif obligatoire (QUA-22) : il revient dans la matrice et les listes. */
export async function reinstatePerson(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [person] = await db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Salarié introuvable.' };
  if (!person.leftOn) return { error: 'Aucune sortie déclarée pour ce salarié.' };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  await db.transaction(async (tx) => {
    await tx.update(t.people).set({ leftOn: null, leftReason: null }).where(eq(t.people.id, id));
    await logChange(tx, { entityType: 'person', entityId: id, action: 'restore', summary: 'Salarié réintégré', reason });
  });
  done();
  return { ok: true, id };
}

/**
 * Suit un titre du catalogue de Cursus (D08) : choisi parmi les titres de cursus.pub_titres que Vigie ne suit pas encore
 * (`titleId` = titre_id) ; intitulé et validité repris de Cursus (jamais saisis), placé en dernière colonne de la matrice,
 * attributs propres au QHSE facultatifs (CV-03). Un titre qui n'est plus suivi se suit à nouveau par « Suivre à nouveau »
 * (historique conservé). Catalogue indisponible : refusé avec le message de la source.
 */
export async function followTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('titleId', { required: true, max: 120 });
  if (!f.ok) return f.state();
  const db = await getDb();
  const [titles, catalog] = await Promise.all([db.select().from(t.trainingTitles), readCursusTitles(db)]);
  if (!catalog.ok) return { error: unavailableMessage('titles') };
  const twin = titles.find((x) => x.id === id);
  const src = catalog.rows.find((x) => x.id === id);
  if (twin) f.fail('titleId', twin.archivedAt ? 'Titre qui n’est plus suivi : suivez-le à nouveau.' : 'Ce titre est déjà suivi.');
  else if (!src) f.fail('titleId', 'Titre absent du catalogue de Cursus.');
  if (!f.ok || !src) return f.state();
  const values = {
    id, label: src.shortLabel, validityMonths: src.validityMonths ?? 0, sort: nextSort(titles), cursusState: 'actif',
    firstAid: f.bool('firstAid'), awareness: f.bool('awareness'), internalAuditor: f.bool('internalAuditor'),
  };
  const flags = [values.firstAid && 'secourisme', values.awareness && 'sensibilisation', values.internalAuditor && 'auditeur interne'].filter(Boolean);
  await db.transaction(async (tx) => {
    await tx.insert(t.trainingTitles).values(values);
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'create', summary: `Titre « ${src.shortLabel} » suivi (catalogue de Cursus : ${id})${flags.length ? ` — ${flags.join(', ')}` : ''}` });
  });
  done();
  return { ok: true, id };
}

/**
 * Modifie les attributs propres au QHSE d'un titre suivi (CV-03) : secourisme (`firstAid`, titulaires donneurs de soins du
 * registre des accidents bénins, EVT-04), sensibilisation (HAB-13), auditeur interne (AUD-27). Intitulé et validité sont
 * ceux de Cursus (jamais modifiés ici). Champ absent du formulaire : valeur enregistrée conservée.
 */
export async function saveTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  if (!f.ok) return f.state();
  const db = await getDb();
  const [prev] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id));
  if (!prev) return { error: 'Titre introuvable.' };
  if (prev.archivedAt) return { error: "Titre qui n'est plus suivi : suivez-le à nouveau pour le modifier." };
  const firstAid = fd.has('firstAidField') ? f.bool('firstAid') : prev.firstAid;
  const awareness = fd.has('awarenessField') ? f.bool('awareness') : prev.awareness;
  const internalAuditor = fd.has('internalAuditorField') ? f.bool('internalAuditor') : prev.internalAuditor;
  const yes = (v: boolean) => (v ? 'oui' : 'non');
  const details = [
    ...(prev.firstAid !== firstAid ? [{ field: 'Secourisme', from: yes(prev.firstAid), to: yes(firstAid) }] : []),
    ...(prev.awareness !== awareness ? [{ field: 'Sensibilisation', from: yes(prev.awareness), to: yes(awareness) }] : []),
    ...(prev.internalAuditor !== internalAuditor ? [{ field: 'Auditeur interne', from: yes(prev.internalAuditor), to: yes(internalAuditor) }] : []),
  ];
  const stale = await freshWrite(() => db.transaction(async (tx) => {
    await assertFresh(tx, 'training_title', id, fd.get(VERSION_FIELD));
    if (!details.length) return;
    await tx.update(t.trainingTitles).set({ firstAid, awareness, internalAuditor }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'update', summary: `Titre « ${prev.label} » modifié`, details });
  }));
  if (stale) return { error: stale };
  done();
  return { ok: true, id };
}

/**
 * « Ne plus suivre » un titre (archivage motivé) : retiré de la matrice, des formulaires et des échéances. Exigences
 * conservées ; les titres détenus restent tenus par Cursus. Refusé tant qu'un recyclage rattaché à une exigence de ce
 * titre est ouvert.
 */
export async function archiveTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireTitlesEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [title] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id));
  if (!title) return { error: 'Titre introuvable.' };
  if (title.archivedAt) return { error: "Ce titre n'est déjà plus suivi." };
  const open = await openRenewals(db, { titleId: id });
  if (open.length) return { error: `Recyclage encore ouvert (${open.join(', ')}) : le service QHSE doit clôturer ou abandonner ces actions avant de ne plus suivre le titre.` };
  await db.transaction(async (tx) => {
    await tx.update(t.trainingTitles).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'archive', summary: `Titre « ${title.label} » n'est plus suivi`, reason });
  });
  done();
  return { ok: true, id };
}

/** Suit à nouveau un titre qui ne l'était plus, motif obligatoire (QUA-22) : il revient dans la matrice avec ses exigences. */
export async function restoreTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [title] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id));
  if (!title) return { error: 'Titre introuvable.' };
  if (!title.archivedAt) return { ok: true, id };
  await db.transaction(async (tx) => {
    await tx.update(t.trainingTitles).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'restore', summary: `Titre « ${title.label} » de nouveau suivi`, reason });
  });
  done();
  return { ok: true, id };
}

/**
 * HAB-15 : déplace un titre suivi d'un rang vers la gauche (« up ») ou la droite (« down ») dans les colonnes de la matrice,
 * parmi les titres en vigueur (les titres archivés gardent leur rang) ; service QHSE et direction (requireTitlesEditor,
 * HAB-12), commun à tous les sites. Renumérotation 0..n-1 dans la transaction, inscrite au journal du titre.
 */
export async function moveTitle(id: string, dir: 'up' | 'down'): Promise<{ error?: string }> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  if (typeof id !== 'string' || !id || (dir !== 'up' && dir !== 'down')) return { error: 'Titre introuvable.' };
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const scope = await tx.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, sort: t.trainingTitles.sort }).from(t.trainingTitles)
      .where(isNull(t.trainingTitles.archivedAt)).orderBy(asc(t.trainingTitles.sort), asc(t.trainingTitles.id));
    const i = scope.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'Titre introuvable ou archivé.' };
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= scope.length) return { moved: false };
    const title = scope[i];
    const neighbour = scope[j];
    [scope[i], scope[j]] = [scope[j], scope[i]];
    for (const [n, x] of scope.entries()) if (x.sort !== n) await tx.update(t.trainingTitles).set({ sort: n }).where(eq(t.trainingTitles.id, x.id));
    await logChange(tx, {
      entityType: 'training_title', entityId: id, action: 'move',
      summary: `Titre « ${title.label} » placé ${dir === 'up' ? 'avant' : 'après'} « ${neighbour.label} » dans la matrice`,
    });
    return { moved: true };
  });
  if ('error' in result) return { error: result.error };
  if (result.moved) done();
  return {};
}
