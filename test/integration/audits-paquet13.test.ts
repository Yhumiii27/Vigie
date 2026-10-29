import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { loadAuditProgramPrint, loadAuditSignals, loadAudits } from '@/lib/data/audits';
import { loadReviewDossierPage } from '@/lib/data/review';
import { loadVisibleTodo } from '@/lib/data/todo';
import { convertFreeAudit, hideTrack, renameTrack, renewProgram, reschedulePlanItem, saveCertification, saveFinding, savePlanItem, showTrack, cancelPlanItem } from '@/server/audits';
import { saveAction } from '@/server/plan';
import { NEW_ACTION } from './actions-helpers';

// Paquet 13, seconde moitié — audits : audits hors programme (AUD-20), plusieurs éléments par ligne et par mois (AUD-21),
// rattachement au site (AUD-22), lignes et reconduction (AUD-24), impression (AUD-26), auditeur interne (AUD-27),
// constats fournisseurs au dossier (AUD-33). Droits par rôle et site, motif, journal ; échéances par site.

freshDemoDatabase();

const db = () => getDb();
const DENIED = 'Votre rôle ne permet pas cette modification.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';

async function planItem(label: string) {
  const [p] = await (await db()).select().from(t.auditPlanItems).where(eq(t.auditPlanItems.label, label));
  if (!p) throw new Error(`élément ${label} introuvable`);
  return p;
}

describe('jeu de démonstration (migration 0021)', () => {
  it('audit client hors programme du site A, auditeur interne lié, second élément d’octobre', async () => {
    const client = await planItem('Client A');
    expect(client).toMatchObject({ unplanned: true, done: true, siteId: 'ville-a', track: 'Audits clients' });
    expect(await planItem('BE · 17/10')).toMatchObject({ auditorId: 'lmoreau', auditor: null });
    const october = (await (await db()).select().from(t.auditPlanItems).where(and(eq(t.auditPlanItems.track, 'Visites sécurité'), eq(t.auditPlanItems.month, 10))));
    expect(october.map((p) => p.label).sort()).toEqual(['Essais 12/10', 'Magasin · 29/10']);
  });
});

