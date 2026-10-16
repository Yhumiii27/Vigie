import { describe, expect, it } from 'vitest';
import '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionRow, insertAction } from './actions-helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { EVENT_AUDIT_LOCKED, ORIGIN_LOCKED, linkFacts } from '@/lib/action-links';
import { NON_QSE_LINK_MESSAGE, admissibleSources } from '@/lib/action-rules';
import { linkAction, unlinkAction } from '@/server/links';

// Liens complémentaires d'une action existante (LinkActionButton, D15, ACT-22) : service QHSE seulement ; jamais
// l'événement ni l'audit (fixés à la création), ni une source d'origine, ni une habilitation ; action ni Vérifiée ni
// Abandonnée pour rattacher, sauf Abandonnée pour détacher ; site de l'action et de l'élément ; journal de l'action et de
// la source (logAs). linkFacts : référence d'origine par défaut, site et faits de la source admise.

freshDemoDatabase();

const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';

describe('droits et types refusés', () => {
  it('hors QHSE : refusé (rattacher comme détacher)', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await linkAction('risk:3', 'A-215')).toEqual({ error: APPROVERS_ONLY });
      expect(await unlinkAction('risk:1', 'A-215')).toEqual({ error: APPROVERS_ONLY });
    }
  });

  it('événement, constat, élément du programme, source d’origine, habilitation : refusés, rien écrit', async () => {
    actAs('Animateur QHSE', 'all');
    const logs = (await changeLog('action', 'A-215')).length;
    for (const link of ['event:EV-2026-130', 'finding:3', 'plan:6']) {
      expect(await linkAction(link, 'A-215')).toEqual({ error: EVENT_AUDIT_LOCKED });
    }
    expect(await unlinkAction('event:EV-2026-131', 'A-215')).toEqual({ error: EVENT_AUDIT_LOCKED });
    expect(await unlinkAction('finding:2', 'A-212')).toEqual({ error: EVENT_AUDIT_LOCKED });
    expect(await linkAction('document:PR-QHSE-002', 'A-215')).toEqual({ error: ORIGIN_LOCKED });
    expect(await unlinkAction('wastestream:FD-04', 'A-219')).toEqual({ error: ORIGIN_LOCKED });
    expect(await linkAction('preventionplan:PP-2026-015', 'A-215')).toEqual({ error: ORIGIN_LOCKED });
    expect(await linkAction('qualification:tnguyen:sst', 'A-215')).toEqual({ error: NON_QSE_LINK_MESSAGE });
    expect(await linkAction('inconnu:1', 'A-215')).toEqual({ error: 'Type de rattachement inconnu.' });
    expect((await actionRow('A-215')).eventId).toBe('EV-2026-131');
    expect((await changeLog('action', 'A-215')).length).toBe(logs);
  });
});

