import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionCount, actionRow, editFields, insertAction, logCount, NEW_ACTION, notificationsOf } from './actions-helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { NON_QSE_LINK_MESSAGE, QHSE_ONLY_CREATE_MESSAGE, VERIFY_BEFORE_DUE_WARNING } from '@/lib/action-rules';
import { saveAction } from '@/server/plan';

// Création et modification d'une action (ACT-20, ACT-22, ACT-30, ACT-35, D15, D16, D17, D20, D24) : service QHSE
// seulement, source imposée par l'élément lié, un seul site actif du périmètre, numéro « A-n » suivant, journal détaillé,
// notification « Action confiée » au responsable.

freshDemoDatabase();

const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const create = (extra: Record<string, string> = {}) => saveAction({}, form({ ...NEW_ACTION, ...extra }));
const created = async (extra: Record<string, string> = {}) => {
  const r = await create(extra);
  expect(r, JSON.stringify(extra)).toMatchObject({ ok: true });
  return actionRow(r.id!);
};

describe('création : droits (ACT-22, service QHSE seulement)', () => {
  it.each(['Chef de service', 'Chef de projet', 'Salarié'] as const)('%s : refusée, depuis le plan comme depuis un écran source', async (role) => {
    actAs(role);
    const before = await actionCount();
    expect(await create()).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    expect(await create({ source: 'evenement', link: 'event:EV-2026-131', originRef: '' })).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    expect(await actionCount()).toBe(before);
  });

  it('QHSE : numéro suivant, ouverture du jour, date cible initiale, À faire, journal détaillé, notification au responsable', async () => {
    actAs('Animateur QHSE');
    const r = await create();
    expect(r).toEqual({ ok: true, id: 'A-223' });
    expect(await actionRow('A-223')).toMatchObject({
      openedOn: '2026-10-09', status: 'a_faire', dueOn: '2026-11-15', initialDueOn: '2026-11-15', source: 'comex', originRef: 'COMEX du 08/10/2026',
      pilotId: 'sbenali', priority: 'moyen_terme', domain: 'securite', verifyDueOn: '2026-12-01', siteId: 'ville-a', riskLevel: null, eventId: null,
    });
    const log = await lastLog('action', 'A-223');
    expect(log).toMatchObject({ action: 'create', summary: 'Action créée', byId: 'clefevre' });
    expect(log!.details).toEqual(expect.arrayContaining([
      { field: 'Responsable', from: null, to: '[S. Benali]' }, { field: 'Source', from: null, to: 'COMEX' }, { field: 'Date cible', from: null, to: '15/11/2026' },
      { field: 'Site', from: null, to: 'Site de [Ville A]' }, { field: 'Description du problème', from: null, to: '(texte saisi)' },
    ]));
    const [n] = (await notificationsOf('sbenali')).filter((x) => x.entityId === 'A-223');
    expect(n).toMatchObject({ type: 'action_confiee', title: 'Action A-223 confiée par [C. Lefèvre] : Mettre en place le suivi mensuel', href: '/actions?action=A-223', byId: 'clefevre', readAt: null });
    // Responsable = auteur : pas de notification.
    const own = await created({ pilotId: 'clefevre' });
    expect(own.id).toBe('A-224');
    expect((await notificationsOf('clefevre')).some((x) => x.entityId === own.id)).toBe(false);
    // Direction : QHSE aussi (§ 22.17).
    actAs('Direction');
    expect((await created()).id).toBe('A-225');
  });
});

