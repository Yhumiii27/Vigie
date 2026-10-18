import '../next-mocks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db';
import { readJournal } from '@/db/migrations';
import * as t from '@/db/schema';
import { readCatalogue, shapeMismatches, type ShapeSnapshot } from '@/db/shape';
import { parisDay } from '@/lib/dates';
import { DEMO_ACTIONS, RETIRED_DEMO_ACTIONS, demoActionRow } from '@/db/seeds/actions';
import { resetConfig } from '@/lib/env';
import { nextActionNumber } from '@/server/action-core';
import { DEMO_0004_MIGRATIONS, openLegacyBase, prepareDemo0004, readDemo0004, type LegacyBase } from '../fixtures/legacy-base';

// Migration 0005 (ACT-17, ACT-18, ACT-19, ACT-35, ACT-40) : reprise des actions d'une base 0004 dans le modèle du service
// QHSE (drizzle/0005_actions_qse.sql, plan du paquet 1 § 1.4 amendé le 15/10/2026). Base de démonstration 0004
// (test/fixtures/demo-0004.json) complétée de lignes brutes pour les cas que le jeu de démonstration n'a pas, migrée
// jusqu'au bout ; base vide ; avancement inconnu (migration annulée). PGlite, et PostgreSQL avec TEST_DATABASE_URL.
//
// Puis la même base 0004 ouverte par getDb() en démonstration (upgradeDemo, upgradeDemoActions), comparée à une base de
// démonstration neuve (écarts documentés), et nextActionNumber après mise à niveau.

const fixture = readDemo0004();
type Row = Record<string, unknown>;
const legacyActions = fixture.tables.actions as Row[];
const legacy = new Map(legacyActions.map((a) => [String(a.id), a]));
const DEMO_IDS = [...legacy.keys()].sort();

const snapshotOf = (tag: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'drizzle', 'meta', `${tag.split('_')[0]}_snapshot.json`), 'utf8')) as ShapeSnapshot;
const lastTag = () => readJournal().at(-1)!.tag;

// Lignes brutes (modèle 0004) ajoutées avant la migration : numéros < 220 (le compteur reste celui de la démonstration).
const RAW = {
  // Action portée directement par un élément « Certification » ET atteinte par le constat d'un élément « Visites
  // sécurité » d'identifiant plus petit : l'élément direct l'emporte (tri IS NOT DISTINCT FROM ; avec « = », NULL passe
  // devant en DESC et l'élément indirect gagnerait).
  certifDirect: 'A-101',
  terrainViaFinding: 'A-102', // atteinte seulement par le constat d'un élément « Visites sécurité »
  fournisseurs: 'A-103', // portée par un élément « Fournisseurs » → Audit fournisseur (réponse du 15/10/2026)
  objectif: 'A-104', // origine rev, portée par une décision « objectif »
  unknownOrigin: 'A-105', // origine inconnue → source vide
  nightAndDescription: 'A-106', // créée à 23:30 UTC (lendemain à Paris), avec précisions
  blankDescription: 'A-107', // précisions blanches : détail = intitulé
  doneLogAfterClose: 'A-108', // done, « Déclarée réalisée » après la date de vérification : date effective = date de vérification
  doneLogNight: 'A-109', // done, deux « Déclarée réalisée », le dernier à 22:30 UTC (lendemain à Paris)
  verifyNoLog: 'A-110', // verify sans « Déclarée réalisée » : date effective vide
  whitespaceDescription: 'A-111', // précisions faites d'un retour à la ligne et d'une tabulation : détail = intitulé
  emptyDescription: 'A-112', // précisions vides ('') : pas de ligne « Précisions » au journal
  reviewTrackDirect: 'A-113', // portée par un élément « Revues de direction » → Revue de direction (comme admissibleSources)
  reviewTrackFinding: 'A-114', // atteinte par le constat d'un élément « Revues de direction » (base reprise) → Audit interne ISO
  // Annulées : l'ancienne annulation détachait constats, éléments du programme, exigences, contrôles, décisions — source
  // non déterminable, laissée vide (rien à compléter sur une Abandonnée).
  cancelledAudit: 'A-115',
  cancelledWatch: 'A-116',
  cancelledRev: 'A-117',
  longNumber: 'A-12345678901', // 11 chiffres : ignoré par le compteur (borne {1,9})
} as const;
const RAW_IDS: string[] = Object.values(RAW);

