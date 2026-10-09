'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { SEVESO_LEVELS } from '@/components/prevention/model';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover } from '@/lib/guard';

/**
 * Règle de prévention d'un site : classement Seveso (seuil haut, seuil bas, non classé) et règle interne
 * « plan de prévention écrit et signé dès la première minute d'intervention » d'une entreprise extérieure.
 * Réservé à l'animateur QHSE et à la direction.
 */
export async function saveSiteRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const seveso = f.oneOf('seveso', SEVESO_LEVELS.map(([k]) => k));
  const ppFromFirstMinute = f.bool('ppFromFirstMinute');
  if (!f.ok) return f.state();

  const db = await getDb();
  const [row] = await db.update(t.sites).set({ seveso, ppFromFirstMinute }).where(eq(t.sites.id, siteId)).returning({ id: t.sites.id });
  if (!row) return { error: 'Site inconnu.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: row.id };
}
