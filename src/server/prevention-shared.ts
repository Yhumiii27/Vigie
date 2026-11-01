import 'server-only';
import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { SiteRule } from '@/lib/rules/prevention';
import type { FormState } from '@/lib/forms';

// Aides communes des server actions de la prévention (QUA-26 : entreprises extérieures src/server/contractors.ts, plans
// src/server/prevention.ts, permis src/server/permits.ts). Module sans 'use server' : jamais appelé du navigateur.

export type Result = { error?: string };

/** Permis encore actifs (demandés ou délivrés) : ils suivent le site et l'entreprise de leur plan. */
export const isOpenPermit = (p: { status: string }) => p.status === 'demande' || p.status === 'delivre';

export type Db = Awaited<ReturnType<typeof getDb>>;

/** Règle de prévention du site (classement Seveso, plan « dès la première minute »). */
export async function siteRule(db: Db, siteId: string): Promise<SiteRule | undefined> {
  const [site] = await db.select({ seveso: t.sites.seveso, ppFromFirstMinute: t.sites.ppFromFirstMinute }).from(t.sites).where(eq(t.sites.id, siteId));
  return site;
}

export const done = (id?: string): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id };
};
export const ok = (): Result => {
  revalidatePath('/', 'layout');
  return {};
};

/** Activités de la carte (non annulées) rattachées à un plan ou à un permis (PRV-11). */
export async function linkedActivities(db: Db, kind: 'plan' | 'permit', id: string) {
  const col = kind === 'plan' ? t.siteActivities.preventionPlanId : t.siteActivities.permitId;
  return db.select({
    id: t.siteActivities.id, title: t.siteActivities.title, siteId: t.siteActivities.siteId, contractorId: t.siteActivities.contractorId,
    startOn: t.siteActivities.startOn, endOn: t.siteActivities.endOn,
  }).from(t.siteActivities).where(and(eq(col, id), isNull(t.siteActivities.cancelledAt)));
}

export const ARCHIVED_CONTRACTOR = 'Entreprise archivée : réactivez-la dans l’onglet Entreprises extérieures.';
