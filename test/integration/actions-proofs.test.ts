import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { actionRow, editFields, insertAction, notificationsOf } from './actions-helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addActionFiles, removeActionFile, saveAction } from '@/server/plan';

// Preuves d'une action (ACT-25, § 10) : ajout par le responsable (tous sites, D19) ou le QHSE (site sélectionné), jamais
// sur une action abandonnée ; une notification par fichier à chaque animateur QHSE pour une preuve du responsable hors QHSE
// (ACT-31) ; retrait (seule suppression physique) avant « Vérifiée » : QHSE, ou le responsable actuel pour sa propre
// preuve (jamais un ancien responsable ni l'encadrement), journalisé.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const add = (actionId: string, files: File[]) => addActionFiles(formWith({ actionId }, { files }));
const filesOf = async (actionId: string) => (await getDb()).select().from(t.attachments).where(and(eq(t.attachments.entityType, 'action'), eq(t.attachments.entityId, actionId)));

describe('ajout', () => {
  it('responsable salarié (autre site sélectionné) : preuves, journal, une notification par fichier (ACT-31)', async () => {
    actAs('Salarié', 'ville-b');
    const before = (await notificationsOf('clefevre')).length;
    expect(await add('A-215', [file('releve.pdf'), file('photo.png', 'image/png', 'png')])).toEqual({ count: 2 });
    expect((await filesOf('A-215')).filter((f) => f.commentId === null && f.uploadedBy === 'tnguyen').map((f) => f.fileName).sort()).toEqual(['photo.png', 'releve.pdf']);
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'attach', summary: '2 preuves ajoutées', byId: 'tnguyen', details: [{ field: 'Fichier', to: 'releve.pdf' }, { field: 'Fichier', to: 'photo.png' }] });
    const added = (await notificationsOf('clefevre')).slice(before);
    expect(added.map((n) => [n.type, n.title])).toEqual([
      ['action_preuve', 'A-215 : preuve « releve.pdf » ajoutée par [T. Nguyen]'],
      ['action_preuve', 'A-215 : preuve « photo.png » ajoutée par [T. Nguyen]'],
    ]);
  });

  it('QHSE : sans notification, site sélectionné ; encadrement non responsable refusé ; abandonnée refusée ; fichiers contrôlés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await notificationsOf('clefevre')).length;
    expect(await add('A-215', [file('pv.pdf')])).toEqual({ count: 1 });
    expect((await notificationsOf('clefevre')).length).toBe(before);
    expect(await add('A-215', [])).toEqual({ error: 'Choisissez au moins un fichier.' });
    expect(await add('A-215', Array.from({ length: 11 }, (_, i) => file(`f${i}.pdf`)))).toEqual({ error: '10 fichiers au maximum par envoi.' });
    expect(await add('A-215', [file('x.exe', 'application/x-msdownload')])).toMatchObject({ error: expect.stringContaining('Format non accepté') });
    expect(await add('A-180', [file()])).toEqual({ error: 'Action abandonnée : consultation seule.' });
    actAs('Animateur QHSE', 'ville-b');
    expect(await add('A-215', [file()])).toEqual({ error: OTHER_SITE });
    actAs('Chef de service', 'ville-a');
    expect(await add('A-215', [file()])).toEqual({ error: DENIED });
    actAs('Salarié');
    expect(await add('A-214', [file()])).toEqual({ error: DENIED });
  });
});

describe('retrait (avant « Vérifiée »)', () => {
  it('responsable : sa propre preuve seulement ; journal ; fichier supprimé', async () => {
    const all = await filesOf('A-215');
    const own = all.find((f) => f.fileName === 'releve.pdf')!;
    const qhse = all.find((f) => f.fileName === 'pv.pdf')!;
    actAs('Salarié');
    expect(await removeActionFile(qhse.id)).toEqual({ error: expect.stringContaining("Seul l'auteur de l'envoi") });
    expect(await removeActionFile(own.id)).toEqual({});
    expect((await filesOf('A-215')).some((f) => f.id === own.id)).toBe(false);
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'detach', summary: 'Preuve retirée', byId: 'tnguyen', details: [{ field: 'Fichier', from: 'releve.pdf', to: null }] });
    expect(await removeActionFile('inconnue')).toEqual({ error: 'Pièce jointe introuvable.' });
  });

  it('ancien responsable après réattribution, encadrement auteur : refusés ; QHSE : admis (site sélectionné)', async () => {
    const photo = (await filesOf('A-215')).find((f) => f.fileName === 'photo.png')!;
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveAction({}, form(editFields(await actionRow('A-215'), { pilotId: 'lmoreau' })))).toMatchObject({ ok: true });
    actAs('Salarié');
    expect(await removeActionFile(photo.id)).toEqual({ error: DENIED });
    // Chef de service responsable de A-T60 : dépose, puis l'action est confiée à un autre.
    await insertAction('A-T60', { pilotId: 'sbenali' });
    actAs('Chef de service', 'ville-a');
    expect(await add('A-T60', [file('bon.pdf')])).toEqual({ count: 1 });
    const [bon] = await filesOf('A-T60');
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveAction({}, form(editFields(await actionRow('A-T60'), { pilotId: 'proux' })))).toMatchObject({ ok: true });
    actAs('Chef de service', 'ville-a');
    expect(await removeActionFile(bon.id)).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-b');
    expect(await removeActionFile(photo.id)).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'ville-a');
    expect(await removeActionFile(photo.id)).toEqual({});
    expect(await removeActionFile(bon.id)).toEqual({});
  });

  it('action Vérifiée : preuve ajoutée encore admise, retrait refusé à tous', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await add('A-176', [file('exercice.pdf')])).toEqual({ count: 1 });
    const [proof] = await filesOf('A-176');
    expect(await removeActionFile(proof.id)).toEqual({ error: 'Action vérifiée ou abandonnée : les preuves ne peuvent plus être retirées.' });
    expect((await filesOf('A-176')).length).toBe(1);
  });
});
