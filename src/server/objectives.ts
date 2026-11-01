'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, max } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { OBJECTIVE_INDICATORS, OBJECTIVE_INDICATOR_KEYS, OBJECTIVE_LABEL_MAX, fmtObjectiveTarget, type ObjectiveIndicator } from '@/lib/objectives';
import { ALL_SITES } from '@/lib/session';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';

// Objectifs QHSE mesurables (AUD-13) : saisis sur l'écran « Audits et certifications » par les rôles qui y saisissent
// (canEdit : animateur QHSE, direction) ; jamais supprimés (archivage motivé) ; chaque écriture au journal (qhse_objective).

const requireObjectiveEditor = () => requireEditor('audits');

const LABELS = { year: 'Année', label: 'Objectif', indicator: 'Indicateur', target: 'Cible', siteId: 'Site', pilotId: 'Pilote', reviewDecisionId: 'Décision de revue' } as const;

/**
 * Crée ou modifie un objectif : année, libellé, indicateur calculé, cible (≥ 0 ; pourcentage ≤ 100), site (« Tous les
 * sites » réservé au périmètre complet, requireInSite), pilote présent, décision de revue « objectif » facultative.
 */
export async function saveObjective(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireObjectiveEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const year = f.int('year', { required: true, min: 2000, max: 2100 });
  const label = f.str('label', { required: true, max: OBJECTIVE_LABEL_MAX });
  const indicator = f.oneOf('indicator', OBJECTIVE_INDICATOR_KEYS, { required: true });
  const target = f.decimal('target', { required: true, min: 0, max: 9_999_999_999 });
  const site = f.str('siteId', { required: true });
  const siteId = site === ALL_SITES ? null : site || null;
  const pilotId = f.opt('pilotId');
  const reviewDecisionId = f.int('reviewDecisionId', { min: 1 });
  if (indicator && target != null && OBJECTIVE_INDICATORS[indicator as ObjectiveIndicator].unit === '%' && target > 100) f.fail('target', 'Pourcentage : 100 au plus.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const [current] = id ? await db.select().from(t.qhseObjectives).where(eq(t.qhseObjectives.id, id)) : [];
  if (id && !current) return { error: 'Objectif introuvable.' };
  if (current?.archivedAt) return { error: 'Objectif archivé : il ne se modifie plus.' };
  if (current) {
    const siteError = await requireInSite(current.siteId);
    if (siteError) return { error: siteError };
  }
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: 'Certains champs sont à corriger.', fieldErrors: { siteId: siteError } };
  }
  const [[pilot], [decision]] = await Promise.all([
    pilotId ? db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, pilotId)) : [],
    reviewDecisionId ? db.select({ id: t.reviewDecisions.id, kind: t.reviewDecisions.kind, text: t.reviewDecisions.text }).from(t.reviewDecisions).where(eq(t.reviewDecisions.id, reviewDecisionId)) : [],
  ]);
  if (pilotId && !pilot) f.fail('pilotId', 'Personne inconnue.');
  else if (pilot?.leftOn && pilotId !== current?.pilotId) f.fail('pilotId', "Personne sortie de l'effectif.");
  if (reviewDecisionId && (!decision || decision.kind !== 'objectif')) f.fail('reviewDecisionId', 'Choisissez un objectif décidé en revue de direction.');
  if (!f.ok) return f.state();

  const values: { year: number; label: string; indicator: string; target: number; siteId: string | null; pilotId: string | null; reviewDecisionId: number | null } = {
    year: year!, label, indicator: indicator!, target: target!, siteId, pilotId, reviewDecisionId,
  };
  const byId = session.user.id;
  if (current) {
    const people = new Map((await db.select({ id: t.people.id, name: t.people.name }).from(t.people)).map((p) => [p.id, p.name]));
    const shown = (o: typeof values) => ({
      ...o, indicator: OBJECTIVE_INDICATORS[o.indicator as ObjectiveIndicator]?.short ?? o.indicator,
      target: fmtObjectiveTarget(o.indicator as ObjectiveIndicator, o.target), siteId: o.siteId ?? 'Tous les sites',
      pilotId: o.pilotId ? people.get(o.pilotId) ?? o.pilotId : null, reviewDecisionId: o.reviewDecisionId ? `n° ${o.reviewDecisionId}` : null,
    });
    const details = diffFields(shown(current), shown(values), LABELS, (v) => (v == null || v === '' ? null : String(v)));
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      // QUA-12 : objectif modifié depuis l'ouverture du formulaire : rien n'est écrasé.
      await assertFresh(tx, 'qhse_objective', current.id, fd.get(VERSION_FIELD));
      await tx.update(t.qhseObjectives).set(values).where(eq(t.qhseObjectives.id, current.id));
      if (details.length) await logChange(tx, { entityType: 'qhse_objective', entityId: current.id, action: 'update', summary: 'Objectif modifié', details, byId });
    }));
    if (stale) return { error: stale };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(current.id) };
  }
  const newId = await db.transaction(async (tx) => {
    const [{ m }] = await tx.select({ m: max(t.qhseObjectives.sort) }).from(t.qhseObjectives).where(eq(t.qhseObjectives.year, year!));
    const [row] = await tx.insert(t.qhseObjectives).values({ ...values, sort: (m ?? -1) + 1, createdById: byId }).returning({ id: t.qhseObjectives.id });
    await logChange(tx, {
      entityType: 'qhse_objective', entityId: row.id, action: 'create', byId,
      summary: `Objectif ${year} créé · ${OBJECTIVE_INDICATORS[indicator as ObjectiveIndicator].short} ${fmtObjectiveTarget(indicator as ObjectiveIndicator, target!)}${decision ? ` (revue : ${decision.text})` : ''}`,
    });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(newId) };
}

/** Archive un objectif (abandonné, remplacé, saisi par erreur) : jamais supprimé, motif obligatoire, journal. */
export async function archiveObjective(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireObjectiveEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [current] = await db.select().from(t.qhseObjectives).where(eq(t.qhseObjectives.id, id!));
  if (!current) return { error: 'Objectif introuvable.' };
  if (current.archivedAt) return { error: 'Objectif déjà archivé.' };
  const siteError = await requireInSite(current.siteId);
  if (siteError) return { error: siteError };
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.qhseObjectives).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason })
      .where(and(eq(t.qhseObjectives.id, current.id), isNull(t.qhseObjectives.archivedAt))).returning({ id: t.qhseObjectives.id });
    if (!row) return false;
    await logChange(tx, { entityType: 'qhse_objective', entityId: current.id, action: 'archive', summary: 'Objectif archivé', reason, byId: session.user.id });
    return true;
  });
  if (!done) return { error: 'Objectif déjà archivé.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(current.id) };
}