async function insertRawRows(q: LegacyBase['query']) {
  const action = (id: string, origin: string, o: { status?: string; title?: string; description?: string | null; createdAt?: string; closedOn?: string | null } = {}) =>
    q(`insert into actions (id, title, description, origin, origin_ref, pilot_id, due_on, status, kind, closed_on, created_at)
       values ($1, $2, $3, $4, $5, 'clefevre', '2026-11-30', $6, 'C', $7, $8)`, [
      id, o.title ?? `Action brute ${id}`, o.description ?? null, origin, `Réf. ${id}`, o.status ?? 'todo', o.closedOn ?? null,
      o.createdAt ?? '2026-09-01T08:00:00Z',
    ]);
  await action(RAW.certifDirect, 'audit');
  await action(RAW.terrainViaFinding, 'audit');
  await action(RAW.fournisseurs, 'audit');
  await action(RAW.objectif, 'rev');
  await action(RAW.unknownOrigin, 'inconnue');
  await action(RAW.nightAndDescription, 'ev', { createdAt: '2026-10-03T23:30:00Z', description: 'Précisions\nligne 2' });
  await action(RAW.blankDescription, 'ev', { description: '   ' });
  await action(RAW.doneLogAfterClose, 'ev', { status: 'done', closedOn: '2026-09-10' });
  await action(RAW.doneLogNight, 'ev', { status: 'done', closedOn: '2026-09-30' });
  await action(RAW.verifyNoLog, 'ev', { status: 'verify' });
  await action(RAW.whitespaceDescription, 'ev', { description: '\n\t\n' });
  await action(RAW.emptyDescription, 'ev', { description: '' });
  await action(RAW.reviewTrackDirect, 'audit');
  await action(RAW.reviewTrackFinding, 'audit');
  await action(RAW.cancelledAudit, 'audit', { status: 'cancelled' });
  await action(RAW.cancelledWatch, 'watch', { status: 'cancelled' });
  await action(RAW.cancelledRev, 'rev', { status: 'cancelled' });
  await action(RAW.longNumber, 'ev');
  const plan = (id: number, track: string, actionId: string | null) =>
    q('insert into audit_plan_items (id, year, track, month, label, action_id) values ($1, 2026, $2, 9, $3, $4)', [id, track, `Élément ${id}`, actionId]);
  await plan(901, 'Visites sécurité', null); // atteint par le constat de A-101 (identifiant plus petit)
  await plan(902, 'Certification', RAW.certifDirect);
  await plan(903, 'Visites sécurité', null);
  await plan(904, 'Fournisseurs', RAW.fournisseurs);
  await plan(905, 'Revues de direction', RAW.reviewTrackDirect);
  await plan(906, 'Revues de direction', null);
  const finding = (id: number, planItemId: number, actionId: string) =>
    q("insert into audit_findings (id, audit, kind, text, plan_item_id, action_id) values ($1, 'Audit brut', 'ecart_mineur', 'Constat brut', $2, $3)", [id, planItemId, actionId]);
  await finding(901, 901, RAW.certifDirect);
  await finding(902, 903, RAW.terrainViaFinding);
  await finding(903, 906, RAW.reviewTrackFinding);
  await q("insert into review_decisions (id, review_id, kind, text, action_id) values (901, 1, 'objectif', 'Objectif brut', $1)", [RAW.objectif]);
  const log = (id: string, summary: string, at: string) =>
    q("insert into change_log (entity_type, entity_id, action, summary, by_id, at) values ('action', $1, 'status', $2, 'clefevre', $3)", [id, summary, at]);
  await log(RAW.doneLogAfterClose, 'Déclarée réalisée — vérification le 30/09/2026', '2026-09-15T08:00:00Z');
  await log(RAW.doneLogNight, 'Déclarée réalisée — vérification le 30/09/2026', '2026-09-01T08:00:00Z');
  await log(RAW.doneLogNight, 'Déclarée réalisée — vérification le 30/09/2026', '2026-09-20T22:30:00Z');
  await log(RAW.verifyNoLog, 'Échéance reportée au 30/11/2026', '2026-09-05T08:00:00Z');
}

