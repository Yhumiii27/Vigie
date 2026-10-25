import '../next-mocks';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { actAs, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { compareActions, isLate, parseActionFilters } from '@/lib/action-rules';
import { isOpenAvancement } from '@/lib/domain';
import { loadActionDetail, loadActionFormOptions, loadActionPlan, loadActionTargets } from '@/lib/data/actions';

// Vue générale du plan d'actions (spec § 16 ; plan du paquet 1, flux C) : filtres et alias de l'URL, tri, affichages,
// plan du site plus ses propres actions des autres sites, encadrement en lecture seule, Salarié limité à ses actions ;
// fiche (?action=) : fil, preuves et historique de cette action seulement, commentaire retiré, avertissement santé
// réservé au QHSE, sources lisibles selon le rôle ; éléments proposés par le sélecteur du formulaire (QHSE).

freshDemoDatabase();

const plan = (sp: Record<string, string> = {}) => loadActionPlan(parseActionFilters(sp));
const ids = async (sp: Record<string, string> = {}) => (await plan(sp)).items.map((a) => a.id);
const TODAY = '2026-10-09';

beforeAll(async () => {
  const db = await getDb();
  const base = { openedOn: '2026-10-01', initialDueOn: '2026-10-30', dueOn: '2026-10-30', verifyDueOn: '2026-11-30', status: 'a_faire' as const, priority: 'moyen_terme' as const, domain: 'securite' as const };
  await db.insert(t.actions).values([
    // Action du Salarié issue du signalement d'un collègue (EV-2026-130, [P. Roux]).
    { ...base, id: 'A-950', detail: 'Contrôler la dérive outil au poste CU-2', problem: 'Dérive outil.', source: 'evenement', originRef: 'EV-2026-130', eventId: 'EV-2026-130', siteId: 'ville-a', pilotId: 'tnguyen' },
    // Source sans fiche : référence seule.
    { ...base, id: 'A-951', detail: 'Rappeler le port des lunettes au poste de meulage', problem: 'Lunettes non portées.', source: 'causerie', originRef: 'Causerie du 02/10', siteId: 'ville-a', pilotId: 'edubois' },
    // Événement cité par la référence seulement (pas d'event_id) : lien retrouvé par la référence.
    { ...base, id: 'A-952', detail: 'Former les opérateurs à la mesure Ø45', problem: 'Mesure non maîtrisée.', source: 'evenement', originRef: 'EV-2026-130', siteId: 'ville-a', pilotId: 'lmoreau' },
  ]);
});

describe('filtres de la vue générale (URL)', () => {
  it('avancement : ouvertes, en retard (et ?retard=1), une valeur', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const all = (await plan()).items;
    const open = (await plan({ avancement: 'ouvertes' })).items;
    expect(open.length).toBeGreaterThan(5);
    expect(open.every((a) => isOpenAvancement(a.status))).toBe(true);
    expect(open.length).toBe(all.filter((a) => isOpenAvancement(a.status)).length);
    const late = await ids({ avancement: 'en_retard' });
    expect(late).toEqual(['A-203', 'A-198', 'A-201', 'A-205']);
    expect(await ids({ retard: '1' })).toEqual(late);
    const done = (await plan({ avancement: 'terminee' })).items;
    expect(done.map((a) => a.id).sort()).toEqual(['A-172', 'A-178', 'A-186', 'A-190']);
    expect(await ids({ avancement: 'inconnu' })).toEqual(all.map((a) => a.id)); // valeur invalide : sans filtre
  });

  it('responsable (alias ?pilote=), « Mes actions », source, priorité', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const lmoreau = await ids({ responsable: 'lmoreau' });
    expect(lmoreau.length).toBeGreaterThan(2);
    expect(await ids({ pilote: 'lmoreau' })).toEqual(lmoreau);
    const p = await plan({ mes: '1' });
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.items.every((a) => a.pilotId === 'clefevre' && a.mine)).toBe(true);
    expect(p.counts.mine).toBe(p.items.length);
    expect(await ids({ source: 'dechets' })).toEqual(expect.arrayContaining(['A-178', 'A-219']));
    expect((await plan({ source: 'dechets' })).items.every((a) => a.source === 'dechets')).toBe(true);
    expect((await plan({ priorite: 'urgent' })).items.every((a) => a.priority === 'urgent')).toBe(true);
    expect(await ids({ source: 'constructor' })).toEqual(await ids()); // clé héritée : ignorée
  });

  it('texte libre sans accents ni casse : numéro, problème, détail, référence d’origine', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await ids({ q: 'ELINGUES A œillets' })).toEqual(['A-214']);
    expect((await ids({ q: 'EV-2026-131' })).sort()).toEqual(['A-214', 'A-215']);
    expect(await ids({ q: 'a-217' })).toEqual(['A-217']);
    expect(await ids({ q: 'charge maximale' })).toEqual(['A-214']); // description du problème
  });

  it('à compléter (historique) ; Abandonnées (alias ?etat=annulees) ; vue ?vue=pilote', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await ids({ completer: '1', etat: 'historique' })).toEqual(['A-150']);
    expect((await plan({ etat: 'historique' })).counts.toComplete).toBe(1);
    expect(await ids({ etat: 'abandonnees' })).toEqual(['A-180']);
    expect(await ids({ etat: 'annulees' })).toEqual(['A-180']);
    expect(parseActionFilters({ vue: 'pilote' }).vue).toBe('responsable');
  });
});