describe('création : champs, dates, responsable (§ 4, D24)', () => {
  it('champs obligatoires, référence d’origine sans élément, 4 000 caractères', async () => {
    actAs('Animateur QHSE');
    const before = await actionCount();
    const r = await saveAction({}, form({ siteId: 'ville-a' }));
    expect(r).toMatchObject({ error: 'Certains champs sont à corriger.' });
    expect(Object.keys(r.fieldErrors!)).toEqual(expect.arrayContaining(['source', 'pilotId', 'priority', 'dueOn', 'domain', 'problem', 'detail', 'verifyDueOn', 'originRef']));
    expect(await create({ originRef: '' })).toMatchObject({ fieldErrors: { originRef: expect.stringContaining("référence d'origine") } });
    expect(await create({ detail: 'x'.repeat(4001) })).toMatchObject({ fieldErrors: { detail: '4000 caractères au maximum.' } });
    expect(await create({ originRef: 'x'.repeat(121) })).toMatchObject({ fieldErrors: { originRef: '120 caractères au maximum.' } });
    expect(await create({ estimatedCost: '12,345' })).toMatchObject({ fieldErrors: { estimatedCost: '2 décimales au maximum.' } });
    expect(await create({ riskLevel: '5' })).toMatchObject({ fieldErrors: { riskLevel: 'Maximum 4.' } });
    expect(await actionCount()).toBe(before);
  });

  it('dates : date cible passée refusée, vérification avant la date cible signalée sans refus', async () => {
    actAs('Animateur QHSE');
    expect(await create({ dueOn: '2026-10-08' })).toMatchObject({ fieldErrors: { dueOn: expect.stringContaining('date d\'ouverture') } });
    expect(await create({ verifyDueOn: '2026-10-01' })).toMatchObject({ fieldErrors: { verifyDueOn: expect.any(String) } });
    const r = await create({ dueOn: '2026-12-15', verifyDueOn: '2026-11-30', estimatedCost: '1 250,50', riskLevel: '2' });
    expect(r).toMatchObject({ ok: true, warnings: [VERIFY_BEFORE_DUE_WARNING] });
    expect(await actionRow(r.id!)).toMatchObject({ estimatedCost: 1250.5, riskLevel: 2 });
  });

  it('responsable sorti de l’effectif ou inconnu : refusé', async () => {
    actAs('Animateur QHSE');
    expect(await create({ pilotId: 'ylambert' })).toMatchObject({ fieldErrors: { pilotId: expect.stringContaining("sortie de l'effectif") } });
    expect(await create({ pilotId: 'inconnu' })).toMatchObject({ fieldErrors: { pilotId: 'Personne inconnue.' } });
  });

  it('site : obligatoire, jamais « Tous les sites », ni archivé, ni autre que le site sélectionné', async () => {
    actAs('Animateur QHSE', 'all');
    const before = await actionCount();
    expect(await create({ siteId: '' })).toMatchObject({ fieldErrors: { siteId: 'Champ obligatoire.' } });
    expect(await create({ siteId: 'all' })).toMatchObject({ fieldErrors: { siteId: expect.stringContaining('un seul site') } });
    expect(await create({ siteId: 'ville-c' })).toMatchObject({ error: 'Site archivé ou inconnu : choisissez un site actif.' });
    actAs('Animateur QHSE', 'ville-a');
    expect(await create({ siteId: 'ville-b' })).toMatchObject({ error: OTHER_SITE });
    expect(await actionCount()).toBe(before);
  });
});

