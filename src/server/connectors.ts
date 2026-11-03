'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import type { FormState } from '@/lib/forms';
import { requireApprover } from '@/lib/guard';
import { SOURCES } from '@/lib/foreign/labels';
import { refreshSharedReferences } from './foreign-sync';

/**
 * « Actualiser » de l'onglet « Connecteurs » (« Gérer les sites », animateur QHSE et direction) : rafraîchit tout de suite
 * les caches des référentiels partagés et contrôle les lectures directes (src/server/foreign-sync.ts, journal sync_runs).
 * Une source indisponible n'est pas une erreur du formulaire : le message la nomme.
 */
export async function refreshConnectors(): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const results = await refreshSharedReferences(await getDb());
  revalidatePath('/', 'layout');
  const down = results.filter((r) => r.status !== 'ok').map((r) => `${SOURCES[r.source].label} (${SOURCES[r.source].tool})`);
  return { ok: true, message: down.length ? `Sources actualisées, sauf : ${down.join(', ')}.` : 'Sources actualisées.' };
}