describe('tri, affichages, totaux', () => {
  it('retards d’abord (jours de retard décroissants), puis date cible', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { items } = await plan();
    const late = items.filter((a) => isLate(a, TODAY));
    expect(items.slice(0, late.length)).toEqual(late);
    for (let i = 1; i < items.length; i++) expect(compareActions(items[i - 1], items[i], TODAY)).toBeLessThanOrEqual(0);
  });

  it('plan en cours : Vérifiées des 30 derniers jours ; historique : toutes ; jamais les Abandonnées hors leur affichage', async () => {
    actAs('Animateur QHSE', 'all');
    const current = await plan();
    expect(current.items.map((a) => a.id)).toEqual(expect.arrayContaining(['A-176', 'A-172', 'A-170']));
    expect(current.items.map((a) => a.id)).not.toEqual(expect.arrayContaining(['A-152']));
    expect(current.items.some((a) => ['A-150', 'A-152', 'A-158', 'A-180'].includes(a.id))).toBe(false);
    expect(current.counts).toMatchObject({ abandoned: 1, olderVerified: 3 });
    const history = await ids({ etat: 'historique' });
    expect(history).toEqual(expect.arrayContaining(['A-150', 'A-152', 'A-158', 'A-176']));
    expect(history).not.toContain('A-180');
  });

  it('totaux : pointage et coûts des actions affichées', async () => {
    actAs('Animateur QHSE', 'all');
    for (const sp of [{}, { etat: 'historique' }, { source: 'evenement' }] as Record<string, string>[]) {
      const { items, totals } = await plan(sp);
      const sum = (k: 'hours' | 'estimatedCost' | 'actualCost') => items.reduce((n, a) => n + (a[k] ?? 0), 0);
      expect(totals).toEqual({ hours: sum('hours'), estimatedCost: sum('estimatedCost'), actualCost: sum('actualCost') });
    }
    expect((await plan({ etat: 'historique' })).totals.hours).toBeGreaterThan(0);
  });

  it('les lignes ne portent ni fil, ni preuves, ni historique', async () => {
    actAs('Animateur QHSE', 'all');
    const { items } = await plan();
    const a214 = items.find((a) => a.id === 'A-214')!;
    expect(a214).not.toHaveProperty('comments');
    expect(a214).not.toHaveProperty('files');
    expect(a214).not.toHaveProperty('history');
    expect(JSON.stringify(items)).not.toContain('livraison prévue le 14/10'); // commentaire de A-214
  });
});