describe('création : élément lié et source imposée (D15, D20)', () => {
  it('événement : Évènement QSE ou Réclamation client selon le type, référence par défaut, site de l’événement', async () => {
    actAs('Animateur QHSE', 'all');
    const before = await actionCount();
    const mismatch = { error: "Source incompatible avec l'élément lié.", fieldErrors: { source: "Source incompatible avec l'élément lié." } };
    expect(await create({ link: 'event:EV-2026-128', source: 'evenement', originRef: '' })).toEqual(mismatch);
    expect(await create({ link: 'event:EV-2026-131', source: 'reclamation_client', originRef: '' })).toEqual(mismatch);
    expect(await create({ link: 'event:EV-2026-131', source: 'comex', originRef: '' })).toEqual(mismatch);
    expect(await create({ link: 'event:EV-2026-129', source: 'evenement', originRef: '', siteId: 'ville-a' })).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    expect(await actionCount()).toBe(before);
    const a = await created({ link: 'event:EV-2026-131', source: 'evenement', originRef: '' });
    expect(a).toMatchObject({ eventId: 'EV-2026-131', originRef: 'EV-2026-131', source: 'evenement', siteId: 'ville-a' });
    expect(await created({ link: 'event:EV-2026-128', source: 'reclamation_client', originRef: 'Réclamation [Client C]' })).toMatchObject({ eventId: 'EV-2026-128', originRef: 'Réclamation [Client C]' });
  });

  it('événement fermé aux actions : création annulée, numéro non consommé', async () => {
    actAs('Animateur QHSE', 'all');
    const before = await actionCount();
    const logs = await logCount();
    const r = await create({ link: 'event:EV-2026-124', source: 'evenement', originRef: '' });
    expect(r).toMatchObject({ error: expect.stringContaining('Efficacité vérifiée'), fieldErrors: { link: expect.any(String) } });
    expect(await create({ link: 'event:EV-2026-123', source: 'evenement', originRef: '' })).toMatchObject({ error: 'Événement classé sans suite : rattachement impossible.' });
    expect(await actionCount()).toBe(before);
    expect(await logCount()).toBe(logs);
    const next = await created();
    const numbers = (await (await getDb()).select({ id: t.actions.id }).from(t.actions)).map((x) => Number(x.id.slice(2))).filter(Number.isFinite);
    expect(Number(next.id.slice(2))).toBe(Math.max(...numbers));
  });

  it('audit : source selon la ligne du programme (Certification, Fournisseurs, Audits internes), journal du constat', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await create({ link: 'finding:3', source: 'duerp', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    expect(await create({ link: 'plan:6', source: 'audit_terrain', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    expect(await create({ link: 'plan:7', source: 'audit_interne', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    const f = await created({ link: 'finding:3', source: 'audit_interne', originRef: '' });
    expect(f.originRef).toMatch(/^Constat · /);
    const findingActions = async () => (await (await getDb()).select().from(t.findingActions).where(eq(t.findingActions.findingId, 3))).map((x) => x.actionId).sort();
    expect(await findingActions()).toEqual([f.id]);
    expect(await lastLog('audit_finding', 3)).toMatchObject({ action: 'link', summary: `Action ${f.id} créée et rattachée`, byId: 'clefevre' });
    expect(await created({ link: 'plan:6', source: 'audit_certification', originRef: '' })).toMatchObject({ originRef: 'Programme 2026 · Audit de suivi ISO 9001' });
    expect(await created({ link: 'plan:7', source: 'audit_fournisseur', originRef: '' })).toMatchObject({ source: 'audit_fournisseur' });
    // AUD-28 (changement volontaire : un constat portait une seule action) : plusieurs actions par constat, la première
    // reste rattachée.
    const second = await created({ link: 'finding:3', source: 'audit_interne', originRef: '' });
    expect(await findingActions()).toEqual([f.id, second.id].sort());
    expect(await lastLog('audit_finding', 3)).toMatchObject({ action: 'link', summary: `Action ${second.id} créée et rattachée` });
  });

  it('risque, exigence, contrôle, décision de revue, version de document', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    expect(await create({ link: 'risk:3', source: 'comex', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    const r = await created({ link: 'risk:3', source: 'duerp', originRef: '' });
    expect(r.originRef).toMatch(/^DUERP · /);
    expect(await db.select().from(t.riskActions).where(eq(t.riskActions.actionId, r.id))).toEqual([{ riskId: 3, actionId: r.id }]);
    expect(await lastLog('risk', 3)).toMatchObject({ action: 'link', summary: `Action ${r.id} créée et rattachée` });

    expect(await create({ link: 'requirement:2', source: 'hazop', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    expect(await created({ link: 'requirement:2', source: 'veille', originRef: '' })).toMatchObject({ source: 'veille' });
    expect(await created({ link: 'requirement:3', source: 'dechets', originRef: '' })).toMatchObject({ source: 'dechets' });

    expect(await create({ link: 'control:2', source: 'veille', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    const c = await created({ link: 'control:2', source: 'controle_reglementaire', originRef: '' });
    expect((await db.select().from(t.controls).where(eq(t.controls.id, 2)))[0].actionId).toBe(c.id);

    const [d] = await db.insert(t.reviewDecisions).values({ reviewId: 3, kind: 'objectif', text: 'Taux de remontée des presque-accidents ≥ 2 par mois' }).returning();
    expect(await create({ link: `reviewdecision:${d.id}`, source: 'revue_direction', originRef: '' })).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    const o = await created({ link: `reviewdecision:${d.id}`, source: 'objectif', originRef: '' });
    expect(o).toMatchObject({ reviewId: 3, originRef: expect.stringMatching(/^Décision de revue · /) });

    // Version de document : la création pose aussi le document de l'action (ACT-01).
    const v = await created({ link: 'docversion:23', source: 'revue_documentaire', originRef: '' });
    expect(v).toMatchObject({ documentId: 'IT-USI-004', originRef: 'IT-USI-004 · version A' });
    expect((await db.select().from(t.documentVersions).where(eq(t.documentVersions.id, 23)))[0].actionId).toBe(v.id);
  });

  it('habilitation, plan de prévention, permis : aucune action QSE ; type inconnu refusé', async () => {
    actAs('Animateur QHSE', 'all');
    const before = await actionCount();
    for (const link of ['qualification:tnguyen:sst', 'preventionplan:PP-2026-015', 'permit:PF-2026-031']) {
      expect(await create({ link, source: 'comex', originRef: '' })).toMatchObject({ fieldErrors: { link: NON_QSE_LINK_MESSAGE } });
    }
    expect(await create({ link: 'inconnu:1', originRef: '' })).toMatchObject({ fieldErrors: { link: 'Type de rattachement inconnu.' } });
    expect(await create({ link: 'risk:9999', source: 'duerp', originRef: '' })).toMatchObject({ error: 'Élément introuvable : le rattachement est impossible.' });
    expect(await actionCount()).toBe(before);
  });
});

describe('modification (QHSE, D16, D17, D24)', () => {
  it('rôles hors QHSE refusés ; abandonnée en consultation seule ; avancement affiché périmé', async () => {
    const a214 = await actionRow('A-214');
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await saveAction({}, form(editFields(a214, { detail: 'Autre' })))).toEqual({ error: APPROVERS_ONLY });
    }
    actAs('Animateur QHSE');
    expect(await saveAction({}, form(editFields(await actionRow('A-180'), { detail: 'Autre' })))).toEqual({ error: 'Action abandonnée : consultation seule.' });
    expect(await saveAction({}, form(editFields(a214, { from: 'a_faire', detail: 'Autre' })))).toEqual({ error: "L'action a changé entre-temps : la fiche est actualisée." });
    expect((await actionRow('A-214')).detail).toBe(a214.detail);
  });

  it('tous les champs journalisés, textes sans contenu ; modification vide : rien écrit', async () => {
    actAs('Animateur QHSE');
    const a = await actionRow('A-214');
    const logs = (await changeLog('action', 'A-214')).length;
    expect(await saveAction({}, form(editFields(a)))).toEqual({ ok: true, id: 'A-214' });
    expect((await changeLog('action', 'A-214')).length).toBe(logs);
    expect(await saveAction({}, form(editFields(a, { priority: 'long_terme', dueOn: '2026-10-30', detail: `${a.detail}\nPrécision`, riskLevel: '2', actualCost: '120' })))).toEqual({ ok: true, id: 'A-214' });
    expect(await actionRow('A-214')).toMatchObject({ priority: 'long_terme', dueOn: '2026-10-30', initialDueOn: '2026-10-17', riskLevel: 2, actualCost: 120 });
    const log = await lastLog('action', 'A-214');
    expect(log).toMatchObject({ action: 'update', byId: 'clefevre', summary: "Modifiée : priorité, date cible, détail de l'action, niveau de risque, coût réel" });
    expect(log!.details).toEqual([
      { field: 'Priorité', from: 'Urgent', to: 'Long terme' }, { field: 'Date cible', from: '17/10/2026', to: '30/10/2026' },
      { field: "Détail de l'action", from: '(texte précédent)', to: '(texte modifié)' }, { field: 'Niveau de risque', from: 'Niveau 3 — Maîtrise en cours', to: 'Niveau 2 — Maîtrisé ponctuellement' },
      { field: 'Coût réel', from: null, to: '120 €' },
    ]);
  });

  it('source : posée une fois (ignorée ensuite), complétée si vide et contrôlée par l’élément lié', async () => {
    actAs('Animateur QHSE');
    const a = await actionRow('A-212');
    expect(await saveAction({}, form(editFields(a, { source: 'comex' })))).toEqual({ ok: true, id: 'A-212' });
    expect((await actionRow('A-212')).source).toBe('evenement');
    const raw = await insertAction('A-T01', { source: null });
    await (await getDb()).insert(t.findingActions).values({ findingId: 5, actionId: 'A-T01' });
    expect(await saveAction({}, form(editFields(raw, { source: '' })))).toMatchObject({ fieldErrors: { source: 'Champ obligatoire.' } });
    expect(await saveAction({}, form(editFields(raw, { source: 'comex' })))).toMatchObject({ fieldErrors: { source: "Source incompatible avec l'élément lié." } });
    expect(await saveAction({}, form(editFields(raw, { source: 'audit_interne' })))).toEqual({ ok: true, id: 'A-T01' });
    expect(await lastLog('action', 'A-T01')).toMatchObject({ details: [{ field: 'Source', from: null, to: 'Audit interne ISO' }] });
  });

  it('site à compléter (A-150), transfert (QHSE), jamais hors du site de l’élément lié', async () => {
    actAs('Animateur QHSE', 'all');
    const a150 = await actionRow('A-150');
    expect(await saveAction({}, form(editFields(a150, { estimatedCost: '10' })))).toMatchObject({ fieldErrors: { siteId: 'Champ obligatoire.' } });
    expect(await saveAction({}, form(editFields(a150, { siteId: 'ville-a' })))).toEqual({ ok: true, id: 'A-150' });
    expect((await actionRow('A-150')).siteId).toBe('ville-a');
    expect(await saveAction({}, form(editFields(await actionRow('A-214'), { siteId: 'ville-b' })))).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    const raw = await insertAction('A-T02');
    expect(await saveAction({}, form(editFields(raw, { siteId: 'ville-c' })))).toMatchObject({ error: 'Site archivé ou inconnu : choisissez un site actif.' });
    expect(await saveAction({}, form(editFields(raw, { siteId: 'ville-b' })))).toEqual({ ok: true, id: 'A-T02' });
    expect(await lastLog('action', 'A-T02')).toMatchObject({ details: [{ field: 'Site', from: 'Site de [Ville A]', to: 'Site de [Ville B]' }] });
  });

  it('action d’un autre site que le site sélectionné : refusée, rien écrit', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const a = await actionRow('A-215');
    const logs = (await changeLog('action', 'A-215')).length;
    expect(await saveAction({}, form(editFields(a, { priority: 'urgent' })))).toEqual({ error: OTHER_SITE });
    expect((await actionRow('A-215')).priority).toBe('moyen_terme');
    expect((await changeLog('action', 'A-215')).length).toBe(logs);
  });

  it('Vérifiée : coûts et pointage modifiables, vérification planifiée figée', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const a = await actionRow('A-165');
    expect(await saveAction({}, form(editFields(a, { actualCost: '1500', hours: '12,5', verifyDueOn: '2026-12-31' })))).toEqual({ ok: true, id: 'A-165' });
    expect(await actionRow('A-165')).toMatchObject({ actualCost: 1500, hours: 12.5, verifyDueOn: '2026-09-26' });
  });

  it('nouveau responsable : notifié (§ 22.15)', async () => {
    actAs('Animateur QHSE');
    const a = await actionRow('A-215');
    expect(await saveAction({}, form(editFields(a, { pilotId: 'lmoreau' })))).toEqual({ ok: true, id: 'A-215' });
    expect(await lastLog('action', 'A-215')).toMatchObject({ details: [{ field: 'Responsable', from: '[T. Nguyen]', to: '[L. Moreau]' }] });
    expect((await notificationsOf('lmoreau')).at(-1)).toMatchObject({ type: 'action_confiee', entityId: 'A-215', title: expect.stringContaining('Action A-215 confiée par [C. Lefèvre]') });
    expect(await saveAction({}, form(editFields(await actionRow('A-215'), { pilotId: 'ylambert' })))).toMatchObject({ fieldErrors: { pilotId: expect.any(String) } });
  });
});
