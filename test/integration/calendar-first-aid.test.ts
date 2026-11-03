import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { saveSite } from '@/server/sites';
import { saveTitle } from '@/server/skills';

// Réglages du lot 2 saisis à l'écran : droit local d'Alsace-Moselle d'un site (jours fériés du délai de déclaration CPAM,
// EVT-03) et titre de secourisme (donneurs de soins du registre des accidents bénins, EVT-04). Une case n'est lue que si le
// formulaire la porte (champ témoin) : un autre formulaire (amorçage, ancien client) ne la remet pas à zéro.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const site = async (id: string) => (await (await getDb()).select().from(t.sites).where(eq(t.sites.id, id)))[0];
const title = async (id: string) => (await (await getDb()).select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id)))[0];

describe('site : droit local d’Alsace-Moselle', () => {
  it('encadrement sans administration des sites : refusé', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await saveSite({}, form({ id: 'site_a', label: 'Site de [Ville A]', alsaceMoselleField: '1', alsaceMoselle: 'on' })), role).toEqual({ error: APPROVERS_ONLY });
    }
    expect((await site('site_a')).alsaceMoselle).toBe(false);
  });

  it('cochée, journalisée ; formulaire sans la case : inchangée ; décochée', async () => {
    actAs('Animateur QHSE');
    const { label } = await site('site_a');
    expect(await saveSite({}, form({ id: 'site_a', label, alsaceMoselleField: '1', alsaceMoselle: 'on' }))).toEqual({ ok: true, id: 'site_a' });
    expect((await site('site_a')).alsaceMoselle).toBe(true);
    expect(await lastLog('site', 'site_a')).toMatchObject({
      action: 'update', byId: 'clefevre', details: [{ field: 'Droit local d’Alsace-Moselle', from: 'non', to: 'oui' }],
    });
    expect(await saveSite({}, form({ id: 'site_a', label, sort: '1' }))).toEqual({ ok: true, id: 'site_a' });
    expect((await site('site_a')).alsaceMoselle).toBe(true);
    expect(await saveSite({}, form({ id: 'site_a', label, alsaceMoselleField: '1' }))).toEqual({ ok: true, id: 'site_a' });
    expect((await site('site_a')).alsaceMoselle).toBe(false);
    expect((await lastLog('site', 'site_a'))?.details).toEqual([{ field: 'Droit local d’Alsace-Moselle', from: 'oui', to: 'non' }]);
  });

  it('création d’un site en Moselle', async () => {
    actAs('Direction');
    // D14 : site suivi choisi dans matrix.pub_sites (substitut de démonstration : site_d).
    const r = await saveSite({}, form({ id: '', code: 'site_d', alsaceMoselleField: '1', alsaceMoselle: 'on' }));
    expect(r).toMatchObject({ ok: true, id: 'site_d' });
    expect(await site(r.id!)).toMatchObject({ alsaceMoselle: true });
    expect(await lastLog('site', r.id!)).toMatchObject({ action: 'create', summary: 'Site « Site de [Ville D] — atelier de maintenance » suivi (Matrix : site_d) · droit local d’Alsace-Moselle' });
  });
});

describe('titre suivi : secourisme', () => {
  it('écran Habilitations fermé ou en consultation : refusé', async () => {
    for (const role of ['Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await saveTitle({}, form({ id: 'sst', label: 'SST', validityMonths: '24', firstAidField: '1' })), role).toEqual({ error: DENIED });
    }
    expect((await title('sst')).firstAid).toBe(true);
  });

  it('création cochée ; modification sans la case : inchangée ; décochée, journalisée', async () => {
    actAs('Animateur QHSE');
    const r = await saveTitle({}, form({ label: 'Secourisme en milieu isolé', validityMonths: '24', firstAidField: '1', firstAid: 'on' }));
    expect(r).toMatchObject({ ok: true });
    expect(await title(r.id!)).toMatchObject({ firstAid: true });
    expect(await lastLog('training_title', r.id!)).toMatchObject({ action: 'create', summary: 'Titre « Secourisme en milieu isolé » ajouté (secourisme)' });

    expect(await saveTitle({}, form({ id: r.id!, label: 'Secourisme en milieu isolé', validityMonths: '36' }))).toEqual({ ok: true, id: r.id });
    expect(await title(r.id!)).toMatchObject({ firstAid: true, validityMonths: 36 });
    expect((await lastLog('training_title', r.id!))?.details).toEqual([{ field: 'Validité (mois)', from: '24', to: '36' }]);

    expect(await saveTitle({}, form({ id: r.id!, label: 'Secourisme en milieu isolé', validityMonths: '36', firstAidField: '1' }))).toEqual({ ok: true, id: r.id });
    expect(await title(r.id!)).toMatchObject({ firstAid: false });
    expect(await lastLog('training_title', r.id!)).toMatchObject({
      action: 'update', byId: 'clefevre', details: [{ field: 'Secourisme', from: 'oui', to: 'non' }],
    });
  });
});