describe('AUD-20 : audits hors programme en vrais audits', () => {
  it('enregistré réalisé à sa date (année et mois déduits), hors échéances ; plus de constat à libellé libre', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await savePlanItem({}, form({ unplanned: '1', track: 'Audits clients', label: 'Client B', siteId: 'all' })))
      .toMatchObject({ fieldErrors: { doneOn: 'Date obligatoire.' } });
    expect(await savePlanItem({}, form({ unplanned: '1', track: 'Audits clients', label: 'Client B', doneOn: '2026-10-10', siteId: 'all' })))
      .toMatchObject({ fieldErrors: { doneOn: 'Date de réalisation future.' } });
    const r = await savePlanItem({}, form({ unplanned: '1', track: 'Audits clients', label: 'Client B', detail: 'Audit client [Client B]', doneOn: '2026-09-15', auditor: '[Auditeur client B]', siteId: 'ville-b' }));
    expect(r).toMatchObject({ ok: true });
    const item = await planItem('Client B');
    expect(item).toMatchObject({ year: 2026, month: 9, plannedOn: '2026-09-15', done: true, doneOn: '2026-09-15', unplanned: true, siteId: 'ville-b' });
    expect(await lastLog('audit_plan_item', item.id)).toMatchObject({ action: 'create', summary: 'Audit hors programme enregistré (Audits clients, réalisé le 15/09/2026)' });
    // Hors échéances du programme (réalisé) ; proposé au rattachement des constats.
    expect((await loadAuditSignals()).todo.some((x) => x.href?.endsWith(`element=${item.id}`))).toBe(false);
    const audits = await loadAudits({ year: '2026' });
    expect(audits.auditOptions.find(([v]) => v === String(item.id))?.[1]).toBe('Audit client [Client B] · septembre 2026 · hors programme');
    // Nouveau constat sans audit : refusé ; constat de l'audit hors programme : site de l'audit.
    expect(await saveFinding({}, form({ planItemId: '__other', audit: 'Audit client libre', kind: 'piste', text: 'x' })))
      .toMatchObject({ fieldErrors: { planItemId: expect.stringContaining('Rattachez le constat à un audit') } });
    expect(await saveFinding({}, form({ planItemId: String(item.id), kind: 'observation', text: 'Étiquetage des colis' }))).toMatchObject({ ok: true });
    const [f] = await (await db()).select().from(t.auditFindings).where(eq(t.auditFindings.text, 'Étiquetage des colis'));
    expect(f).toMatchObject({ planItemId: item.id, siteId: 'ville-b', foundOn: '2026-09-15' });
    // Saisi par erreur sans rapport, constat ni action : annulable (motif) ; avec un constat : refusé.
    expect(await cancelPlanItem({}, form({ id: String(item.id), reason: 'Doublon' }))).toMatchObject({ error: expect.stringContaining('Des constats ou un rapport') });
  });

  it('constats à libellé libre (antérieurs) : enregistrés comme un audit hors programme, journal de chacun', async () => {
    actAs('Animateur QHSE', 'all');
    const d = await db();
    const [legacy] = await d.insert(t.auditFindings).values({ audit: 'Audit client ancien', kind: 'piste', text: 'Ancien constat libre', foundOn: '2026-03-02' }).returning();
    // Un constat à libellé libre existant reste modifiable avec son libellé.
    expect(await saveFinding({}, form({ id: String(legacy.id), planItemId: '__other', audit: 'Audit client ancien', kind: 'piste', text: 'Ancien constat libre (corrigé)' }))).toMatchObject({ ok: true });
    actAs('Chef de service', 'ville-a');
    expect(await convertFreeAudit({}, form({ audit: 'Audit client ancien', track: 'Audits clients', label: 'Ancien', doneOn: '2026-03-02', siteId: 'ville-a' }))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-a');
    const r = await convertFreeAudit({}, form({ audit: 'Audit client ancien', track: 'Audits clients', label: 'Ancien', doneOn: '2026-03-02', auditorId: 'lmoreau', siteId: 'ville-a' }));
    expect(r).toMatchObject({ ok: true });
    const [after] = await d.select().from(t.auditFindings).where(eq(t.auditFindings.id, legacy.id));
    expect(after).toMatchObject({ planItemId: Number(r.id), siteId: 'ville-a', audit: 'Audit client ancien · mars 2026' });
    expect(await lastLog('audit_finding', legacy.id)).toMatchObject({ summary: "Rattaché à l'audit hors programme « Audit client ancien · mars 2026 »" });
    expect(await convertFreeAudit({}, form({ audit: 'Audit client ancien', track: 'Audits clients', label: 'Ancien', doneOn: '2026-03-02', siteId: 'ville-a' }))).toEqual({ error: 'Aucun constat sans audit sous ce libellé.' });
  });
});

describe('AUD-21 : plusieurs éléments par ligne et par mois', () => {
  it('ajout et report dans un mois déjà occupé sur la ligne', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await savePlanItem({}, form({ year: '2026', track: 'Fournisseurs', month: '11', label: '[Fourn. H]', siteId: 'all' }))).toMatchObject({ ok: true });
    const g = await planItem('[Fourn. G]');
    expect(await reschedulePlanItem({}, form({ id: String(g.id), year: '2026', month: '11', reason: 'Regroupé avec les audits de novembre' }))).toEqual({ ok: true, id: String(g.id) });
    const nov = (await loadAudits({ year: '2026' })).plan.filter((p) => p.track === 'Fournisseurs' && p.month === 11).map((p) => p.label).sort();
    expect(nov).toEqual(['[Fourn. F] · NC', '[Fourn. G]', '[Fourn. H]']);
  });
});

