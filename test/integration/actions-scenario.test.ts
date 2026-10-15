import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase } from '../helpers';
import { actionRow, NEW_ACTION } from './actions-helpers';
import { saveAction } from '@/server/plan';
import { moveAction, verifyAction } from '@/server/plan-ui';

// Scénario complet (ACT-40), sur PGlite et, en CI, sur PostgreSQL (TEST_DATABASE_URL) : création depuis un événement →
// 20 % → 60 % → Reportée → 60 % → Terminée → Vérifiée non efficace → action de suite ; journaux des deux actions
// complets et ordonnés.

freshDemoDatabase();

describe('cycle de vie complet d’une action', () => {
  it('création, avancement, report, reprise, terminée, vérifiée non efficace, suite', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const created = await saveAction({}, form({ ...NEW_ACTION, source: 'evenement', link: 'event:EV-2026-131', originRef: '', pilotId: 'tnguyen' }));
    expect(created).toEqual({ ok: true, id: 'A-223' });
    const id = created.id!;
    const steps: [string, string, Record<string, string>?][] = [
      ['a_faire', 'p20'], ['p20', 'p60'], ['p60', 'reportee', { comment: 'Pont roulant en maintenance.' }], ['reportee', 'p60', { dueOn: '2026-11-30' }],
      ['p60', 'terminee', { doneOn: '2026-10-09' }],
    ];
    for (const [from, to, extra] of steps) expect(await moveAction({}, form({ id, from, to, ...extra })), `${from} → ${to}`).toMatchObject({ ok: true });
    const r = await verifyAction({}, form({
      id, from: 'terminee', verifyMethod: 'audit_visite', efficacyNote: 'Mode opératoire non appliqué au poste M3.', effective: 'non_efficace', hours: '6',
      ne_detail: 'Former les monteurs au mode opératoire', ne_pilotId: 'sbenali', ne_priority: 'urgent', ne_dueOn: '2026-10-30', ne_verifyDueOn: '2026-11-20',
      ne_domain: 'securite', ne_siteId: 'ville-a',
    }));
    expect(r).toMatchObject({ ok: true, id, ids: ['A-224'] });
    expect(await actionRow(id)).toMatchObject({ status: 'verifiee', effective: false, hours: 6, closedOn: '2026-10-09', dueOn: '2026-11-30', initialDueOn: '2026-11-15' });
    expect(await actionRow('A-224')).toMatchObject({
      status: 'a_faire', followsActionId: id, followReason: 'non_efficace', eventId: 'EV-2026-131', source: 'evenement', originRef: 'EV-2026-131',
      problem: `Action ${id} jugée non efficace le 09/10/2026 : Mode opératoire non appliqué au poste M3.`,
    });

    const log = (await changeLog('action', id)).map((e) => [e.action, e.summary]);
    expect(log).toEqual([
      ['create', 'Action créée'],
      ['status', 'Avancement : À faire → 20 %'],
      ['status', 'Avancement : 20 % → 60 %'],
      ['status', 'Reportée'],
      ['comment', 'Commentaire ajouté'],
      ['status', 'Reprise : 60 %'],
      ['status', 'Terminée le 09/10/2026'],
      ['status', 'Vérifiée : non efficace'],
      ['follow_up', 'Action de suite A-224 créée (non efficace)'],
    ]);
    const statuses = (await changeLog('action', id)).filter((e) => e.action === 'status')
      .map((e) => (e.details as { fromKey?: string; toKey?: string }[])[0]).map((d) => `${d.fromKey}→${d.toKey}`);
    expect(statuses).toEqual(['a_faire→p20', 'p20→p60', 'p60→reportee', 'reportee→p60', 'p60→terminee', 'terminee→verifiee']);
    expect((await changeLog('action', 'A-224')).map((e) => [e.action, e.summary])).toEqual([['create', `Action de suite de ${id} créée (non efficace)`]]);
    expect((await actionRow(id)).eventId).toBe('EV-2026-131');
  });
});
