import { describe, expect, it } from 'vitest';
import { actAs, file, formWith, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { saveQualification } from '@/server/skills';

// « Enregistrer une formation » : limites des attestations jointes (HAB-01). Le formulaire refuse le choix avant l'envoi
// (pickedFilesError, src/components/watch/parts.test.ts) ; le serveur garde les mêmes limites et n'enregistre rien.

freshDemoDatabase();

const MB = 1024 * 1024;
const big = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });
const fields = { personId: 'tnguyen', titleId: 'sst', obtainedOn: '2026-10-01' };

const counts = async () => {
  const db = await getDb();
  return { qualifications: (await db.select().from(t.qualifications)).length, attachments: (await db.select().from(t.attachments)).length };
};

describe('saveQualification : attestations', () => {
  it('plus de 10 fichiers : refusé, rien n’est enregistré', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = await counts();
    const files = Array.from({ length: 11 }, (_, i) => file(`attestation-${i + 1}.pdf`));
    const result = await saveQualification({}, formWith(fields, { files }));
    expect(result.fieldErrors?.files).toBe('10 fichiers au maximum par envoi.');
    expect(await counts()).toEqual(before);
  });

  it('plus de 10 Mo au total : refusé, rien n’est enregistré', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = await counts();
    const result = await saveQualification({}, formWith(fields, { files: [big('recto.pdf', 6 * MB), big('verso.pdf', 6 * MB)] }));
    expect(result.fieldErrors?.files).toBe('Ces fichiers dépassent 10 Mo au total : envoyez-les en plusieurs fois.');
    expect(await counts()).toEqual(before);
  });
});
