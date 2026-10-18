import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadPrevention, loadPreventionCompliance, loadPreventionSignals } from '@/lib/data/prevention';
import { cancelPermit, closePlan, deliverPermit, recordPlanEeSignature, savePlan, setPermitCheck, signPlanEu } from '@/server/prevention';

// Lot 2, plans de prévention et permis (src/db/seeds/prevention.ts, jeu de démonstration au 09/10/2026, sites Seveso seuil
// haut « dès la première minute ») :
// - PRV-01 : écarts R. 4512-6 passés (plan signé après le début, intervention réalisée sans plan signé) dans les
//   indicateurs, jamais dans le badge ; signature tardive tracée ; clôture sans action QSE (actions immédiates, 15/10/2026) ; date de
//   début d'une intervention commencée modifiée avec un motif ;
// - PRV-02 : contenu réglementaire structuré (R. 4511-10, R. 4512-8, R. 4512-9) enregistré, journalisé, exigé pour signer ;
// - PRV-03 : date de délivrance d'un permis (fiche imprimable, registre).

freshDemoDatabase();

type PlanRow = typeof t.preventionPlans.$inferSelect;
const plan = async (id: string) => {
  const [row] = await (await getDb()).select().from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
  return row;
};
const setPlan = async (id: string, values: Partial<PlanRow>) => {
  await (await getDb()).update(t.preventionPlans).set(values).where(eq(t.preventionPlans.id, id));
};

/** Champs du formulaire de modification d'un plan, repris de la ligne en base (comme PlanForm), puis remplacés par `over`. */
const planForm = (p: PlanRow, over: Record<string, string> = {}) => form({
  id: p.id, contractorId: p.contractorId, siteId: p.siteId, title: p.title, location: p.location, startOn: p.startOn, endOn: p.endOn,
  estimatedHours: String(p.estimatedHours), dangerousWork: p.dangerousWork ? 'on' : '', keystoneProject: p.keystoneProject ?? '',
  inspectionOn: p.inspectionOn ?? '', interferenceRisks: p.interferenceRisks, measures: p.measures, ownerId: p.ownerId ?? '',
  eeHeadcount: p.eeHeadcount == null ? '' : String(p.eeHeadcount), eeSupervisor: p.eeSupervisor, subcontracting: p.subcontracting,
  dangerousPhases: p.dangerousPhases, equipment: p.equipment, workerInstructions: p.workerInstructions,
  emergencyOrganisation: p.emergencyOrganisation, coordination: p.coordination, sirPosts: p.sirPosts,
  ...over,
});

