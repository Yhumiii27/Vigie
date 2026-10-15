import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, changeLog, lastLog } from '../helpers';
import { actionRow, editFields, insertAction } from './actions-helpers';
import { closeDb, getDb } from '@/db';
import { missingFields } from '@/lib/action-rules';
import { resetConfig } from '@/lib/env';
import { saveAction } from '@/server/plan';
import { prepareDemo0004 } from '../fixtures/legacy-base';

// Modification d'actions reprises (D24, ACT-40) : base de démonstration 0004 mise à niveau par getDb() (migration 0005,
// upgradeDemo). Les règles de dates et de longueur ne portent que sur les valeurs modifiées : une action reprise aux
// dates incohérentes (A-176 : ouverte le 24/09 après sa date cible du 15/09 et sa vérification du 18/09) ou au détail de
// plus de 4 000 caractères reste modifiable ; ses champs obligatoires manquants restent exigés.

let prep: Awaited<ReturnType<typeof prepareDemo0004>> | null = null;

beforeAll(async () => {
  await closeDb();
  prep = await prepareDemo0004();
  Object.assign(process.env, { VIGIE_DEMO: '1', VIGIE_TODAY: '2026-10-09' });
  resetConfig();
  cookieJar.clear();
  await getDb();
});
afterAll(async () => {
  cookieJar.clear();
  await closeDb();
  await prep?.cleanup();
});

describe('action reprise aux dates incohérentes (A-176)', () => {
  it('coûts modifiés après complétion des champs manquants : admis, seuls les champs changés au journal', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await actionRow('A-176');
    expect(a).toMatchObject({ status: 'verifiee', openedOn: '2026-09-24', dueOn: '2026-09-15', closedOn: '2026-09-18' });
    const missing = missingFields(a);
    // Champs exigés à la modification (ceux que le formulaire porte à l'avancement Vérifiée) ; nature et constat postés
    // sont ignorés : ils ne changent que par « Rouvrir » puis une nouvelle vérification (D17).
    const fill: Record<string, string> = { verifyMethod: 'ecrit', efficacyNote: 'Constat réécrit.' };
    if (missing.includes('doneOn')) fill.doneOn = '2026-09-18';
    const before = (await changeLog('action', 'A-176')).length;
    const r = await saveAction({}, form(editFields(a, { ...fill, estimatedCost: '310', actualCost: '325,50' })));
    expect(r).toEqual({ ok: true, id: 'A-176' });
    expect(await actionRow('A-176')).toMatchObject({ estimatedCost: 310, actualCost: 325.5, dueOn: '2026-09-15', openedOn: '2026-09-24',
      verifyMethod: a.verifyMethod, efficacyNote: a.efficacyNote });
    expect((await changeLog('action', 'A-176')).length).toBe(before + 1);
    const fields = ((await lastLog('action', 'A-176'))!.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['Coût estimé', 'Coût réel']));
    expect(fields).not.toContain('Date cible');
    expect(fields).not.toContain('Vérification planifiée');
  });

  it('date cible changée avant la date d’ouverture : refusée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await actionRow('A-176');
    expect(await saveAction({}, form(editFields(a, { dueOn: '2026-09-20' })))).toMatchObject({ fieldErrors: { dueOn: expect.stringContaining("date d'ouverture") } });
    expect((await actionRow('A-176')).dueOn).toBe('2026-09-15');
  });
});

describe('détail repris de plus de 4 000 caractères', () => {
  it('modification d’un autre champ admise ; le détail modifié garde la limite', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const long = `Détail repris\n${'x'.repeat(5000)}`;
    const a = await insertAction('A-90', { detail: long, openedOn: '2026-05-02', dueOn: '2026-05-01', initialDueOn: '2026-05-01', verifyDueOn: '2026-04-30', legacyOrigin: 'ev' });
    expect(await saveAction({}, form(editFields(a, { priority: 'urgent' })))).toEqual({ ok: true, id: 'A-90' });
    expect(await actionRow('A-90')).toMatchObject({ priority: 'urgent', detail: long });
    expect(await saveAction({}, form(editFields(await actionRow('A-90'), { detail: `${long}y` })))).toMatchObject({ fieldErrors: { detail: '4000 caractères au maximum.' } });
    expect(await saveAction({}, form(editFields(await actionRow('A-90'), { detail: 'Détail ramené à une ligne' })))).toEqual({ ok: true, id: 'A-90' });
  });

  it('champ obligatoire manquant d’une ligne reprise : exigé à la modification', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await insertAction('A-91', { priority: null, domain: null, problem: null });
    const r = await saveAction({}, form(editFields(a, { estimatedCost: '5' })));
    expect(r).toMatchObject({ fieldErrors: { priority: 'Choix obligatoire.', domain: 'Choix obligatoire.', problem: 'Champ obligatoire.' } });
  });
});