describe('lecteurs du plan', () => {
  it('Chef de service sur le site A : plan du site A, plus ses actions du site B, signalées', async () => {
    actAs('Chef de service', 'ville-a');
    const { items, responsables } = await plan();
    const a181 = items.find((a) => a.id === 'A-181');
    expect(a181).toMatchObject({ siteId: 'ville-b', mine: true, elsewhere: true });
    expect(items.some((a) => a.id === 'A-209')).toBe(false); // site B, autre responsable
    expect(items.some((a) => a.id === 'A-214')).toBe(true);
    expect(responsables.map(([id]) => id)).toEqual(expect.arrayContaining(['sbenali', 'lmoreau']));
  });

  it('encadrement : droits de lecture seule, aucune liste de formulaire ni élément proposé', async () => {
    actAs('Chef de projet', 'ville-a');
    expect(await loadActionFormOptions({ targets: true })).toEqual({ people: [], sites: [], today: TODAY });
    expect(await loadActionTargets()).toEqual([]);
    const { payload } = await loadActionDetail('A-214');
    expect(payload?.rights).toMatchObject({ qhse: false, responsible: false, canEdit: false, canMove: false, canVerify: false, canComment: false, canAttach: false, canLink: false });
    actAs('Chef de service', 'ville-a');
    const own = (await loadActionDetail('A-214')).payload!; // il en est responsable
    expect(own.rights).toMatchObject({ responsible: true, canEdit: false, canMove: false, canComment: true, canAttach: true });
  });

  it('QHSE : listes du formulaire, date du jour du serveur, éléments proposés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const options = await loadActionFormOptions({ targets: true });
    expect(options.today).toBe(TODAY);
    expect(options.people.length).toBeGreaterThan(5);
    expect(options.sites.map(([id]) => id)).toEqual(['ville-a']);
    expect(options.targets?.length).toBeGreaterThan(10);
    expect(await loadActionFormOptions()).not.toHaveProperty('targets');
  });

  it('Salarié : ses actions seulement, sur tous les affichages ; responsables = lui-même ; autres fiches introuvables', async () => {
    actAs('Salarié', 'ville-b');
    for (const etat of ['', 'historique', 'abandonnees']) {
      const p = await plan({ etat });
      expect(p.items.every((a) => a.pilotId === 'tnguyen'), etat).toBe(true);
      expect(p.responsables.every(([id]) => id === 'tnguyen'), etat).toBe(true);
    }
    expect((await ids()).sort()).toEqual(['A-215', 'A-950']); // site A, site B sélectionné
    expect(await ids({ responsable: 'sbenali' })).toEqual([]);
    expect(await loadActionDetail('A-214')).toEqual({ payload: null, elsewhere: null }); // même événement, autre responsable
    expect(await loadActionDetail('A-209')).toEqual({ payload: null, elsewhere: null }); // autre site
    expect(await loadActionDetail('A-999')).toEqual({ payload: null, elsewhere: null });
    const own = (await loadActionDetail('A-215')).payload!;
    expect(own.detail.id).toBe('A-215');
    expect(own.rights).toMatchObject({ responsible: true, canComment: true, canEdit: false });
    expect(await loadActionFormOptions({ targets: true })).toEqual({ people: [], sites: [], today: TODAY });
  });

  it('autre site du périmètre (hors les siennes) : pas de fiche, site nommé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await loadActionDetail('A-209')).toEqual({ payload: null, elsewhere: 'Site de [Ville B] — zone d\'essais' });
    expect((await loadActionDetail('A-203')).payload?.rights.elsewhere).toBe('Site de [Ville B] — zone d\'essais'); // la sienne
  });
});

