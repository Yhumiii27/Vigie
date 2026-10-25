import { describe, expect, it, vi } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, lastLog, freshDemoDatabase } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { AuthState } from '@/lib/auth';
import { ROLE_KEYS } from '@/lib/domain';
import { setSite } from '@/app/actions';
import { cancelFinding } from '@/server/audits';
import { obsoleteDocument } from '@/server/documents';
import { cancelWasteEntry } from '@/server/environment';
import { dismissEvent, restoreEvent, revertEvent } from '@/server/events';
import { abandonAction } from '@/server/plan-ui';
import { archiveContractor } from '@/server/contractors';
import { cancelPermit } from '@/server/permits';
import { cancelPlan, closePlan, savePlan, signPlanEu } from '@/server/prevention';
import { cancelReview } from '@/server/review';
import { archiveRisk, archiveWorkUnit, restoreRisk, restoreWorkUnit } from '@/server/risks';
import { archiveSite } from '@/server/sites';
import { archiveTitle, cancelQualification } from '@/server/skills';
import { archiveControl, archiveRequirement, cancelControlRecord } from '@/server/watch';

/** Signature EU (PRV-07) : date, nom et qualité du signataire. */
const signEu = (id: string, extra: Record<string, string> = {}) =>
  signPlanEu({}, form({ id, signedEuOn: '2026-10-09', signedEuName: '[H. Marchand]', signedEuQuality: 'Directeur de site', ...extra }));

// Droits et garde-fous communs des server actions (QUA-04) : saisie (requireManager), validation (requireApprover),
// site sélectionné et périmètre de sites (requireInSite), motif obligatoire des annulations et archivages, journal.

// Identité de la requête : démonstration (rôle choisi, src/lib/auth/demo.ts), ou identité imposée par un test (périmètre restreint).
const auth = vi.hoisted(() => ({ override: null as AuthState | null }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, getAuthState: async () => auth.override ?? real.getAuthState() };
});

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";

describe('saisie et validation par rôle', () => {
  it('requireManager : tout l’encadrement saisit, jamais le Salarié', async () => {
    const results: Record<string, unknown> = {};
    for (const role of ROLE_KEYS) {
      actAs(role);
      results[role] = await signEu('PP-inconnu');
    }
    expect(results).toEqual({
      'Animateur QHSE': { error: 'Plan de prévention introuvable.' }, Direction: { error: 'Plan de prévention introuvable.' },
      'Chef de service': { error: 'Plan de prévention introuvable.' }, 'Chef de projet': { error: 'Plan de prévention introuvable.' },
      Salarié: { error: DENIED },
    });
  });

  it('requireApprover : abandon d’action, retour d’étape, classement sans suite réservés à l’animateur QHSE et à la direction', async () => {
    for (const role of ROLE_KEYS) {
      actAs(role);
      const approver = role === 'Animateur QHSE' || role === 'Direction';
      expect(await abandonAction({}, form({ id: 'A-inconnue', from: 'a_faire', reason: 'Test' }))).toEqual({ error: approver ? 'Action introuvable.' : APPROVERS_ONLY });
      expect(await revertEvent({}, form({ id: 'EV-inconnu', reason: 'Test' }))).toEqual({ error: approver ? 'Événement introuvable.' : APPROVERS_ONLY });
      expect(await dismissEvent({}, form({ id: 'EV-inconnu', reason: 'Test' }))).toEqual({ error: approver ? 'Événement introuvable.' : APPROVERS_ONLY });
      expect(await archiveSite({}, form({ siteId: 'inconnu', reason: 'Test' }))).toMatchObject({ error: approver ? expect.not.stringContaining('Réservé') : APPROVERS_ONLY });
    }
  });
});

describe('motif obligatoire des annulations, archivages et restaurations', () => {
  it.each([
    ['abandonAction', () => abandonAction({}, form({ id: 'A-217', from: 'a_faire', reason: '' }))],
    ['revertEvent', () => revertEvent({}, form({ id: 'EV-2026-131', reason: '' }))],
    ['dismissEvent', () => dismissEvent({}, form({ id: 'EV-2026-133', reason: '' }))],
    ['restoreEvent', () => restoreEvent({}, form({ id: 'EV-2026-133', reason: '' }))],
    ['archiveContractor', () => archiveContractor({}, form({ id: 'EE-006', reason: '' }))],
    ['cancelPlan', () => cancelPlan({}, form({ id: 'PP-2026-017', reason: '' }))],
    ['cancelPermit', () => cancelPermit({}, form({ id: 'PF-2026-030', reason: '' }))],
    ['archiveRisk', () => archiveRisk({}, form({ id: '1', reason: '' }))],
    ['restoreRisk', () => restoreRisk({}, form({ id: '1', reason: '' }))],
    ['archiveWorkUnit', () => archiveWorkUnit({}, form({ id: 'UT-01', reason: '' }))],
    ['restoreWorkUnit', () => restoreWorkUnit({}, form({ id: 'UT-01', reason: '' }))],
    ['cancelQualification', () => cancelQualification({}, form({ id: '1', reason: '' }))],
    ['archiveTitle', () => archiveTitle({}, form({ id: 'sst', reason: '' }))],
    ['archiveRequirement', () => archiveRequirement({}, form({ id: '1', reason: '' }))],
    ['archiveControl', () => archiveControl({}, form({ id: '1', reason: '' }))],
    ['cancelControlRecord', () => cancelControlRecord({}, form({ id: '1', reason: '' }))],
    ['cancelFinding', () => cancelFinding({}, form({ id: '1', reason: '' }))],
    ['obsoleteDocument', () => obsoleteDocument({}, form({ documentId: 'PR-QHSE-005', reason: '' }))],
    ['cancelWasteEntry', () => cancelWasteEntry({}, form({ id: '1', reason: '' }))],
    ['cancelReview', () => cancelReview({}, form({ id: '1', reason: '' }))],
    ['archiveSite', () => archiveSite({}, form({ siteId: 'ville-b', reason: '' }))],
  ] as const)('%s', async (_name, call) => {
    actAs('Animateur QHSE', 'all');
    const r = await call();
    expect(r).toMatchObject({ error: 'Certains champs sont à corriger.', fieldErrors: { reason: 'Motif obligatoire.' } });
  });
});

