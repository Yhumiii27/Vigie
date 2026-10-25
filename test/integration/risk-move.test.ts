import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { saveRisk } from '@/server/risks';

// DUE-14 : déplacement d'un risque dans une autre unité de travail (saveRisk). Le risque passe en dernier dans l'unité de
// destination ; vers une unité d'un autre site, refusé tant qu'une action ouverte liée au risque relève d'un autre site
// (D20 : une action relève du site de son élément) — jamais de changement de site silencieux d'une action. Jeu de
// démonstration au 09/10/2026 : risque 1 (Atelier montage, site A) porte A-214 et A-215 ouvertes ; risque 2 porte A-205 ;
// risque 14 (Zone d'essais, site B) ne porte que A-165, Vérifiée ; usinage : rangs 6 à 10.

freshDemoDatabase();

const riskOf = async (id: number) => (await (await getDb()).select().from(t.risks).where(eq(t.risks.id, id)))[0];
const moveForm = async (id: number, unitId: string) => {
  const r = await riskOf(id);
  return form({
    id: String(id), unitId, hazard: r.hazard, situation: r.situation, gravity: String(r.gravity), probability: String(r.probability),
    existingMeasures: r.existingMeasures, residualGravity: String(r.residualGravity), residualProbability: String(r.residualProbability),
  });
};

describe('déplacement d’un risque (DUE-14)', () => {
  it('même site : risque placé en dernier dans l’unité de destination, journal du déplacement', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveRisk({}, await moveForm(2, 'usinage'))).toEqual({ ok: true, id: '2' });
    expect(await riskOf(2)).toMatchObject({ unitId: 'usinage', sort: 11 });
    expect(await lastLog('risk', 2)).toMatchObject({ action: 'update', details: [{ field: 'Unité de travail', from: 'Atelier montage', to: 'Atelier usinage' }] });
  });

  it('autre site : refusé tant qu’une action ouverte liée relève de l’ancien site ; rien n’est écrit', async () => {
    actAs('Animateur QHSE', 'all');
    const before = await riskOf(1);
    const r = await saveRisk({}, await moveForm(1, 'essais'));
    expect(r.error).toBe("Le risque porte les actions ouvertes A-214, A-215 d'un autre site que celui de l'unité « Zone d'essais » : "
      + 'une action relève du site de son élément. Détachez-les du risque, changez leur site ou abandonnez-les, puis déplacez le risque.');
    expect(r.fieldErrors).toEqual({ unitId: 'Actions liées d’un autre site.' });
    expect(await riskOf(1)).toEqual(before);
  });

  it('autre site, actions liées closes seulement : déplacement admis, les actions closes gardent leur site', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await saveRisk({}, await moveForm(14, 'montage'))).toEqual({ ok: true, id: '14' });
    expect(await riskOf(14)).toMatchObject({ unitId: 'montage', sort: 6 });
    const [a] = await (await getDb()).select({ siteId: t.actions.siteId }).from(t.actions).where(eq(t.actions.id, 'A-165'));
    expect(a.siteId).toBe('ville-b');
  });

  it('site sélectionné : unité de destination ou d’origine d’un autre site refusée (droits inchangés)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect((await saveRisk({}, await moveForm(13, 'montage'))).error).toBe('Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.');
    actAs('Salarié', 'ville-a');
    expect((await saveRisk({}, await moveForm(2, 'montage'))).error).toBe('Votre rôle ne permet pas cette modification.');
  });
});