const GAP_KPI = 'Écarts R. 4512-6 sur 12 mois';
const kpi = async (label: string) => (await loadPrevention()).kpis.find((k) => k.label === label);
const planView = async (id: string) => (await loadPrevention()).plans.find((p) => p.id === id);
const OTHER_SITE = { error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' };
const DENIED = { error: 'Votre rôle ne permet pas cette modification.' };

describe('PRV-02 : contenu réglementaire du plan', () => {
  it('savePlan enregistre et journalise les sections (libellés de l’historique)', async () => {
    actAs('Animateur QHSE');
    const row = await plan('PP-2026-018'); // brouillon, contenu partiel
    const r = await savePlan({}, planForm(row, {
      eeHeadcount: '3', eeSupervisor: "[M. Lebrun], chef d'équipe maintenance levage", subcontracting: 'Aucun sous-traitant',
      equipment: "Nacelle de l'entreprise extérieure", workerInstructions: 'Accueil sécurité du site',
      emergencyOrganisation: 'SST de l’atelier usinage ; évacuation selon le plan affiché', coordination: 'Point quotidien avec [S. Benali]', sirPosts: 'Aucun poste',
    }));
    expect(r).toEqual({ ok: true, id: 'PP-2026-018' });
    expect(await plan('PP-2026-018')).toMatchObject({
      eeHeadcount: 3, subcontracting: 'Aucun sous-traitant', emergencyOrganisation: 'SST de l’atelier usinage ; évacuation selon le plan affiché', sirPosts: 'Aucun poste',
      dangerousPhases: row.dangerousPhases,
    });
    const log = await lastLog('prevention_plan', 'PP-2026-018');
    expect(log).toMatchObject({ action: 'update', summary: 'Plan modifié', byId: 'clefevre', reason: null });
    expect((log?.details as { field: string }[]).map((d) => d.field)).toEqual([
      'Effectif prévisible', "Responsable de l'intervention (entreprise extérieure)", 'Sous-traitance', 'Matériels et installations',
      'Instructions aux travailleurs', 'Premiers secours et évacuation', 'Coordination et commandement', 'Suivi individuel renforcé',
    ]);
    const view = await planView('PP-2026-018');
    expect(view).toMatchObject({ eeHeadcount: 3, contentMissing: [], contentStats: { filled: 9, total: 9 } });
  });

  it('validation : effectif entier de 1 à 10 000, longueur des sections', async () => {
    actAs('Animateur QHSE');
    const row = await plan('PP-2026-018');
    const before = (await changeLog('prevention_plan', 'PP-2026-018')).length;
    expect(await savePlan({}, planForm(row, { eeHeadcount: '0' }))).toMatchObject({ fieldErrors: { eeHeadcount: 'Minimum 1.' } });
    expect(await savePlan({}, planForm(row, { eeHeadcount: 'abc' }))).toMatchObject({ fieldErrors: { eeHeadcount: 'Nombre entier attendu.' } });
    expect(await savePlan({}, planForm(row, { eeHeadcount: '10 001' }))).toMatchObject({ fieldErrors: { eeHeadcount: 'Maximum 10000.' } });
    expect(await savePlan({}, planForm(row, { dangerousPhases: 'x'.repeat(4001) }))).toMatchObject({ fieldErrors: { dangerousPhases: '4000 caractères au maximum.' } });
    expect(await savePlan({}, planForm(row, { eeSupervisor: 'x'.repeat(201) }))).toMatchObject({ fieldErrors: { eeSupervisor: '200 caractères au maximum.' } });
    expect((await changeLog('prevention_plan', 'PP-2026-018')).length).toBe(before);
    expect((await plan('PP-2026-018')).eeHeadcount).toBe(3);
    // Effectif vide : non renseigné.
    expect(await savePlan({}, planForm(row, { eeHeadcount: '' }))).toEqual({ ok: true, id: 'PP-2026-018' });
    expect((await plan('PP-2026-018')).eeHeadcount).toBeNull();
  });

  it('signPlanEu refusée tant qu’une section exigée est vide (plan obligatoire), sans journal ; acceptée une fois complétée', async () => {
    actAs('Chef de service');
    await setPlan('PP-2026-016', { emergencyOrganisation: '' });
    const before = await changeLog('prevention_plan', 'PP-2026-016');
    expect(await signPlanEu('PP-2026-016')).toEqual({
      error: 'Complétez le contenu du plan (R. 4512-8 et R. 4512-9) avant de signer le plan : premiers secours et évacuation.',
    });
    expect(await changeLog('prevention_plan', 'PP-2026-016')).toEqual(before);
    expect((await plan('PP-2026-016')).signedEuOn).toBeNull();
    expect((await planView('PP-2026-016'))?.contentMissing).toEqual(['premiers secours et évacuation']);
    await setPlan('PP-2026-016', { emergencyOrganisation: "SST de l'atelier montage, défibrillateur à l'accueil" });
    expect(await signPlanEu('PP-2026-016')).toEqual({});
    expect(await lastLog('prevention_plan', 'PP-2026-016')).toMatchObject({ action: 'sign', summary: "Signé pour l'entreprise utilisatrice", byId: 'sbenali' });
  });

  it('recordPlanEeSignature refusée sans coordination et commandement', async () => {
    actAs('Chef de service');
    const { coordination } = await plan('PP-2026-013');
    await setPlan('PP-2026-013', { coordination: ' ' });
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-013', signedEeOn: '2026-10-03' }))).toEqual({
      error: 'Complétez le contenu du plan (R. 4512-8 et R. 4512-9) avant de recueillir les signatures : coordination et commandement.',
    });
    expect((await plan('PP-2026-013')).signedEeOn).toBeNull();
    await setPlan('PP-2026-013', { coordination });
  });

  it('plan non obligatoire (site sans la règle « dès la première minute », 8 h, sans travaux dangereux) : signé sans les sections', async () => {
    const db = await getDb();
    await db.update(t.sites).set({ ppFromFirstMinute: false }).where(eq(t.sites.id, 'ville-b'));
    try {
      actAs('Animateur QHSE', 'ville-b');
      const created = await savePlan({}, form({
        contractorId: 'EE-006', siteId: 'ville-b', title: 'Contrôle des blocs autonomes d’éclairage de sécurité', location: 'Bureaux',
        startOn: '2026-10-20', endOn: '2026-10-20', estimatedHours: '8', inspectionOn: '2026-10-09', measures: 'Accompagnement par le chef de zone.',
      }));
      expect(created).toEqual({ ok: true, id: 'PP-2026-019' });
      expect((await planView('PP-2026-019'))).toMatchObject({ mandatory: false, contentMissing: [], contentStats: { filled: 0, total: 9 } });
      expect(await signPlanEu('PP-2026-019')).toEqual({});
      expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-019', signedEeOn: '2026-10-09' }))).toEqual({ ok: true, id: 'PP-2026-019' });
      expect(await plan('PP-2026-019')).toMatchObject({ status: 'signe', firstSignedOn: '2026-10-09' });
    } finally {
      await db.update(t.sites).set({ ppFromFirstMinute: true }).where(eq(t.sites.id, 'ville-b'));
    }
  });

  it('plan signé : compléter une section vide conserve les signatures, modifier une section renseignée les efface', async () => {
    actAs('Animateur QHSE');
    await setPlan('PP-2026-017', { sirPosts: '' });
    const row = await plan('PP-2026-017');
    expect(row).toMatchObject({ signedEuOn: '2026-10-07', signedEeOn: '2026-10-07', firstSignedOn: '2026-10-07', status: 'signe' });
    expect(await savePlan({}, planForm(row, { sirPosts: 'Aucun poste' }))).toEqual({ ok: true, id: 'PP-2026-017' });
    expect(await plan('PP-2026-017')).toMatchObject({ sirPosts: 'Aucun poste', signedEuOn: '2026-10-07', signedEeOn: '2026-10-07', status: 'signe' });
    expect(await lastLog('prevention_plan', 'PP-2026-017')).toMatchObject({ summary: 'Plan modifié', details: [{ field: 'Suivi individuel renforcé', from: null, to: 'Aucun poste' }] });

    const signed = await plan('PP-2026-017');
    expect(await savePlan({}, planForm(signed, { dangerousPhases: `${signed.dangerousPhases} ; essais des RIA en charge` }))).toEqual({ ok: true, id: 'PP-2026-017' });
    expect(await plan('PP-2026-017')).toMatchObject({ signedEuOn: null, signedEeOn: null, firstSignedOn: '2026-10-07', status: 'a_signer' });
    expect(await lastLog('prevention_plan', 'PP-2026-017')).toMatchObject({ summary: 'Plan modifié, signatures effacées' });
  });
});