describe('journal des modifications : auteur, motif, détail', () => {
  it('abandon d’une action : avancement, motif, auteur ; jamais supprimée', async () => {
    actAs('Direction', 'all');
    expect(await abandonAction({}, form({ id: 'A-217', from: 'a_faire', reason: 'Fin de course remplacé lors de la VGP' }))).toEqual({ ok: true, id: 'A-217' });
    const [a] = await (await getDb()).select().from(t.actions).where(eq(t.actions.id, 'A-217'));
    expect(a).toMatchObject({ status: 'abandonnee', cancelledById: 'hmarchand', cancelReason: 'Fin de course remplacé lors de la VGP' });
    expect(await lastLog('action', 'A-217')).toMatchObject({ action: 'status', summary: 'Abandonnée', reason: 'Fin de course remplacé lors de la VGP', byId: 'hmarchand' });
    expect(await abandonAction({}, form({ id: 'A-217', from: 'abandonnee', reason: 'Encore' }))).toEqual({ error: 'Action déjà abandonnée.' });
    expect(await abandonAction({}, form({ id: 'A-217', from: 'a_faire', reason: 'Encore' }))).toEqual({ error: "L'action a changé entre-temps : la fiche est actualisée." });
  });
  it('classement sans suite puis annulation du classement : motif et auteur tracés', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await dismissEvent({}, form({ id: 'EV-2026-133', reason: 'Doublon de EV-2026-131' }))).toEqual({ ok: true, id: 'EV-2026-133' });
    expect(await lastLog('event', 'EV-2026-133')).toMatchObject({ action: 'cancel', summary: 'Événement classé sans suite', reason: 'Doublon de EV-2026-131', byId: 'clefevre' });
    expect(await dismissEvent({}, form({ id: 'EV-2026-133', reason: 'Encore' }))).toEqual({ error: 'Événement déjà classé sans suite.' });
    expect(await restoreEvent({}, form({ id: 'EV-2026-133', reason: 'Événement distinct après vérification' }))).toEqual({ ok: true, id: 'EV-2026-133' });
    expect(await lastLog('event', 'EV-2026-133')).toMatchObject({ action: 'restore', reason: 'Événement distinct après vérification', byId: 'clefevre' });
    const steps = await (await getDb()).select().from(t.eventSteps).where(eq(t.eventSteps.eventId, 'EV-2026-133'));
    expect(steps.map((s) => [s.kind, s.reason])).toEqual([['dismiss', 'Doublon de EV-2026-131'], ['restore', 'Événement distinct après vérification']]);
  });
});