describe('AUD-22 : programme, constats et certifications rattachés à un site', () => {
  it('lecture filtrée sur le site sélectionné ; écriture selon la règle de site ; site repris par les constats', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const client = await planItem('Client A');
    const onB = await loadAudits({ year: '2026' });
    expect(onB.plan.some((p) => p.id === client.id)).toBe(false);
    expect(onB.auditGroups.some((g) => g.planItemId === client.id)).toBe(false);
    // Élément commun à l'entreprise : visible sur chaque site.
    expect(onB.plan.some((p) => p.label === 'Production')).toBe(true);
    // Écriture sur un élément du site A depuis le site B : refusée.
    expect(await savePlanItem({}, form({ id: String(client.id), track: client.track, label: client.label, doneOn: client.doneOn!, siteId: 'ville-a' }))).toEqual({ error: OTHER_SITE, fieldErrors: { siteId: OTHER_SITE } });
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadAudits({ year: '2026' })).plan.find((p) => p.id === client.id)).toMatchObject({ site: 'Site de [Ville A]', unplanned: true });
    // Changement de site (« Tous les sites ») : repris par ses constats, journal de l'élément et des constats.
    actAs('Animateur QHSE', 'all');
    expect(await savePlanItem({}, form({ id: String(client.id), track: client.track, label: client.label, detail: client.detail!, doneOn: client.doneOn!, auditor: client.auditor!, scope: client.scope!, ownerId: client.ownerId!, siteId: 'all' }))).toMatchObject({ ok: true });
    const [f] = await (await db()).select().from(t.auditFindings).where(eq(t.auditFindings.planItemId, client.id));
    expect(f.siteId).toBeNull();
    expect(await lastLog('audit_finding', f.id)).toMatchObject({ details: [{ field: 'Site', from: 'Site de [Ville A]', to: 'Tous les sites' }] });
    expect(await lastLog('audit_plan_item', client.id)).toMatchObject({ details: expect.arrayContaining([{ field: 'Site', from: 'Site de [Ville A]', to: 'Tous les sites' }]) });
    // Remis sur le site A pour la suite.
    expect(await savePlanItem({}, form({ id: String(client.id), track: client.track, label: client.label, detail: client.detail!, doneOn: client.doneOn!, auditor: client.auditor!, scope: client.scope!, ownerId: client.ownerId!, siteId: 'ville-a' }))).toMatchObject({ ok: true });
  });

  it('échéance « constat sans action » au site du constat, visible sur ce site ; action du constat sur son site', async () => {
    actAs('Animateur QHSE', 'all');
    const client = await planItem('Client A');
    const [f] = await (await db()).select().from(t.auditFindings).where(eq(t.auditFindings.planItemId, client.id));
    const sig = (await loadAuditSignals()).todo.find((x) => x.href === `/audits?constat=${f.id}`);
    expect(sig).toMatchObject({ siteId: 'ville-a', title: expect.stringContaining('Observation sans action') });
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadVisibleTodo()).some((x) => x.href === `/audits?constat=${f.id}` && !x.elsewhere)).toBe(false);
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadVisibleTodo()).some((x) => x.href === `/audits?constat=${f.id}`)).toBe(true);
    // Action d'un constat du site A : site A imposé (sélection « Tous les sites » : le site de l'action reste celui du constat).
    actAs('Animateur QHSE', 'all');
    const base = { ...NEW_ACTION, source: 'audit_interne', link: `finding:${f.id}`, originRef: '' };
    expect(await saveAction({}, form({ ...base, siteId: 'ville-b' }))).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    expect(await saveAction({}, form({ ...base, siteId: 'ville-a' }))).toMatchObject({ ok: true });
  });

  it('certification rattachée à un site : règle de site', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const r = await saveCertification({}, form({ standard: 'MASE', domain: 'Santé-sécurité', tone: 'warn', siteId: 'ville-b' }));
    expect(r).toMatchObject({ ok: true });
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadAudits({})).certs.some((c) => c.id === r.id)).toBe(false);
    expect(await saveCertification({}, form({ id: r.id!, standard: 'MASE', domain: 'Santé-sécurité', tone: 'off', siteId: 'ville-b' }))).toEqual({ error: OTHER_SITE, fieldErrors: { siteId: OTHER_SITE } });
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadAudits({})).certs.find((c) => c.id === r.id)).toMatchObject({ siteId: 'ville-b', site: "Site de [Ville B]" });
  });
});