describe('PRV-01 : écarts R. 4512-6 passés, indicateurs seulement', () => {
  it('jeu de démonstration (site A) : 2 écarts en cours et PP-2026-008, signé le lendemain du démarrage', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await kpi(GAP_KPI)).toMatchObject({ value: '3', sub: 'dont 2 en cours', tone: 'danger', note: '1 plan signé après le démarrage (PP-2026-008)' });
    expect(await loadPreventionCompliance()).toEqual({
      gapCount: 3, currentGapCount: 2, pastGapCount: 1, tone: 'danger', href: '/prevention',
      label: '2 interventions sans plan signé · 1 écart passé sur 12 mois',
    });
    expect((await planView('PP-2026-008'))?.startGap).toEqual({ kind: 'signe_apres', label: "plan signé après le début de l'intervention", past: true, signedOn: '2026-04-14' });
    expect((await planView('PP-2026-013'))?.startGap).toMatchObject({ kind: 'non_signe', past: false }); // écart en cours
  });

  it('plan clos signé après le démarrage (PP-2026-012, site B) : compté dans l’indicateur et la veille, pas dans le badge', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const badge = (await loadPreventionSignals()).badge;
    expect(await kpi(GAP_KPI)).toMatchObject({ value: '0', sub: 'conforme', tone: 'ok' });
    // VEI-06 : l'indicateur de la veille couvre tout le périmètre (site A compris), quel que soit le site sélectionné.
    expect(await loadPreventionCompliance()).toMatchObject({ gapCount: 3, currentGapCount: 2, pastGapCount: 1 });

    await setPlan('PP-2026-012', { signedEuOn: '2026-09-22', signedEeOn: '2026-09-22', firstSignedOn: '2026-09-22' }); // début le 21/09
    expect(await kpi(GAP_KPI)).toMatchObject({ value: '1', sub: 'aucun en cours', tone: 'warn', note: '1 plan signé après le démarrage (PP-2026-012)' });
    const d = await loadPrevention();
    expect(d.plans.find((p) => p.id === 'PP-2026-012')?.startGap).toMatchObject({ kind: 'signe_apres', past: true, signedOn: '2026-09-22' });
    expect(d.pastGaps).toEqual([{
      id: 'PP-2026-012', title: expect.any(String), contractor: '[Entreprise Chaudronnerie Soudure]', startOn: '2026-09-21', kind: 'signe_apres',
      label: "plan signé après le début de l'intervention", href: '/prevention?plan=PP-2026-012',
    }]);
    expect(d.kpis.find((k) => k.label === 'Interventions sans plan signé')).toMatchObject({ value: '0' });
    expect(await loadPreventionCompliance()).toEqual({
      gapCount: 4, currentGapCount: 2, pastGapCount: 2, tone: 'danger', href: '/prevention',
      label: '2 interventions sans plan signé · 2 écarts passés sur 12 mois',
    });
    const signals = await loadPreventionSignals();
    expect(signals.badge).toBe(badge);
    expect(signals.todo.some((s) => s.title.startsWith('PP-2026-012'))).toBe(false);
  });

  it('signature tardive (PP-2026-015, commencée le 06/10) : tracée, puis clôture après les permis (aucune action QSE exigée)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    await setPlan('PP-2026-015', {
      inspectionOn: '2026-10-08', measures: 'Zone balisée sous la mezzanine ; permis de feu journalier.', subcontracting: 'Aucun sous-traitant',
      dangerousPhases: 'Soudage de platines en hauteur', equipment: "Postes de soudage de l'entreprise extérieure", workerInstructions: 'Permis de feu journalier',
      emergencyOrganisation: 'SST du magasin ; évacuation selon le plan affiché', coordination: 'Point quotidien avec [C. Lefèvre]', sirPosts: 'Aucun poste',
    });
    expect(await signPlanEu('PP-2026-015')).toEqual({});
    expect(await lastLog('prevention_plan', 'PP-2026-015')).toMatchObject({
      action: 'sign', byId: 'clefevre', summary: "Signé pour l'entreprise utilisatrice après le début de l'intervention (06/10/2026) : écart R. 4512-6",
    });
    expect((await plan('PP-2026-015')).firstSignedOn).toBeNull();
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-015', signedEeOn: '2026-10-09' }))).toEqual({ ok: true, id: 'PP-2026-015' });
    expect(await lastLog('prevention_plan', 'PP-2026-015')).toMatchObject({
      action: 'sign', summary: "Signature de l'entreprise extérieure enregistrée (09/10/2026), après le début de l'intervention : écart R. 4512-6",
    });
    expect(await plan('PP-2026-015')).toMatchObject({ status: 'signe', signedEuOn: '2026-10-09', signedEeOn: '2026-10-09', firstSignedOn: '2026-10-09' });
    const view = await planView('PP-2026-015');
    expect(view).toMatchObject({ missingSignature: false, startGap: { kind: 'signe_apres', past: true, signedOn: '2026-10-09' } });
    expect(view?.closeBlock).toBe('Permis rattachés encore actifs (PF-2026-032) : clôturez-les ou annulez-les avant de clore le plan.');
    // L'écart sort des écarts en cours et entre dans les écarts passés.
    expect(await kpi(GAP_KPI)).toMatchObject({ value: '3', sub: 'dont 1 en cours', note: '2 plans signés après le démarrage (PP-2026-015, PP-2026-008)' });

    expect(await closePlan('PP-2026-015')).toEqual({ error: 'Permis rattachés encore actifs (PF-2026-032) : clôturez-les ou annulez-les avant de clore le plan.' });
    expect(await cancelPermit({}, form({ id: 'PF-2026-032', reason: 'Soudage réalisé sous le permis du jour, demande en double' }))).toEqual({ ok: true, id: 'PF-2026-032' });
    expect(await closePlan('PP-2026-015')).toEqual({});
    expect(await lastLog('prevention_plan', 'PP-2026-015')).toMatchObject({ action: 'status', summary: 'Plan clos', byId: 'clefevre' });
  });

  it('signatures effacées puis recueillies à nouveau (PP-2025-041) : première signature conservée, pas d’écart', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const row = await plan('PP-2025-041');
    expect(await savePlan({}, planForm(row, { measures: `${row.measures} Accès aux fosses par l'escalier nord.` }))).toEqual({ ok: true, id: 'PP-2025-041' });
    expect(await plan('PP-2025-041')).toMatchObject({ signedEuOn: null, signedEeOn: null, firstSignedOn: '2025-12-12' });
    expect(await lastLog('prevention_plan', 'PP-2025-041')).toMatchObject({ summary: 'Plan modifié, signatures effacées', reason: null });
    expect((await planView('PP-2025-041'))?.startGap).toBeNull();

    expect(await signPlanEu('PP-2025-041')).toEqual({});
    expect(await lastLog('prevention_plan', 'PP-2025-041')).toMatchObject({ summary: "Signé pour l'entreprise utilisatrice" });
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2025-041', signedEeOn: '2026-10-09' }))).toEqual({ ok: true, id: 'PP-2025-041' });
    expect(await lastLog('prevention_plan', 'PP-2025-041')).toMatchObject({ summary: "Signature de l'entreprise extérieure enregistrée (09/10/2026)" });
    expect(await plan('PP-2025-041')).toMatchObject({ status: 'signe', firstSignedOn: '2025-12-12' });
    const d = await loadPrevention();
    expect(d.plans.find((p) => p.id === 'PP-2025-041')?.startGap).toBeNull();
    expect(d.pastGaps.map((g) => g.id)).not.toContain('PP-2025-041');
  });

  it('date de début d’une intervention commencée : motif obligatoire, conservé dans le journal', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const row = await plan('PP-2026-013'); // commencée le 05/10
    const before = (await changeLog('prevention_plan', 'PP-2026-013')).length;
    expect(await savePlan({}, planForm(row, { startOn: '2026-10-06' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect((await plan('PP-2026-013')).startOn).toBe('2026-10-05');
    expect((await changeLog('prevention_plan', 'PP-2026-013')).length).toBe(before);

    // Droits et site : refusés avant toute écriture, motif fourni.
    const reason = 'Arrivée de la nacelle reportée : intervention commencée le 06/10';
    actAs('Salarié', 'ville-a');
    expect(await savePlan({}, planForm(row, { startOn: '2026-10-06', reason }))).toEqual(DENIED);
    actAs('Chef de service', 'ville-b');
    expect(await savePlan({}, planForm(row, { startOn: '2026-10-06', reason }))).toEqual(OTHER_SITE);
    expect((await plan('PP-2026-013')).startOn).toBe('2026-10-05');

    actAs('Animateur QHSE', 'ville-a');
    // PRV-11 : l'activité de la carte rattachée (début le 05/10) ne serait plus couverte par le plan.
    expect(await savePlan({}, planForm(row, { startOn: '2026-10-06', reason }))).toMatchObject({
      fieldErrors: { startOn: "Activités de la carte rattachées avant cette date (« Maintenance du pont roulant 10 t (fins de course, câble) ») : modifiez leurs dates avant de réduire la période." },
    });
    await (await getDb()).update(t.siteActivities).set({ startOn: '2026-10-06' }).where(eq(t.siteActivities.title, 'Maintenance du pont roulant 10 t (fins de course, câble)'));
    expect(await savePlan({}, planForm(row, { startOn: '2026-10-06', reason }))).toEqual({ ok: true, id: 'PP-2026-013' });
    const log = await lastLog('prevention_plan', 'PP-2026-013');
    expect(log).toMatchObject({ action: 'update', reason, byId: 'clefevre', summary: 'Plan modifié, signatures effacées' });
    expect(log?.details).toContainEqual({ field: 'Début', from: '2026-10-05', to: '2026-10-06' });
    expect(await plan('PP-2026-013')).toMatchObject({ startOn: '2026-10-06', signedEuOn: null });

    // Intervention à venir : la date de début se modifie sans motif.
    const future = await plan('PP-2026-018');
    expect(await savePlan({}, planForm(future, { startOn: '2026-10-27' }))).toEqual({ ok: true, id: 'PP-2026-018' });
    expect(await lastLog('prevention_plan', 'PP-2026-018')).toMatchObject({ reason: null });
  });
});

describe('PRV-03 : date de délivrance des permis', () => {
  it('permis délivrés du jeu de démonstration : date du journal ; demande : aucune', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const permits = (await loadPrevention()).permits;
    expect(permits.find((p) => p.id === 'PF-2026-031')).toMatchObject({ issuer: '[S. Benali]', deliveredAt: '2026-10-06T07:15', deliveredLabel: '06/10/2026 à 07:15' });
    expect(permits.find((p) => p.id === 'PF-2026-028')).toMatchObject({ deliveredAt: null, deliveredLabel: null }); // annulé avant délivrance
  });

  it('deliverPermit (PE-2026-009, site B) : délivrance journalisée, date et auteur sur la fiche', async () => {
    actAs('Chef de service', 'ville-b');
    expect((await loadPrevention()).permits.find((p) => p.id === 'PE-2026-009')).toMatchObject({ status: 'demande', deliveredLabel: null });
    expect(await setPermitCheck('PE-2026-009', 4, true)).toEqual({});
    expect(await setPermitCheck('PE-2026-009', 5, true)).toEqual({});
    expect(await deliverPermit('PE-2026-009')).toEqual({});
    expect(await lastLog('permit', 'PE-2026-009')).toMatchObject({ action: 'status', summary: 'Permis délivré', byId: 'sbenali' });
    const permit = (await loadPrevention()).permits.find((p) => p.id === 'PE-2026-009');
    expect(permit).toMatchObject({ status: 'delivre', issuerId: 'sbenali', issuer: '[S. Benali]' });
    expect(permit?.deliveredLabel).toMatch(/^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/);
    expect(permit?.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
