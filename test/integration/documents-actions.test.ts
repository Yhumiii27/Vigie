import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { and } from 'drizzle-orm';
import { loadDocuments } from '@/lib/data/documents';
import { createDocument, reviseDocument, updateDocument, updateDraft } from '@/server/documents';

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

// ─── Actions liées (paquet 1 Actions QSE, flux E2) ─────────────────────────
// Rattachement d'une action à une version : service QHSE seulement (ACT-22), action non close, du site du document,
// journalisé sur les actions ; les actions d'un document comprennent celles de ses versions (document_versions.action_id
// ne pose jamais actions.document_id, D15).

const versionOf = async (documentId: string, version: string) =>
  (await (await getDb()).select().from(t.documentVersions)
    .where(and(eq(t.documentVersions.documentId, documentId), eq(t.documentVersions.version, version))))[0];
const firstAction = async (where: (a: typeof t.actions.$inferSelect) => boolean) =>
  (await (await getDb()).select().from(t.actions)).filter(where).sort((a, b) => a.id.localeCompare(b.id))[0];

describe('actions liées à un document et à ses versions', () => {
  it('reviewActions : action d’une version comprise (document_id non posé), Terminée comprise', async () => {
    actAs('Animateur QHSE', 'all');
    const { rows } = await loadDocuments();
    const be = rows.find((r) => r.id === 'PR-BE-001');
    expect(be?.reviewActions.map((a) => a.id)).toContain('A-196');
    expect((await firstAction((a) => a.id === 'A-196'))?.documentId ?? null).toBeNull();
    const fo = rows.find((r) => r.id === 'FO-MON-003');
    expect(fo?.reviewActions.find((a) => a.id === 'A-190')).toMatchObject({ open: true, label: expect.any(String) });
    // Version liée : libellé et avancement de l'action.
    expect(be?.pending?.action).toMatchObject({ id: 'A-196', open: true });
  });

  it('updateDraft : remplacement de l’action liée journalisé sur les deux actions ; champ absent : action conservée', async () => {
    actAs('Animateur QHSE');
    const v = await versionOf('IT-MON-012', 'A');
    expect(v.actionId).toBe('A-215');
    const other = await firstAction((a) => a.siteId === 'ville-a' && !['verifiee', 'abandonnee'].includes(a.status) && a.id !== 'A-215');
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: other.id }))).toEqual({ ok: true, id: 'IT-MON-012' });
    expect((await versionOf('IT-MON-012', 'A')).actionId).toBe(other.id);
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'unlink', summary: 'Détachée de IT-MON-012 · version A', byId: 'clefevre' });
    expect(await lastLog('action', other.id)).toMatchObject({ action: 'link', summary: 'Rattachée à IT-MON-012 · version A', byId: 'clefevre' });
    // Formulaire sans le champ (rôle sans la liste) : action conservée, rien journalisé.
    const before = (await changeLogCount(other.id));
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: 'Objet modifié' }))).toEqual({ ok: true, id: 'IT-MON-012' });
    expect((await versionOf('IT-MON-012', 'A')).actionId).toBe(other.id);
    expect(await changeLogCount(other.id)).toBe(before);
    // Retour à l'action d'origine.
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: 'A-215' }))).toEqual({ ok: true, id: 'IT-MON-012' });
  });

  it('refus : action close, action d’un autre site que le document, action inconnue ; rien écrit', async () => {
    actAs('Animateur QHSE');
    const v = await versionOf('IT-MON-012', 'A');
    const closed = await firstAction((a) => a.status === 'verifiee' && (a.siteId === 'ville-a' || a.siteId === null));
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: closed.id })))
      .toMatchObject({ fieldErrors: { actionId: `L'action ${closed.id} est vérifiée ou abandonnée : elle ne peut plus être rattachée.` } });
    const elsewhere = await firstAction((a) => a.siteId === 'ville-b' && !['verifiee', 'abandonnee'].includes(a.status));
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: elsewhere.id })))
      .toMatchObject({ fieldErrors: { actionId: `L'action ${elsewhere.id} concerne un autre site que le document.` } });
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: 'A-9999' })))
      .toMatchObject({ fieldErrors: { actionId: 'Action introuvable.' } });
    expect((await versionOf('IT-MON-012', 'A')).actionId).toBe('A-215');
  });

  it('document commun : action d’un site hors du site sélectionné refusée ; sous « Tous les sites », acceptée', async () => {
    const db = await getDb();
    // Document commun à tous les sites, en vigueur, sans révision en cours.
    const [docs, versions] = await Promise.all([db.select().from(t.documents), db.select().from(t.documentVersions)]);
    const common = docs.filter((d) => !d.siteId).map((d) => d.id).sort().find((id) => {
      const vs = versions.filter((v) => v.documentId === id);
      return vs.some((v) => v.status === 'approuve') && !vs.some((v) => v.status === 'brouillon' || v.status === 'en_revue');
    })!;
    actAs('Animateur QHSE', 'ville-a');
    const elsewhere = await firstAction((a) => a.siteId === 'ville-b' && !['verifiee', 'abandonnee'].includes(a.status));
    const r = await reviseDocument({}, form({ documentId: common, summary: 'Révision', actionId: elsewhere.id }));
    expect(r.fieldErrors?.actionId).toBe('Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.');
    actAs('Animateur QHSE', 'all');
    expect(await reviseDocument({}, form({ documentId: common, summary: 'Révision', actionId: elsewhere.id }))).toEqual({ ok: true, id: common });
    const created = (await db.select().from(t.documentVersions).where(eq(t.documentVersions.documentId, common))).find((x) => x.status === 'brouillon');
    expect(created?.actionId).toBe(elsewhere.id);
    expect(await lastLog('action', elsewhere.id)).toMatchObject({ action: 'link', summary: `Rattachée à ${common} · version ${created?.version}` });
  });

  it('createDocument : action liée à la version A journalisée', async () => {
    actAs('Animateur QHSE');
    const open = await firstAction((a) => a.siteId === 'ville-a' && !['verifiee', 'abandonnee'].includes(a.status));
    const r = await createDocument({}, form({
      title: 'Consigne de levage', type: 'instruction', process: 'MON', ownerId: 'sbenali', reviewMonths: '24', distribution: 'Atelier', siteId: 'ville-a',
      actionId: open.id,
    }));
    expect(r.ok).toBe(true);
    expect(await lastLog('action', open.id)).toMatchObject({ action: 'link', summary: `Rattachée à ${r.id} · version A`, byId: 'clefevre' });
  });
});

const changeLogCount = async (id: string) => (await (await getDb()).select().from(t.changeLog)
  .where(and(eq(t.changeLog.entityType, 'action'), eq(t.changeLog.entityId, id)))).length;