describe('fiche (?action=)', () => {
  it('fil, preuves et historique de cette action seulement', async () => {
    actAs('Animateur QHSE', 'all');
    const d = (await loadActionDetail('A-214')).payload!.detail;
    expect(d.comments.map((c) => c.body)).toEqual([
      'Commande des élingues à œillets passée, livraison prévue le 14/10.',
      "Prévoir l'étiquetage CMU à la réception et retirer les élingues textiles du poste M3 le jour même.",
    ]);
    expect(d.files.map((f) => f.name)).toEqual(['bon-de-commande-elingues.pdf']);
    expect(d.history.length).toBeGreaterThan(0);
    const json = JSON.stringify(d);
    expect(json).not.toContain('mode-operatoire-retournement-v0.pdf'); // preuve de A-215
    expect(json).not.toContain('Premier jet du mode opératoire'); // commentaire de A-215
  });

  it('commentaire retiré : texte jamais renvoyé ; ses preuves au QHSE seulement, signalées', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const q = (await loadActionDetail('A-209')).payload!.detail;
    const withdrawn = q.comments.find((c) => c.withdrawn)!;
    expect(withdrawn.body).toBeNull();
    expect(withdrawn.withdrawn?.reason).toContain('joint par erreur');
    expect(withdrawn.files.map((f) => [f.name, f.commentWithdrawn])).toEqual([['releve-flexibles-be2.pdf', true]]);
    expect(JSON.stringify(q)).not.toContain('Relevé des flexibles joint.');
    actAs('Chef de service', 'ville-b');
    const c = (await loadActionDetail('A-209')).payload!.detail;
    expect(c.comments.find((x) => x.withdrawn)!.files).toEqual([]);
    expect(c.files.some((f) => f.name === 'releve-flexibles-be2.pdf')).toBe(false);
    const json = JSON.stringify(c);
    expect(json).not.toContain('Relevé des flexibles joint.');
    expect(json).not.toContain('releve-flexibles-be2.pdf'); // ni dans l'historique
  });

  it('avertissement santé (événement lié de type AT) : QHSE seulement', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadActionDetail('A-165')).payload!.detail.healthWarning).toBe(true);
    actAs('Chef de service', 'ville-a'); // responsable de A-165 (site B) : sa fiche, sans l'avertissement
    const own = (await loadActionDetail('A-165')).payload!;
    expect(own.detail.healthWarning).toBe(false);
    expect(own.rights.elsewhere).toBe('Site de [Ville B] — zone d\'essais');
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadActionDetail('A-214')).payload!.detail.healthWarning).toBe(false);
  });

  it('vérification : à l’état Vérifiée seulement', async () => {
    actAs('Animateur QHSE', 'all');
    const verified = (await loadActionDetail('A-176')).payload!.detail;
    expect(verified.efficacyNote).toBeTruthy();
    expect(verified.verifiedBy).toBeTruthy();
    expect(verified.closedOn).toBe('2026-10-02');
    expect(verified.followUps.map((f) => f.id)).toEqual(['A-222']);
    const done = (await loadActionDetail('A-190')).payload!.detail;
    expect(done).toMatchObject({ verifyMethod: null, efficacyNote: null, effective: null, verifiedBy: null, closedOn: null });
    const follow = (await loadActionDetail('A-221')).payload!.detail;
    expect(follow.follows).toMatchObject({ id: 'A-170', reason: 'non_efficace' });
    expect(follow.follows!.label).not.toBe('');
  });

  it('sources : événement déclaré par un autre (Salarié) = référence seule ; le sien : intitulé et lien', async () => {
    actAs('Salarié', 'all');
    const other = (await loadActionDetail('A-950')).payload!.detail;
    expect(other.sources).toEqual([{ kind: 'event', label: 'EV-2026-130', href: null }]);
    expect(JSON.stringify(other)).not.toContain("Cotes hors tolérance sur l'arbre de malaxeur");
    const own = (await loadActionDetail('A-215')).payload!.detail;
    expect(own.sources[0]).toMatchObject({ kind: 'event', label: 'EV-2026-131', href: '/evenements?sel=EV-2026-131' });
    expect(own.sources[0].detail).toBeTruthy();
    actAs('Animateur QHSE', 'all');
    expect((await loadActionDetail('A-950')).payload!.detail.sources[0]).toMatchObject({ label: 'EV-2026-130', href: '/evenements?sel=EV-2026-130' });
  });

  it('sources réelles (ACT-01) : document, enlèvement, filière, registre annuel, références sans fiche', async () => {
    actAs('Animateur QHSE', 'all');
    const sources = async (id: string) => (await loadActionDetail(id)).payload!.detail.sources;
    expect((await sources('A-208'))[0]).toMatchObject({ label: 'PR-QHSE-002', href: '/documents?doc=PR-QHSE-002' });
    expect((await sources('A-218'))[0]).toMatchObject({ label: 'FD-11 · 19/08/2026', href: expect.stringMatching(/^\/environnement\?annee=2026&filiere=FD-11&enlevement=\d+$/) });
    expect((await sources('A-219'))[0]).toMatchObject({ label: 'FD-04', href: '/environnement?onglet=filieres&filiere=FD-04' });
    expect(await sources('A-178')).toEqual([{ kind: 'reference', label: 'Registre des déchets 2026', href: '/environnement?vue=bsd-manquants&annee=2026' }]);
    expect(await sources('A-951')).toEqual([{ kind: 'reference', label: 'Causerie du 02/10', href: null }]);
    expect((await sources('A-952'))[0]).toMatchObject({ kind: 'event', label: 'EV-2026-130', href: '/evenements?sel=EV-2026-130' });
    // Action reprise sans site (« à compléter ») : lisible sur chaque site.
    actAs('Animateur QHSE', 'ville-a');
    const a150 = (await loadActionDetail('A-150')).payload!.detail;
    expect(a150).toMatchObject({ siteId: null, site: 'Site à compléter', toComplete: true });
    expect(a150.missing).toContain('siteId');
  });
});