describe('migration 0005 — base de démonstration 0004', () => {
  let base: LegacyBase;
  let rows: Map<string, typeof t.actions.$inferSelect>;
  const action = (id: string) => {
    const a = rows.get(id);
    if (!a) throw new Error(`action ${id} absente`);
    return a;
  };

  beforeAll(async () => {
    base = await openLegacyBase();
    await base.migrateUpTo(DEMO_0004_MIGRATIONS);
    await base.loadFixture();
    await insertRawRows(base.query);
    await base.migrateAll();
    rows = new Map((await base.db.select().from(t.actions)).map((a) => [a.id, a]));
  });
  afterAll(async () => {
    await base?.close();
  });

  it('toutes les migrations appliquées ; forme de la base = dernier instantané (étape 5b)', async () => {
    expect(base.engine).toBe(process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite');
    const [{ n }] = (await base.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows as { n: number }[];
    expect(n).toBe(readJournal().length);
    expect(shapeMismatches(snapshotOf(lastTag()), await readCatalogue(base.query))).toEqual([]);
    const columns = (await base.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'actions'")).rows.map((r) => r.column_name);
    for (const old of ['title', 'description', 'origin', 'kind']) expect(columns).not.toContain(old);
  });

  it('les 33 actions de démonstration et les lignes brutes sont reprises, identifiants inchangés', () => {
    expect(legacyActions).toHaveLength(33);
    expect([...rows.keys()].sort()).toEqual([...DEMO_IDS, ...RAW_IDS].sort());
  });

  it('avancement : todo → À faire, doing → Budgétée ou initiée, verify → Terminée, done → Vérifiée, cancelled → Abandonnée', () => {
    const count = (status: string) => DEMO_IDS.filter((id) => action(id).status === status).length;
    expect({ a_faire: count('a_faire'), initiee: count('initiee'), terminee: count('terminee'), verifiee: count('verifiee'), abandonnee: count('abandonnee') })
      .toEqual({ a_faire: 10, initiee: 11, terminee: 4, verifiee: 7, abandonnee: 1 });
    const MAP: Record<string, string> = { todo: 'a_faire', doing: 'initiee', verify: 'terminee', done: 'verifiee', cancelled: 'abandonnee' };
    for (const id of DEMO_IDS) expect({ id, status: action(id).status }).toEqual({ id, status: MAP[String(legacy.get(id)!.status)] });
  });

  it('détail = intitulé, puis les précisions à la ligne ; champs nouveaux vides (à compléter)', () => {
    for (const id of DEMO_IDS) {
      const old = legacy.get(id)!;
      const a = action(id);
      // Précisions vides ou faites seulement d'espaces, tabulations, retours à la ligne : intitulé seul (même règle que R2).
      expect(a.detail).toBe(old.description != null && !/^\s*$/.test(String(old.description)) ? `${old.title}\n${old.description}` : old.title);
      expect({ id, problem: a.problem, domain: a.domain, priority: a.priority, riskLevel: a.riskLevel, hours: a.hours, estimatedCost: a.estimatedCost, actualCost: a.actualCost, verifyMethod: a.verifyMethod, newRisk: a.newRisk, followsActionId: a.followsActionId, followReason: a.followReason })
        .toEqual({ id, problem: null, domain: null, priority: null, riskLevel: null, hours: null, estimatedCost: null, actualCost: null, verifyMethod: null, newRisk: false, followsActionId: null, followReason: null });
    }
    expect(action(RAW.nightAndDescription).detail).toBe(`Action brute ${RAW.nightAndDescription}\nPrécisions\nligne 2`);
    expect(action(RAW.blankDescription).detail).toBe(`Action brute ${RAW.blankDescription}`);
    expect(action(RAW.whitespaceDescription).detail).toBe(`Action brute ${RAW.whitespaceDescription}`);
    expect(action(RAW.emptyDescription).detail).toBe(`Action brute ${RAW.emptyDescription}`);
  });

  it('source selon l’origine (§ 12, § 18 ; réponses du 15/10/2026) ; legacy_origin = ancienne origine', () => {
    const expected: Record<string, string | null> = {};
    for (const id of DEMO_IDS) {
      const origin = String(legacy.get(id)!.origin);
      const byOrigin: Record<string, string | null> = { ev: 'evenement', client: 'reclamation_client', risk: 'duerp', docs: 'revue_documentaire', env: 'dechets', skills: null, prevention: null };
      expected[id] = origin in byOrigin ? byOrigin[origin] : 'selon l’élément lié (ci-dessous)';
    }
    Object.assign(expected, {
      'A-181': 'audit_terrain', // élément « Visites sécurité » du programme
      'A-188': 'audit_interne', // constat d'un élément « Audits internes »
      'A-150': 'audit_interne', // sans élément : défaut
      'A-217': 'controle_reglementaire', // portée par un contrôle
      'A-196': 'veille',
      'A-152': 'revue_direction', 'A-158': 'revue_direction', 'A-174': 'revue_direction', 'A-184': 'revue_direction',
    });
    expect(Object.fromEntries(DEMO_IDS.map((id) => [id, action(id).source]))).toEqual(expected);
    // Environnement → Déchets ; Habilitations et Prévention → à compléter (plus d'action QSE).
    expect(['A-178', 'A-218', 'A-219'].map((id) => action(id).source)).toEqual(['dechets', 'dechets', 'dechets']);
    expect(['A-206', 'A-207', 'A-216', 'A-220'].map((id) => action(id).source)).toEqual([null, null, null, null]);
    for (const id of DEMO_IDS) expect({ id, legacyOrigin: action(id).legacyOrigin }).toEqual({ id, legacyOrigin: legacy.get(id)!.origin });
  });

  it('source des lignes brutes : priorité à l’élément direct, constat, Fournisseurs, objectif, origine inconnue', () => {
    expect(action(RAW.certifDirect).source).toBe('audit_certification');
    expect(action(RAW.terrainViaFinding).source).toBe('audit_terrain');
    expect(action(RAW.fournisseurs).source).toBe('audit_fournisseur');
    expect(action(RAW.objectif).source).toBe('objectif');
    expect(action(RAW.unknownOrigin).source).toBeNull();
    expect(action(RAW.unknownOrigin).legacyOrigin).toBe('inconnue');
  });

  it('source des lignes brutes : ligne « Revues de direction » (élément direct ou constat), annulées sans élément', () => {
    expect(action(RAW.reviewTrackDirect).source).toBe('revue_direction');
    expect(action(RAW.reviewTrackFinding).source).toBe('audit_interne');
    for (const id of [RAW.cancelledAudit, RAW.cancelledWatch, RAW.cancelledRev]) {
      expect({ id, status: action(id).status, source: action(id).source }).toEqual({ id, status: 'abandonnee', source: null });
    }
  });

  it('date d’ouverture = date de Paris de la création ; date cible initiale = date cible', () => {
    for (const id of DEMO_IDS) {
      const old = legacy.get(id)!;
      expect({ id, openedOn: action(id).openedOn }).toEqual({ id, openedOn: parisDay(new Date(String(old.created_at))) });
      expect({ id, initialDueOn: action(id).initialDueOn, dueOn: action(id).dueOn }).toEqual({ id, initialDueOn: old.due_on, dueOn: old.due_on });
    }
    expect(action('A-152').openedOn).toBe('2025-12-18'); // créée le 18/12/2025 à 10:00 (Paris)
    expect(action(RAW.nightAndDescription).openedOn).toBe('2026-10-04'); // 03/10 23:30 UTC = 04/10 01:30 à Paris
  });

  it('date effective : dernier « Déclarée réalisée » du journal ; Vérifiée sans journal : date de vérification', () => {
    expect(action('A-190').doneOn).toBe('2026-09-20');
    for (const id of ['A-186', 'A-172', 'A-178']) expect({ id, doneOn: action(id).doneOn }).toEqual({ id, doneOn: null });
    for (const id of DEMO_IDS.filter((x) => legacy.get(x)!.status === 'done')) {
      expect({ id, doneOn: action(id).doneOn }).toEqual({ id, doneOn: legacy.get(id)!.closed_on });
    }
    for (const id of DEMO_IDS.filter((x) => !['verify', 'done'].includes(String(legacy.get(x)!.status)))) {
      expect({ id, doneOn: action(id).doneOn }).toEqual({ id, doneOn: null });
    }
    expect(action(RAW.doneLogAfterClose).doneOn).toBe('2026-09-10'); // jamais après la date de vérification
    expect(action(RAW.doneLogNight).doneOn).toBe('2026-09-21'); // dernier journal, 20/09 22:30 UTC = 21/09 à Paris
    expect(action(RAW.verifyNoLog).doneOn).toBeNull();
  });

  it('résultat Efficace pour les Vérifiées ; vérification, abandon et rattachements conservés', () => {
    for (const id of DEMO_IDS) {
      const old = legacy.get(id)!;
      const a = action(id);
      expect({ id, effective: a.effective }).toEqual({ id, effective: a.status === 'verifiee' ? true : null });
      expect({ id, closedOn: a.closedOn, verifyDueOn: a.verifyDueOn, efficacyNote: a.efficacyNote, verifiedById: a.verifiedById, siteId: a.siteId, pilotId: a.pilotId, originRef: a.originRef })
        .toEqual({ id, closedOn: old.closed_on, verifyDueOn: old.verify_due_on, efficacyNote: old.efficacy_note, verifiedById: old.verified_by_id, siteId: old.site_id, pilotId: old.pilot_id, originRef: old.origin_ref });
      expect({ id, eventId: a.eventId, reviewId: a.reviewId, preventionPlanId: a.preventionPlanId, permitId: a.permitId, documentId: a.documentId, wasteStreamId: a.wasteStreamId, wasteEntryId: a.wasteEntryId })
        .toEqual({ id, eventId: old.event_id, reviewId: old.review_id, preventionPlanId: old.prevention_plan_id, permitId: old.permit_id, documentId: old.document_id, wasteStreamId: old.waste_stream_id, wasteEntryId: old.waste_entry_id });
      expect({ id, createdAt: a.createdAt.toISOString() }).toEqual({ id, createdAt: new Date(String(old.created_at)).toISOString() });
    }
    const a180 = action('A-180');
    const old = legacy.get('A-180')!;
    expect(a180.status).toBe('abandonnee');
    expect({ reason: a180.cancelReason, by: a180.cancelledById, at: a180.cancelledAt?.toISOString() })
      .toEqual({ reason: old.cancel_reason, by: old.cancelled_by_id, at: new Date(String(old.cancelled_at)).toISOString() });
    expect(a180.cancelReason).toMatch(/^Doublon de A-201/);
  });

  it('lignes à plusieurs éléments et dates incohérentes reprises telles quelles (D22, D24)', async () => {
    expect(action('A-212').eventId).toBe('EV-2026-130');
    const findings = (await base.db.select().from(t.auditFindings).orderBy(asc(t.auditFindings.id))).filter((f) => ['A-212', 'A-205'].includes(f.actionId ?? ''));
    expect(findings.map((f) => [f.id, f.actionId])).toEqual([[2, 'A-212'], [4, 'A-205']]);
    const risks = await base.db.select().from(t.riskActions).where(eq(t.riskActions.actionId, 'A-205'));
    expect(risks).toEqual([{ riskId: 2, actionId: 'A-205' }]);
    for (const id of ['A-170', 'A-176']) {
      const a = action(id);
      expect(a.openedOn > a.dueOn && a.openedOn > a.closedOn!).toBe(true);
    }
    expect(action('A-170')).toMatchObject({ openedOn: '2026-09-19', dueOn: '2026-09-15', closedOn: '2026-09-16' });
    expect(action('A-176')).toMatchObject({ openedOn: '2026-09-24', dueOn: '2026-09-15', closedOn: '2026-09-18' });
  });

  it('rattachements des autres tables inchangés (contrôles, décisions, programme, constats, risques, versions)', async () => {
    const byId = (table: string) => new Map((fixture.tables[table] as Row[]).map((r) => [String(r.id), r.action_id ?? null]));
    const pick = (list: { id: number | string; actionId: string | null }[], ids: Map<string, unknown>) =>
      Object.fromEntries(list.filter((r) => ids.has(String(r.id))).map((r) => [String(r.id), r.actionId]));
    for (const [table, list] of [
      ['controls', await base.db.select({ id: t.controls.id, actionId: t.controls.actionId }).from(t.controls)],
      ['review_decisions', await base.db.select({ id: t.reviewDecisions.id, actionId: t.reviewDecisions.actionId }).from(t.reviewDecisions)],
      ['audit_plan_items', await base.db.select({ id: t.auditPlanItems.id, actionId: t.auditPlanItems.actionId }).from(t.auditPlanItems)],
      ['audit_findings', await base.db.select({ id: t.auditFindings.id, actionId: t.auditFindings.actionId }).from(t.auditFindings)],
      ['document_versions', await base.db.select({ id: t.documentVersions.id, actionId: t.documentVersions.actionId }).from(t.documentVersions)],
    ] as const) {
      const ids = byId(table);
      expect({ table, links: pick(list as { id: number | string; actionId: string | null }[], ids) }).toEqual({ table, links: Object.fromEntries(ids) });
    }
    const risks = await base.db.select().from(t.riskActions);
    expect(risks.map((r) => `${r.riskId}:${r.actionId}`).sort()).toEqual((fixture.tables.risk_actions as Row[]).map((r) => `${r.risk_id}:${r.action_id}`).sort());
    // HAB-04 (0007) : le recyclage repris passe de l'exigence à l'action (case de la matrice conservée).
    const renewals = (fixture.tables.qualification_requirements as Row[]).filter((r) => r.renewal_action_id);
    expect(renewals.length).toBeGreaterThan(0);
    for (const r of renewals) {
      expect(action(String(r.renewal_action_id))).toMatchObject({ qualificationPersonId: r.person_id, qualificationTitleId: r.title_id });
    }
    expect((await base.db.select().from(t.actions)).filter((a) => a.qualificationPersonId).map((a) => a.id)).toEqual(renewals.map((r) => r.renewal_action_id));
  });

  it('données des autres tables inchangées (nombre de lignes)', async () => {
    const extra: Record<string, number> = { actions: RAW_IDS.length, audit_plan_items: 6, audit_findings: 3, review_decisions: 1 };
    for (const [table, list] of Object.entries(fixture.tables)) {
      if (table === 'change_log') continue;
      const [{ n }] = (await base.query(`select count(*)::int as n from "${table}"`)).rows as { n: number }[];
      expect({ table, n }).toEqual({ table, n: list.length + (extra[table] ?? 0) });
    }
  });

  it('une entrée « Reprise du modèle Power Apps » par action, automatique (by_id vide), valeurs transformées', async () => {
    const logs = (await base.db.select().from(t.changeLog).where(eq(t.changeLog.action, 'reprise')).orderBy(asc(t.changeLog.id)));
    expect(logs.map((l) => l.entityId).sort()).toEqual([...rows.keys()].sort());
    for (const l of logs) {
      expect({ id: l.entityId, type: l.entityType, summary: l.summary, by: l.byId, reason: l.reason })
        .toEqual({ id: l.entityId, type: 'action', summary: 'Reprise du modèle Power Apps', by: null, reason: null });
    }
    const details = (id: string) => logs.find((l) => l.entityId === id)!.details as Record<string, unknown>[];
    for (const id of DEMO_IDS) {
      const old = legacy.get(id)!;
      expect(details(id)).toContainEqual({ field: 'Nature', from: old.kind === 'C' ? 'Corrective' : 'Préventive', to: null, fromKey: old.kind });
      expect(details(id)[0]).toMatchObject({ field: 'Avancement', fromKey: old.status, toKey: action(id).status });
    }
    expect(details('A-190')).toEqual([
      { field: 'Avancement', from: 'Efficacité à vérifier', to: 'Terminée — à vérifier', fromKey: 'verify', toKey: 'terminee' },
      { field: 'Nature', from: 'Corrective', to: null, fromKey: 'C' },
      { field: 'Origine', from: 'Événement', to: null, fromKey: 'ev' },
      { field: 'Source', from: null, to: 'Évènement QSE', toKey: 'evenement' },
      { field: 'Intitulé', from: legacy.get('A-190')!.title, to: null },
      { field: 'Détail de l\'action', from: null, to: 'Intitulé et précisions fusionnés' },
      { field: 'Date d\'ouverture', from: null, to: '20/08/2026' },
      { field: 'Date cible initiale', from: null, to: '05/09/2026' },
      { field: 'Date effective', from: null, to: '20/09/2026' },
    ]);
    expect(details('A-207')).toContainEqual({ field: 'Source', from: null, to: 'À compléter', toKey: null });
    expect(details('A-207')).toContainEqual({ field: 'Origine', from: 'Habilitations', to: null, fromKey: 'skills' });
    expect(details('A-178')).toContainEqual({ field: 'Source', from: null, to: 'Déchets', toKey: 'dechets' });
    expect(details(RAW.fournisseurs)).toContainEqual({ field: 'Source', from: null, to: 'Audit fournisseur', toKey: 'audit_fournisseur' });
    expect(details('A-165')).toContainEqual({ field: 'Résultat', from: null, to: 'Efficace' });
    expect(details('A-180')[0]).toEqual({ field: 'Avancement', from: 'Annulée', to: 'Abandonnée', fromKey: 'cancelled', toKey: 'abandonnee' });
    expect(details(RAW.nightAndDescription)).toContainEqual({ field: 'Précisions', from: 'Précisions\nligne 2', to: null });
    // Précisions vides ou blanches : pas de ligne (jamais « from: '' »).
    for (const id of [RAW.blankDescription, RAW.whitespaceDescription, RAW.emptyDescription]) {
      expect({ id, fields: details(id).map((d) => d.field) }).not.toMatchObject({ fields: expect.arrayContaining(['Précisions']) });
    }
    expect(details(RAW.reviewTrackDirect)).toContainEqual({ field: 'Source', from: null, to: 'Revue de direction', toKey: 'revue_direction' });
    for (const id of [RAW.cancelledAudit, RAW.cancelledWatch, RAW.cancelledRev]) {
      expect(details(id)).toContainEqual({ field: 'Source', from: null, to: 'Non déterminée', toKey: null });
    }
    // Journal existant conservé (« Déclarée réalisée » de A-190, abandon de A-180…).
    const others = await base.db.select().from(t.changeLog).where(eq(t.changeLog.entityId, 'A-180'));
    expect(others.map((l) => l.action).sort()).toEqual(['cancel', 'reprise']);
  });

  it('compteur de numérotation : plus grand numéro A-n vu (220), identifiant de 10 chiffres ou plus ignoré', async () => {
    expect(await base.db.select().from(t.actionCounters)).toEqual([{ scope: 'A', last: 220 }]);
  });

  it('contraintes CHECK : anciens avancements et valeurs hors liste refusés', async () => {
    await expect(base.query("update actions set status = 'done' where id = 'A-214'")).rejects.toThrow(/actions_status_check/);
    await expect(base.query("update actions set source = 'skills' where id = 'A-214'")).rejects.toThrow(/actions_source_check/);
    await expect(base.query("update actions set domain = 'qhse' where id = 'A-214'")).rejects.toThrow(/actions_domain_check/);
    await expect(base.query("update actions set priority = 'haute' where id = 'A-214'")).rejects.toThrow(/actions_priority_check/);
    await expect(base.query("update actions set verify_method = 'oral' where id = 'A-214'")).rejects.toThrow(/actions_verify_method_check/);
    await expect(base.query("update actions set risk_level = 5 where id = 'A-214'")).rejects.toThrow(/actions_risk_level_check/);
    await expect(base.query("update actions set hours = -1 where id = 'A-214'")).rejects.toThrow(/actions_amounts_check/);
    await expect(base.query("update actions set follows_action_id = 'A-170' where id = 'A-214'")).rejects.toThrow(/actions_follow_pair_check/);
    await expect(base.query("update actions set follows_action_id = 'A-170', follow_reason = 'autre' where id = 'A-214'")).rejects.toThrow(/actions_follow_reason_check/);
    await expect(base.query("insert into action_comments (action_id, author_id, body) values ('A-214', 'clefevre', '')")).rejects.toThrow(/action_comments_body_check/);
    await expect(base.query("insert into action_reminder_sends (person_id, week, status) values ('clefevre', '2026-42', 'envoye')")).rejects.toThrow(/action_reminder_sends_week_check/);
    await base.query("update actions set source = 'audit_fournisseur', status = 'p40', follows_action_id = 'A-170', follow_reason = 'non_efficace' where id = $1", [RAW.fournisseurs]);
    await expect(base.query('update actions set opened_on = null where id = $1', [RAW.fournisseurs])).rejects.toThrow(/null/i);
  });
});

describe('migration 0005 — base vide', () => {
  let base: LegacyBase;
  beforeAll(async () => {
    base = await openLegacyBase({ reset: true });
    await base.migrateAll();
  });
  afterAll(async () => {
    await base?.close();
  });

  it('compteur (A, 0), aucune entrée de reprise, forme = instantané', async () => {
    expect(await base.db.select().from(t.actionCounters)).toEqual([{ scope: 'A', last: 0 }]);
    expect(await base.db.select().from(t.changeLog)).toEqual([]);
    expect(await base.db.select().from(t.actions)).toEqual([]);
    expect(shapeMismatches(snapshotOf(lastTag()), await readCatalogue(base.query))).toEqual([]);
  });
});

describe('migration 0005 — avancement inconnu : migration annulée, base laissée en 0004', () => {
  let base: LegacyBase;
  beforeAll(async () => {
    base = await openLegacyBase({ reset: true });
    await base.migrateUpTo(DEMO_0004_MIGRATIONS);
    await base.query("insert into sites (id, label) values ('s1', 'Site')");
    await base.query("insert into people (id, name, site_id) values ('p1', 'P', 's1')");
    await base.query("insert into actions (id, title, origin, origin_ref, pilot_id, due_on, status, kind) values ('A-1', 'X', 'ev', 'EV', 'p1', '2026-10-01', 'en_pause', 'C')");
  });
  afterAll(async () => {
    await base?.close();
  });

  it('la contrainte actions_status_check échoue ; rien n’est appliqué', async () => {
    await expect(base.migrateAll()).rejects.toThrow();
    const [{ n }] = (await base.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows as { n: number }[];
    expect(n).toBe(DEMO_0004_MIGRATIONS);
    const [row] = (await base.query("select title, status from actions where id = 'A-1'")).rows;
    expect(row).toEqual({ title: 'X', status: 'en_pause' });
    const [{ c }] = (await base.query("select to_regclass('public.action_counters')::text as c")).rows;
    expect(c).toBeNull();
  });
});

// ─── Base de démonstration 0004 ouverte par getDb() : migration 0005, puis upgradeDemo ─────────────────────────────
// (prepareDemo0004, src/db/seed.ts) — reprise des liens depuis legacy_origin, upgradeDemoActions (champs du jeu remplis
// une fois, jamais d'écrasement), écarts documentés avec une base de démonstration neuve, nextActionNumber → A-221.

type ActionRow = typeof t.actions.$inferSelect;
/** Ligne modifiée par un utilisateur avant la mise à niveau (intitulé changé) : jamais complétée. */
const EDITED = 'A-198';
const KEPT_IDS = Object.keys(DEMO_ACTIONS).filter((id) => DEMO_ACTIONS[id].origin);
let upgraded: { actions: Map<string, ActionRow>; counter: unknown; comments: number; notifications: number; proofs: number } | null = null;
let prep: Awaited<ReturnType<typeof prepareDemo0004>> | null = null;

/** Base PostgreSQL du fichier vidée (schémas recréés) ; sans effet en PGlite (dossier ou mémoire neufs). */
async function resetPostgres() {
  if (!process.env.DATABASE_URL) return;
  const b = await openLegacyBase({ reset: true });
  await b.close();
}

describe('migration 0005 — mise à niveau d’une base de démonstration 0004 (upgradeDemo, upgradeDemoActions)', () => {
  let rows: Map<string, ActionRow>;
  const row = (id: string) => rows.get(id)!;

  beforeAll(async () => {
    await closeDb();
    await resetPostgres();
    prep = await prepareDemo0004();
    // État d'une base de démonstration réelle : une source d'origine jamais rattachée (base ≤ 0003), un intitulé modifié.
    const legacyBase = await openLegacyBase({ dataDir: path.join(prep.root, 'db') });
    try {
      await legacyBase.query("update actions set waste_stream_id = null where id = 'A-219'");
      await legacyBase.query(`update actions set title = 'Luminaires de l''allée centrale : remplacement par des LED' where id = '${EDITED}'`);
    } finally {
      await legacyBase.close();
    }
    Object.assign(process.env, { VIGIE_DEMO: '1', VIGIE_TODAY: '2026-10-09' });
    resetConfig();
    const db = await getDb();
    rows = new Map((await db.select().from(t.actions)).map((a) => [a.id, a]));
    const [counter] = await db.select().from(t.actionCounters);
    upgraded = {
      actions: rows, counter,
      comments: (await db.select().from(t.actionComments)).length,
      notifications: (await db.select().from(t.notifications)).length,
      proofs: (await db.select().from(t.attachments).where(eq(t.attachments.entityType, 'action'))).length,
    };
  });
  afterAll(async () => {
    await closeDb();
  });

  it('reprise des liens depuis legacy_origin : la filière de A-219 rattachée de nouveau (journal « Origine rattachée »)', async () => {
    expect(row('A-219')).toMatchObject({ wasteStreamId: 'FD-04', legacyOrigin: 'env', source: 'dechets' });
    const log = await (await getDb()).select().from(t.changeLog).where(and(eq(t.changeLog.entityId, 'A-219'), eq(t.changeLog.action, 'link')));
    expect(log.map((l) => [l.summary, l.byId])).toEqual([['Origine rattachée : filière de déchets FD-04 (reprise de la référence d\'origine)', null]]);
  });

  it('champs du jeu remplis là où la reprise les a laissés vides, pour les lignes restées telles que le jeu les avait créées', () => {
    for (const id of KEPT_IDS.filter((x) => x !== EDITED)) {
      const fresh = demoActionRow(id);
      const a = row(id);
      expect(a.legacyOrigin, id).toBe(DEMO_ACTIONS[id].origin);
      for (const k of ['problem', 'domain', 'priority', 'riskLevel', 'estimatedCost', 'actualCost', 'hours', 'siteId', 'source'] as const) {
        expect(a[k] ?? null, `${id}.${k}`).toEqual(fresh[k] ?? null);
      }
      if (a.status !== 'abandonnee') expect(a.verifyDueOn, `${id}.verifyDueOn`).toBe(fresh.verifyDueOn);
      expect(a.verifyMethod ?? null, `${id}.verifyMethod`).toEqual(a.status === 'verifiee' ? fresh.verifyMethod : null);
    }
    // Les huit sites complétés ; A-150 reste « site à compléter ».
    expect(['A-181', 'A-184', 'A-188', 'A-196', 'A-152', 'A-158', 'A-174', 'A-208'].map((id) => row(id).siteId))
      .toEqual(['ville-b', ...Array(7).fill('ville-a')]);
    expect(row('A-150').siteId).toBeNull();
  });

  it('jamais l’avancement, les dates, les liens ni la vérification ; ligne modifiée et numéros retirés laissés tels quels', () => {
    expect(row('A-214')).toMatchObject({ status: 'initiee', detail: DEMO_ACTIONS['A-214'].title, dueOn: '2026-10-17' });
    expect(row('A-174')).toMatchObject({ status: 'initiee', dueOn: '2026-09-30', initialDueOn: '2026-09-30' });
    expect(row('A-170')).toMatchObject({ dueOn: '2026-09-15', closedOn: '2026-09-16', doneOn: '2026-09-16', effective: true, efficacyNote: null, verifiedById: null });
    expect(row('A-176')).toMatchObject({ dueOn: '2026-09-15', closedOn: '2026-09-18', newRisk: false });
    expect(row('A-186').doneOn).toBeNull(); // Terminée sans « Déclarée réalisée » au journal : date effective à compléter
    expect(row(EDITED)).toMatchObject({ detail: "Luminaires de l'allée centrale : remplacement par des LED", problem: null, domain: null, priority: null, verifyDueOn: null });
    for (const id of RETIRED_DEMO_ACTIONS) {
      expect(row(id), id).toMatchObject({ source: null, problem: null, domain: null, priority: null, verifyDueOn: null });
    }
    expect(row('A-206')).toMatchObject({ legacyOrigin: 'prevention', preventionPlanId: 'PP-2026-012' });
    expect(row('A-207')).toMatchObject({ legacyOrigin: 'skills' });
  });

  it('aucun journal écrit par la mise à niveau des champs ; ni fil, ni preuves, ni notifications, ni actions de suite ; compteur à 220', async () => {
    const db = await getDb();
    const actionLogs = await db.select().from(t.changeLog).where(eq(t.changeLog.entityType, 'action'));
    const legacyLogs = (fixture.tables.change_log as Row[]).filter((l) => l.entity_type === 'action').length;
    // Entrées d'avant + une reprise par action (33) + la reprise du lien de A-219.
    expect(actionLogs).toHaveLength(legacyLogs + legacyActions.length + 1);
    expect(upgraded).toMatchObject({ comments: 0, notifications: 0, proofs: 0, counter: { scope: 'A', last: 220 } });
    expect(rows.has('A-221') || rows.has('A-222')).toBe(false);
  });

  it('nextActionNumber après la mise à niveau : A-221', async () => {
    const db = await getDb();
    await expect(db.transaction(async (tx) => {
      expect(await nextActionNumber(tx)).toBe('A-221');
      throw new Error('annulation');
    })).rejects.toThrow('annulation');
    expect(await db.select().from(t.actionCounters)).toEqual([{ scope: 'A', last: 220 }]);
  });

  it('une seule fois : toute action du jeu d’avant 0005 a une description du problème, posée par la première mise à niveau', () => {
    for (const id of KEPT_IDS) expect(demoActionRow(id).problem, id).toBeTruthy();
    for (const id of KEPT_IDS.filter((x) => x !== EDITED)) expect(row(id).problem, id).toBe(demoActionRow(id).problem);
  });

  it('à la réouverture : rien n’est écrasé (champs saisis entre-temps conservés), un champ vidé reste vide, rien de plus n’est rempli', async () => {
    const db = await getDb();
    expect(row('A-214')).toMatchObject({ riskLevel: 3, estimatedCost: 950 });
    expect(row('A-165').hours).toBe(12);
    // Le QHSE modifie A-214 et vide deux champs facultatifs ; il vide le pointage de A-165.
    await db.update(t.actions).set({ priority: 'long_terme', problem: 'Problème saisi par le QHSE', riskLevel: null, estimatedCost: null }).where(eq(t.actions.id, 'A-214'));
    await db.update(t.actions).set({ hours: null }).where(eq(t.actions.id, 'A-165'));
    await closeDb();
    const again = await getDb();
    const [a214] = await again.select().from(t.actions).where(eq(t.actions.id, 'A-214'));
    expect(a214).toMatchObject({ priority: 'long_terme', problem: 'Problème saisi par le QHSE', riskLevel: null, estimatedCost: null });
    const [a165] = await again.select().from(t.actions).where(eq(t.actions.id, 'A-165'));
    expect(a165.hours).toBeNull();
    const [edited] = await again.select().from(t.actions).where(eq(t.actions.id, EDITED));
    expect(edited.problem).toBeNull();
  });
});

describe('migration 0005 — base mise à niveau comparée à une base de démonstration neuve', () => {
  let fresh: Map<string, ActionRow>;
  let freshDb: Awaited<ReturnType<typeof getDb>>;

  beforeAll(async () => {
    await closeDb();
    await resetPostgres();
    process.env.VIGIE_DATA_DIR = 'memory://';
    resetConfig();
    freshDb = await getDb();
    fresh = new Map((await freshDb.select().from(t.actions)).map((a) => [a.id, a]));
  });
  afterAll(async () => {
    await closeDb();
    delete process.env.VIGIE_DEMO;
    delete process.env.VIGIE_TODAY;
    delete process.env.VIGIE_BACKUP_DIR;
    delete process.env.VIGIE_UPLOAD_DIR;
    resetConfig();
    await prep?.cleanup();
  });

  it('écarts documentés seulement (src/db/seeds/actions.ts, upgradeDemoActions), action par action', () => {
    expect(upgraded).not.toBeNull();
    const up = upgraded!.actions;
    const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const diffs: Record<string, string[]> = {};
    for (const id of KEPT_IDS.filter((x) => x !== EDITED)) {
      const a = up.get(id)!;
      const b = fresh.get(id)!;
      const keys = (Object.keys(b) as (keyof ActionRow)[]).filter((k) => k !== 'legacyOrigin' && !same(a[k], b[k]));
      if (keys.length) diffs[id] = keys.sort();
    }
    expect(diffs).toEqual({
      // Avancements repris : doing → Budgétée ou initiée (le jeu neuf a 20 % à 80 %).
      'A-214': ['detail', 'status'], // détail sur deux lignes dans le jeu neuf
      'A-215': ['detail'],
      'A-212': ['status'], 'A-209': ['status'], 'A-203': ['status'], 'A-201': ['status'], 'A-194': ['status'], 'A-188': ['status'],
      // Report de A-174 (jeu neuf seulement) : nouvelle date cible.
      'A-174': ['dueOn', 'status'],
      // Terminées sans « Déclarée réalisée » au journal : date effective à compléter (§ 18).
      'A-186': ['doneOn'], 'A-172': ['doneOn'], 'A-178': ['doneOn'],
      // Vérifiées : date effective reprise = date de vérification ; vérifications et dates d'avant (D24 pour A-170, A-176).
      'A-165': ['doneOn', 'efficacyNote', 'verifiedById'],
      'A-152': ['doneOn'], 'A-158': ['doneOn'],
      'A-170': ['closedOn', 'doneOn', 'dueOn', 'effective', 'efficacyNote', 'initialDueOn', 'verifiedById'],
      'A-176': ['closedOn', 'doneOn', 'dueOn', 'efficacyNote', 'initialDueOn', 'newRisk', 'verifiedById'],
    });
    expect([...up.values()].filter((a) => a.legacyOrigin).length).toBe(up.size);
    expect([...fresh.values()].filter((a) => a.legacyOrigin).map((a) => a.id)).toEqual(['A-150']);
  });

  it('jeu neuf seulement : fil, preuves, notifications, actions de suite, compteur à 222 ; numéros retirés absents', async () => {
    const up = upgraded!;
    expect(up.actions.size).toBe(legacyActions.length);
    expect(fresh.size).toBe(31);
    for (const id of RETIRED_DEMO_ACTIONS) expect([up.actions.has(id), fresh.has(id)], id).toEqual([true, false]);
    for (const id of ['A-221', 'A-222']) expect([up.actions.has(id), fresh.has(id)], id).toEqual([false, true]);
    expect((await freshDb.select().from(t.actionComments)).length).toBeGreaterThan(up.comments);
    // « Action confiée » (A-215, A-221, A-222), commentaires (5) et preuves (2) des responsables hors QHSE (ACT-31).
    expect((await freshDb.select().from(t.notifications)).length).toBe(10);
    expect((await freshDb.select().from(t.attachments).where(eq(t.attachments.entityType, 'action'))).length).toBe(4);
    expect(await freshDb.select().from(t.actionCounters)).toEqual([{ scope: 'A', last: 222 }]);
    expect(await freshDb.transaction((tx) => nextActionNumber(tx).then((id) => { throw Object.assign(new Error('annulation'), { id }); })).catch((e: { id?: string }) => e.id))
      .toBe('A-223');
  });

});