describe('rattacher et détacher', () => {
  it('risque : journal de l’action et du risque, dans les deux sens', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await linkAction('risk:3', 'A-215')).toEqual({});
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'link', summary: expect.stringContaining('Rattachée à'), byId: 'clefevre' });
    expect(await lastLog('risk', 3)).toMatchObject({ action: 'link', summary: 'Action A-215 rattachée', byId: 'clefevre' });
    expect(await unlinkAction('risk:3', 'A-215')).toEqual({});
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'unlink', summary: expect.stringContaining('Détachée de') });
    expect(await lastLog('risk', 3)).toMatchObject({ action: 'unlink', summary: "Action A-215 détachée (elle reste dans le plan d'actions)" });
  });

  it('Vérifiée : plus de rattachement, détachement admis ; Abandonnée : ni l’un ni l’autre', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await linkAction('risk:13', 'A-165')).toEqual({ error: "L'action A-165 est vérifiée ou abandonnée : elle ne peut plus être rattachée." });
    expect(await unlinkAction('risk:14', 'A-165')).toEqual({});
    expect(await (await getDb()).select().from(t.riskActions).where(eq(t.riskActions.actionId, 'A-165'))).toEqual([]);
    actAs('Animateur QHSE', 'ville-a');
    expect(await linkAction('risk:20', 'A-180')).toMatchObject({ error: expect.stringContaining('vérifiée ou abandonnée') });
    expect(await unlinkAction('risk:20', 'A-180')).toEqual({ error: "L'action A-180 est abandonnée : consultation seule." });
  });

  it('élément à action unique : déjà porté par une action en cours refusé, par une action vérifiée remplacé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    await insertAction('A-T70');
    expect(await linkAction('requirement:1', 'A-T70')).toEqual({ error: expect.stringContaining("Déjà rattaché à l'action A-196") });
    await (await getDb()).update(t.requirements).set({ actionId: 'A-165' }).where(eq(t.requirements.id, 6));
    expect(await linkAction('requirement:6', 'A-T70')).toEqual({});
    expect((await (await getDb()).select().from(t.requirements).where(eq(t.requirements.id, 6)))[0].actionId).toBe('A-T70');
  });

  it('version de document rattachée après coup : le document de l’action reste inchangé (D15)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    await insertAction('A-T71');
    expect(await linkAction('docversion:24', 'A-T71')).toEqual({});
    expect((await actionRow('A-T71')).documentId).toBeNull();
    expect((await (await getDb()).select().from(t.documentVersions).where(eq(t.documentVersions.id, 24)))[0].actionId).toBe('A-T71');
  });

  it('revue : une seule revue de direction par action', async () => {
    actAs('Animateur QHSE', 'ville-a');
    await insertAction('A-T72', { reviewId: 1 });
    expect(await linkAction('review:3', 'A-T72')).toEqual({ error: "L'action A-T72 relève déjà d'une autre revue de direction." });
    await insertAction('A-T73');
    expect(await linkAction('review:3', 'A-T73')).toEqual({});
    expect((await actionRow('A-T73')).reviewId).toBe(3);
    expect(await linkAction('review:1', 'A-T73')).toMatchObject({ error: 'Revue clôturée : rattachement impossible.' });
  });

  it('site : action d’un autre site que le site sélectionné, élément d’un autre site que l’action : refusés', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await linkAction('risk:3', 'A-T73')).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'all');
    expect(await linkAction('control:6', 'A-T73')).toEqual({ error: "L'action A-T73 concerne un autre site que l'élément à rattacher." });
    expect(await linkAction('risk:13', 'A-T73')).toEqual({ error: "L'action A-T73 concerne un autre site que l'élément à rattacher." });
  });
});

describe('linkFacts (§ 2.12b)', () => {
  it('référence par défaut, site, faits de la source admise', async () => {
    const db = await getDb();
    expect(await linkFacts(db, 'event:EV-2026-128')).toEqual({ reference: 'EV-2026-128', siteId: 'ville-a', facts: { eventType: 'RC' } });
    expect(await linkFacts(db, 'plan:7')).toMatchObject({ siteId: null, facts: { track: 'Fournisseurs' } });
    expect(await linkFacts(db, 'finding:1')).toMatchObject({ reference: expect.stringMatching(/^Constat · .* · §8\.2\.3$/), facts: { track: 'Audits internes' } });
    expect(await linkFacts(db, 'reviewdecision:1')).toMatchObject({ facts: { decisionKind: 'objectif' } });
    expect(await linkFacts(db, 'control:6')).toMatchObject({ siteId: 'ville-b' });
    expect(await linkFacts(db, 'wasteentry:999999')).toBeNull();
    expect(await linkFacts(db, 'inconnu:1')).toBeNull();
    const plan7 = await linkFacts(db, 'plan:7');
    expect(admissibleSources('plan', plan7!.facts)).toEqual(['audit_fournisseur']);
    const ref = (await linkFacts(db, 'requirement:1'))!.reference;
    expect(ref.length).toBeLessThanOrEqual(120);
  });
});