describe('éléments proposés par le sélecteur du formulaire (QHSE)', () => {
  it('événements ouverts aux actions du site, réclamations client sous leur seule source, site et avertissement AT', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const targets = await loadActionTargets();
    const ev = (id: string) => targets.find((x) => x.value === `event:${id}`);
    expect(ev('EV-2026-124')).toBeUndefined(); // « Efficacité vérifiée » : refuse toute action
    expect(ev('EV-2026-118')).toBeUndefined();
    expect(ev('EV-2026-123')).toBeUndefined(); // classé sans suite
    expect(ev('EV-2026-129')).toBeUndefined(); // site B
    expect(ev('EV-2026-128')).toMatchObject({ siteId: 'ville-a', sources: ['reclamation_client'] });
    expect(ev('EV-2026-131')).toMatchObject({ siteId: 'ville-a', sources: ['evenement'] });
    expect(ev('EV-2026-131')?.healthWarning).toBeUndefined();
    expect(ev('EV-2026-127')).toMatchObject({ sources: ['evenement'], healthWarning: true });
    expect(targets.every((x) => x.label.length <= 80 && x.sources.length > 0)).toBe(true);
    expect(targets.some((x) => /^(qualification|preventionplan|permit):/.test(x.value))).toBe(false);
    const plan7 = targets.find((x) => x.value === 'plan:7');
    expect(plan7).toMatchObject({ siteId: null, sources: ['audit_fournisseur'] });
    expect(targets.find((x) => x.value.startsWith('requirement:'))?.sources).toEqual(['veille', 'dechets']);
    expect(targets.find((x) => x.value.startsWith('wastestream:'))).toMatchObject({ siteId: 'ville-a', sources: ['dechets'] });
    actAs('Animateur QHSE', 'ville-b');
    const b = await loadActionTargets();
    expect(b.find((x) => x.value === 'event:EV-2026-129')).toMatchObject({ siteId: 'ville-b' });
    expect(b.some((x) => x.value === 'event:EV-2026-131')).toBe(false);
  });

  it('élément d’un site archivé, risque d’une unité de travail archivée : non proposés', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    await db.insert(t.wasteStreams).values({
      id: 'FD-99', siteId: 'ville-c', label: 'Cartons du dépôt fermé', ewcCode: '15 01 01', treatmentCode: 'R3', channel: 'Recyclage', collector: 'Collecteur', destination: 'Centre de tri',
    });
    const before = await loadActionTargets();
    const risk = before.find((x) => x.value.startsWith('risk:'))!;
    expect(risk).toBeDefined();
    const [r] = await db.select({ unitId: t.risks.unitId }).from(t.risks).where(eq(t.risks.id, Number(risk.value.slice(5))));
    await db.update(t.workUnits).set({ archivedAt: new Date('2026-10-01T08:00:00Z'), archiveReason: 'Unité regroupée' }).where(eq(t.workUnits.id, r.unitId));
    try {
      const targets = await loadActionTargets();
      expect(targets.some((x) => x.value === 'wastestream:FD-99' || x.siteId === 'ville-c')).toBe(false);
      expect(targets.some((x) => x.value === risk.value)).toBe(false);
    } finally {
      await db.update(t.workUnits).set({ archivedAt: null, archiveReason: null }).where(eq(t.workUnits.id, r.unitId));
    }
  });

  it('élément à action unique déjà porté par une action ouverte : non proposé', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const controls = await db.select({ id: t.controls.id, actionId: t.controls.actionId }).from(t.controls);
    const statuses = new Map((await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions)).map((a) => [a.id, a.status]));
    const held = controls.filter((c) => c.actionId && !['verifiee', 'abandonnee'].includes(statuses.get(c.actionId) ?? ''));
    expect(held.length).toBeGreaterThan(0);
    const values = new Set((await loadActionTargets()).map((x) => x.value));
    for (const c of held) expect(values.has(`control:${c.id}`)).toBe(false);
  });
});