describe('périmètre de sites (SEC-02) et site sélectionné', () => {
  // Chef de service rattaché au site B ([J. Petit]), sites accordés : site B seulement.
  const restricted = () => { auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role: 'Chef de service', siteIds: ['ville-b'] } }; };

  it('session : site du périmètre seulement, ni « Tous les sites » ni autre site par cookie', async () => {
    restricted();
    cookieJar.set('vigie_site', 'all');
    const { getSession } = await import('@/lib/session');
    expect(await getSession()).toMatchObject({ site: { id: 'ville-b' }, siteOptions: [{ id: 'ville-b' }], allowedSiteIds: ['ville-b'] });
    cookieJar.delete('vigie_site');
    await setSite('ville-a');
    expect(cookieJar.get('vigie_site')).toBeUndefined();
    await setSite('ville-b');
    expect(cookieJar.get('vigie_site')).toBe('ville-b');
    auth.override = null;
  });

  it('server actions : élément ou création hors périmètre refusés, site du périmètre admis', async () => {
    restricted();
    cookieJar.set('vigie_site', 'ville-b');
    const outside = { error: 'Cet élément appartient à un site hors de votre périmètre.' };
    expect(await signEu('PP-2026-016')).toEqual(outside);
    expect(await savePlan({}, form({
      contractorId: 'EE-001', siteId: 'ville-a', title: 'Hors périmètre', location: 'Atelier', startOn: '2026-11-02', endOn: '2026-11-03', estimatedHours: '8',
    }))).toEqual(outside);
    expect(await closePlan('PP-2026-011')).toEqual({});
    expect(await lastLog('prevention_plan', 'PP-2026-011')).toMatchObject({ action: 'status', summary: 'Plan clos', byId: 'jpetit' });
    auth.override = null;
    cookieJar.delete('vigie_site');
  });

  it('« Tous les sites » : une action porte un seul site ; création réservée au QHSE ; contrôle commun réservé au périmètre complet', async () => {
    const { saveAction } = await import('@/server/plan');
    const { saveControl } = await import('@/server/watch');
    const { ALL_SITES_RESERVED } = await import('@/lib/guard');
    const { QHSE_ONLY_CREATE_MESSAGE } = await import('@/lib/action-rules');
    const action = {
      source: 'comex', originRef: 'COMEX du 08/10/2026', pilotId: 'jpetit', priority: 'moyen_terme', dueOn: '2026-11-30', domain: 'securite',
      problem: 'Problème', detail: 'Action du site B', verifyDueOn: '2026-12-15',
    };
    actAs('Animateur QHSE', 'all');
    expect(await saveAction({}, form({ ...action, siteId: 'all' }))).toMatchObject({ fieldErrors: { siteId: expect.stringContaining('un seul site') } });
    expect(await saveAction({}, form({ ...action, siteId: 'ville-b' }))).toMatchObject({ ok: true });

    restricted();
    cookieJar.set('vigie_site', 'ville-b');
    expect(await saveAction({}, form({ ...action, siteId: 'ville-b' }))).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    expect(await saveControl({}, form({
      equipment: 'Extincteurs', controlType: 'Vérification annuelle', periodMonths: '12', organization: 'Prestataire', lastOn: '2026-09-01', siteId: '',
    }))).toEqual({ error: ALL_SITES_RESERVED, fieldErrors: { siteId: 'Site non autorisé.' } });
    auth.override = null;
    cookieJar.delete('vigie_site');
  });

  it('versions archivées du DUERP : instantané et décompte réduits au périmètre', async () => {
    const { createDuerpVersion } = await import('@/server/risks');
    const { loadDuerpVersion, loadRisks } = await import('@/lib/data/risks');
    actAs('Animateur QHSE', 'all');
    expect(await createDuerpVersion({}, form({ version: '2026.2', validatedById: 'hmarchand' }))).toMatchObject({ ok: true });
    const full = (await loadDuerpVersion('2026.1'))!.snapshot;
    expect(new Set(full.risks!.map((r) => r.siteId))).toEqual(new Set(['ville-a', 'ville-b']));

    restricted();
    cookieJar.set('vigie_site', 'ville-b');
    const own = (await loadDuerpVersion('2026.1'))!.snapshot;
    expect(own.risks!.length).toBeGreaterThan(0);
    expect(own.risks!.every((r) => r.siteId === 'ville-b' || r.siteId === null)).toBe(true);
    expect(own.units!.every((u) => u.siteId === 'ville-b' || u.siteId === null)).toBe(true);
    expect(own.risks!.length).toBeLessThan(full.risks!.length);
    const { versions } = await loadRisks();
    expect(versions.find((v) => v.version === '2026.1')?.riskCount).toBe(own.risks!.length);
    auth.override = null;
    cookieJar.delete('vigie_site');
  });

  it('pièces jointes : lecture refusée hors périmètre', async () => {
    const { canReadAttachment } = await import('@/lib/uploads');
    const row = { id: 'x', entityType: 'prevention_plan', entityId: 'PP-2026-016', fileName: 'a.pdf', mimeType: 'application/pdf', size: 1, storagePath: 'x', uploadedBy: null, createdAt: new Date(), health: false };
    expect(await canReadAttachment(row, { role: 'Chef de service', user: { id: 'jpetit' }, allowedSiteIds: ['ville-b'] })).toBe(false);
    expect(await canReadAttachment({ ...row, entityId: 'PP-2026-014' }, { role: 'Chef de service', user: { id: 'jpetit' }, allowedSiteIds: ['ville-b'] })).toBe(true);
    expect(await canReadAttachment(row, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(true);
  });

  it('pièces jointes médicales : animateur QHSE et direction seulement (SEC-06)', async () => {
    const { canReadAttachment } = await import('@/lib/uploads');
    const row = { id: 'x', entityType: 'event', entityId: 'EV-2026-119', fileName: 'certificat.pdf', mimeType: 'application/pdf', size: 1, storagePath: 'x', uploadedBy: null, createdAt: new Date(), health: true };
    expect(await canReadAttachment(row, { role: 'Animateur QHSE', user: { id: 'clefevre' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(row, { role: 'Direction', user: { id: 'x' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(row, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(false);
    expect(await canReadAttachment(row, { role: 'Chef de projet', user: { id: 'x' }, allowedSiteIds: null })).toBe(false);
    expect(await canReadAttachment({ ...row, health: false }, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(true);
  });
});