describe('AUD-24 : gestion des lignes et reconduction annuelle', () => {
  it('renommer (journal de chaque élément), droits', async () => {
    actAs('Chef de service', 'all');
    expect(await renameTrack({}, form({ year: '2026', from: 'Audits clients', to: 'Audits de clients' }))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'all');
    expect(await renameTrack({}, form({ year: '2026', from: 'Revues de direction', to: 'Revues' }))).toEqual({ error: 'La ligne des revues de direction ne se renomme pas.' });
    expect(await renameTrack({}, form({ year: '2026', from: 'Audits clients', to: 'Fournisseurs' }))).toMatchObject({ fieldErrors: { to: 'La ligne « Fournisseurs » existe déjà en 2026.' } });
    const r = await renameTrack({}, form({ year: '2026', from: 'Audits clients', to: 'Audits de clients' }));
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('Ligne renommée') });
    const client = await planItem('Client A');
    expect(client.track).toBe('Audits de clients');
    expect(await lastLog('audit_plan_item', client.id)).toMatchObject({ summary: 'Ligne renommée « Audits de clients »', details: [{ field: 'Ligne', from: 'Audits clients', to: 'Audits de clients' }] });
  });

  it('reconduction de 2026 sur 2027 (dates décalées, à réaliser), masquage motivé d’une ligne reprise', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await renewProgram({}, form({ year: '2027' }))).toEqual({ error: 'Sélectionnez « Tous les sites » : les lignes et la reconduction valent pour tout le programme.' });
    actAs('Animateur QHSE', 'all');
    const before = await loadAudits({ year: '2027' });
    expect(before.renewFrom).toBe(2026);
    const r = await renewProgram({}, form({ year: '2027' }));
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/éléments reconduits au programme 2027/) });
    const d = await db();
    const next = await d.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.year, 2027));
    const be = next.find((p) => p.detail === 'Processus Conception BE' && p.month === 10)!;
    expect(be).toMatchObject({ done: false, doneOn: null, plannedOn: '2027-10-17', label: 'BE · 17/10', auditorId: 'lmoreau', unplanned: false });
    // Ni revues de direction ni audits hors programme ni éléments annulés reconduits.
    expect(next.some((p) => p.track === 'Revues de direction' && p.reviewId == null && p.label.startsWith('Annuelle'))).toBe(false);
    expect(next.some((p) => p.unplanned)).toBe(false);
    expect(next.some((p) => p.detail === 'Processus Logistique et expédition')).toBe(false);
    expect(await lastLog('audit_plan_item', be.id)).toMatchObject({ action: 'create', summary: 'Reconduit du programme 2026 (Audits internes, octobre)' });
    // Deuxième reconduction : rien à recopier.
    expect(await renewProgram({}, form({ year: '2027' }))).toEqual({ error: 'Le programme 2027 reprend déjà les éléments de 2026.' });

    // 2028 : lignes reprises de 2027 ; masquage d'une ligne sans élément en 2028 (motif), puis affichage à nouveau.
    expect(await hideTrack({}, form({ year: '2028', track: 'Fournisseurs' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await hideTrack({}, form({ year: '2027', track: 'Fournisseurs', reason: 'x' }))).toMatchObject({ error: expect.stringContaining('porte des éléments en 2027') });
    expect(await hideTrack({}, form({ year: '2028', track: 'Fournisseurs', reason: 'Plus d’audit fournisseur prévu' }))).toEqual({ ok: true });
    const y28 = await loadAudits({ year: '2028' });
    expect(y28.tracks).not.toContain('Fournisseurs');
    expect(y28.hiddenTracks).toEqual(['Fournisseurs']);
    expect(await lastLog('audit_plan_track', '2028|Fournisseurs')).toMatchObject({ action: 'archive', reason: 'Plus d’audit fournisseur prévu' });
    expect(await showTrack({}, form({ year: '2028', track: 'Fournisseurs', reason: 'Audit fournisseur finalement prévu' }))).toEqual({ ok: true });
    expect((await loadAudits({ year: '2028' })).tracks).toContain('Fournisseurs');
    expect((await changeLog('audit_plan_track', '2028|Fournisseurs')).map((e) => e.action)).toEqual(['archive', 'restore']);
  });
});

