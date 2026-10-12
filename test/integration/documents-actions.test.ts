import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { createDocument, updateDocument } from '@/server/documents';

// Informations d'un document maîtrisé (DOC-01) : droits, site, propriétaire sorti de l'effectif et site archivé conservés
// tant qu'ils ne sont pas remplacés, journal des modifications.

freshDemoDatabase();

/** Formulaire « Modifier les informations » tel que la fiche l'envoie : valeurs enregistrées, éventuellement modifiées. */
async function metadataForm(id: string, changes: Record<string, string> = {}) {
  const db = await getDb();
  const [d] = await db.select().from(t.documents).where(eq(t.documents.id, id));
  return form({
    id, title: d.title, type: d.type, process: d.process, ownerId: d.ownerId, reviewMonths: String(d.reviewMonths),
    distribution: d.distribution, siteId: d.siteId ?? '', ...changes,
  });
}

const document = async (id: string) => (await (await getDb()).select().from(t.documents).where(eq(t.documents.id, id)))[0];

describe('updateDocument', () => {
  it('droits : Salarié refusé, Chef de service en consultation seule', async () => {
    actAs('Salarié');
    expect(await updateDocument({}, await metadataForm('IT-MON-012'))).toEqual({ error: 'Votre rôle ne permet pas cette modification.' });
    actAs('Chef de service');
    expect(await updateDocument({}, await metadataForm('IT-MON-012'))).toEqual({ error: expect.stringContaining('Consultation seule') });
  });

  it('site : document d’un autre site que celui sélectionné refusé', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await updateDocument({}, await metadataForm('IT-MON-012', { title: 'Autre titre' }))).toEqual({ error: expect.stringContaining('autre site') });
    expect((await document('IT-MON-012')).title).toBe('Retournement des bâtis > 1 t');
  });

  it('propriétaire sorti de l’effectif : conservé tant qu’il n’est pas remplacé, jamais choisi à nouveau', async () => {
    const db = await getDb();
    await db.update(t.documents).set({ ownerId: 'ylambert' }).where(eq(t.documents.id, 'IT-MON-012'));
    actAs('Animateur QHSE', 'ville-a');
    expect(await updateDocument({}, await metadataForm('IT-MON-012', { distribution: 'Atelier montage · poste M3' }))).toEqual({ ok: true, id: 'IT-MON-012' });
    expect(await document('IT-MON-012')).toMatchObject({ ownerId: 'ylambert', distribution: 'Atelier montage · poste M3' });

    const refused = await updateDocument({}, await metadataForm('PR-QHSE-001', { ownerId: 'ylambert' }));
    expect(refused.fieldErrors?.ownerId).toBe("Propriétaire sorti de l'effectif : choisissez une personne présente.");
    expect((await document('PR-QHSE-001')).ownerId).toBe('clefevre');

    const created = await createDocument({}, form({
      type: 'procedure', process: 'QHSE', title: 'Document de test', ownerId: 'ylambert', reviewMonths: '24', siteId: 'ville-a',
      distribution: 'Encadrement', summary: 'Création du document',
    }));
    expect(created.fieldErrors?.ownerId).toBe("Propriétaire sorti de l'effectif : choisissez une personne présente.");
    expect(await db.select().from(t.documents).where(eq(t.documents.title, 'Document de test'))).toEqual([]);
  });

  it('site archivé : conservé sans changement, jamais choisi pour un autre document', async () => {
    const db = await getDb();
    await db.update(t.documents).set({ siteId: 'ville-c' }).where(eq(t.documents.id, 'FO-MON-003'));
    actAs('Animateur QHSE', 'all');
    expect(await updateDocument({}, await metadataForm('FO-MON-003', { reviewMonths: '24' }))).toEqual({ ok: true, id: 'FO-MON-003' });
    expect(await document('FO-MON-003')).toMatchObject({ siteId: 'ville-c', reviewMonths: 24 });

    expect(await updateDocument({}, await metadataForm('IT-USI-004', { siteId: 'ville-c' }))).toEqual({ error: 'Site archivé ou inconnu : choisissez un site actif.' });
    expect((await document('IT-USI-004')).siteId).toBe('ville-a');
  });

  it('journal : changement de propriétaire et de site tracé, enregistrement sans changement non journalisé', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await updateDocument({}, await metadataForm('FO-QHSE-010', { ownerId: 'tnguyen', siteId: 'ville-a' }))).toEqual({ ok: true, id: 'FO-QHSE-010' });
    const log = await lastLog('document', 'FO-QHSE-010');
    expect(log).toMatchObject({ action: 'update', summary: 'Informations du document modifiées', byId: 'clefevre' });
    expect(log?.details).toEqual([
      { field: 'Propriétaire', from: '[S. Benali]', to: '[T. Nguyen]' },
      { field: 'Site', from: 'Tous les sites', to: 'Site de [Ville A] — siège et ateliers' },
    ]);
    const before = log?.id;
    expect(await updateDocument({}, await metadataForm('FO-QHSE-010'))).toEqual({ ok: true, id: 'FO-QHSE-010' });
    expect((await lastLog('document', 'FO-QHSE-010'))?.id).toBe(before);
  });
});