describe('AUD-26 : impression du programme annuel', () => {
  it('éléments en vigueur de l’année, du site sélectionné, par mois', async () => {
    actAs('Chef de projet', 'ville-b');
    const p = await loadAuditProgramPrint('2026');
    expect(p.year).toBe(2026);
    expect(p.items.length).toBeGreaterThan(5);
    expect(p.items.some((i) => i.siteId === 'ville-a')).toBe(false);
    expect(p.items.every((i, k) => k === 0 || p.items[k - 1].month <= i.month)).toBe(true);
    expect(p.cancelledCount).toBeGreaterThanOrEqual(1);
  });
});

describe('AUD-27 : auditeur interne lié à une personne', () => {
  it('personne présente (ou celle déjà enregistrée), journal, qualification signalée', async () => {
    actAs('Animateur QHSE', 'all');
    const be = await planItem('BE · 17/10');
    const fields = { id: String(be.id), track: be.track, label: be.label, detail: be.detail!, scope: be.scope ?? '', ownerId: be.ownerId ?? '', siteId: 'all' };
    expect(await savePlanItem({}, form({ ...fields, auditorId: 'ylambert' }))).toMatchObject({ fieldErrors: { auditorId: "Auditeur sorti de l'effectif : choisissez une personne présente." } });
    expect(await savePlanItem({}, form({ ...fields, auditorId: 'edubois', auditor: '[Organisme]' }))).toMatchObject({ ok: true });
    expect(await lastLog('audit_plan_item', be.id)).toMatchObject({ details: expect.arrayContaining([{ field: 'Auditeur interne', from: '[L. Moreau]', to: '[E. Dubois]' }]) });
    const view = (await loadAudits({ year: '2026' })).plan.find((p) => p.id === be.id)!;
    // [E. Dubois] n'a pas de titre « auditeur interne » : signalé ; [L. Moreau] est qualifié.
    expect(view).toMatchObject({ auditorName: '[E. Dubois]', auditorLabel: '[E. Dubois] · [Organisme]', auditorUnqualified: true });
    expect(await savePlanItem({}, form({ ...fields, auditorId: 'lmoreau' }))).toMatchObject({ ok: true });
    expect((await loadAudits({ year: '2026' })).plan.find((p) => p.id === be.id)).toMatchObject({ auditorUnqualified: false });
  });
});

describe('AUD-33 : constats des audits fournisseurs dans la section Fournisseurs du dossier', () => {
  it('constat d’un audit de la ligne « Fournisseurs » rangé sous Fournisseurs, plus sous Audits', async () => {
    actAs('Animateur QHSE', 'all');
    const f = await planItem('[Fourn. F]');
    await (await db()).insert(t.auditFindings).values({ audit: '[Fourn. F] · mars 2026', planItemId: f.id, kind: 'ecart_mineur', text: 'Certificats matière absents de deux lots', foundOn: f.doneOn });
    const [review] = await (await db()).select().from(t.reviews).where(eq(t.reviews.status, 'planifiee'));
    const page = await loadReviewDossierPage({ revue: String(review.id) });
    if (!page || !('dossier' in page)) throw new Error('dossier attendu');
    const d = page.dossier!;
    const inSuppliers = d.suppliers?.findingGroups?.flatMap((g) => g.findings).some((x) => x.text === 'Certificats matière absents de deux lots');
    const inAudits = d.audits?.auditGroups?.flatMap((g) => g.findings).some((x) => x.text === 'Certificats matière absents de deux lots');
    expect(inSuppliers).toBe(true);
    expect(inAudits).toBe(false);
  });
});
