'use server';

import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { ChangeEntry } from '@/lib/change-entry';
import { loadChangeLog, loadChangeLogs } from '@/lib/data/changelog';
import { canApprove, canEdit, canSee, type Role, type ScreenKey } from '@/lib/domain';
import { getSession, siteFilter } from '@/lib/session';

// Historique d'une fiche chargé à son ouverture (QUA-11 ; composant LazyChangeLog) plutôt qu'avec toute la liste de
// l'écran. Lecture seule, aucun journal. Mêmes droits que la page qui affichait l'historique : écran ouvert au rôle
// (canSee, ou `allow` quand l'historique n'est montré qu'à la saisie : canEdit, validateurs) et fiche visible sur le site
// sélectionné (siteFilter('site') : site sélectionné, « Tous les sites » = périmètre ; `scope: 'perimeter'` pour
// l'administration des sites, ouverte quel que soit le site sélectionné) quand elle porte un site ; exigences,
// entreprises extérieures, versions du DUERP : communes à l'entreprise. Fiche introuvable ou invisible : même réponse,
// sans rien révéler.

export type HistoryEntity =
  | 'requirement' | 'control' | 'prevention_plan' | 'contractor'
  // Paquet 3 (traçabilité et journal) :
  | 'site' | 'site_map' | 'site_activity' | 'work_unit' | 'duerp_version' | 'person' | 'skill_cell' | 'document' | 'consumption'
  // Paquet 5 (conformité réglementaire) : objectifs QHSE (AUD-13), contexte du système de management (CNF-05).
  | 'qhse_objective' | 'context_item'
  // Paquet 13 : registre de sécurité (VEI-15), situations d'urgence (CNF-08), demandes de changement (CNF-11).
  | 'safety_notice' | 'emergency_situation' | 'change_request'
  // Classe 1, lot A (fin de QUA-11) : risques et demandes d'accès au DUERP, audits, environnement.
  | 'risk' | 'duerp_access_request' | 'audit_plan_item' | 'audit_finding' | 'certification' | 'waste_stream' | 'waste_entry';

type Rule = {
  screen: ScreenKey;
  /** Droit propre à l'historique (par défaut : écran ouvert au rôle). */
  allow?(role: Role): boolean;
  scope?: 'site' | 'perimeter';
  siteOf(id: string): Promise<{ siteId: string | null } | undefined>;
  /** Lecture propre à la fiche (plusieurs entités du journal) ; par défaut, entrées du type `entity`. */
  load?(id: string): Promise<ChangeEntry[]>;
};

const num = (id: string) => (/^\d{1,9}$/.test(id) ? Number(id) : null);
const ISO_MONTH = /^\d{4}-\d{2}-01$/;
const db = () => getDb();

const RULES: Record<HistoryEntity, Rule> = {
  requirement: {
    screen: 'watch',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [r] = await (await db()).select({ id: t.requirements.id }).from(t.requirements).where(eq(t.requirements.id, n));
      return r && { siteId: null };
    },
  },
  control: {
    screen: 'watch',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [c] = await (await db()).select({ siteId: t.controls.siteId }).from(t.controls).where(eq(t.controls.id, n));
      return c;
    },
  },
  prevention_plan: {
    screen: 'prevention',
    async siteOf(id) {
      const [p] = await (await db()).select({ siteId: t.preventionPlans.siteId }).from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
      return p;
    },
  },
  contractor: {
    screen: 'prevention',
    async siteOf(id) {
      const [c] = await (await db()).select({ id: t.contractors.id }).from(t.contractors).where(eq(t.contractors.id, id));
      return c && { siteId: null };
    },
  },
  // Site (TDB-09) : règle Seveso / plan de prévention, responsable QHSE, archivage… — administration des sites.
  site: {
    screen: 'prevention',
    allow: canApprove,
    scope: 'perimeter',
    async siteOf(id) {
      const [s] = await (await db()).select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, id));
      return s && { siteId: s.id };
    },
  },
  // Carte du site (PRV-12) : zones, voies, plan de fond et échelle, journalisés sur le site.
  site_map: {
    screen: 'prevention',
    async siteOf(id) {
      const [s] = await (await db()).select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, id));
      return s && { siteId: s.id };
    },
  },
  site_activity: {
    screen: 'prevention',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [a] = await (await db()).select({ siteId: t.siteActivities.siteId }).from(t.siteActivities).where(eq(t.siteActivities.id, n));
      return a;
    },
  },
  // DUERP (DUE-06) : historique montré à la saisie seulement, comme celui des risques.
  work_unit: {
    screen: 'risks',
    allow: (role) => canEdit(role, 'risks'),
    async siteOf(id) {
      const [u] = await (await db()).select({ siteId: t.workUnits.siteId }).from(t.workUnits).where(eq(t.workUnits.id, id));
      return u;
    },
  },
  duerp_version: {
    screen: 'risks',
    allow: (role) => canEdit(role, 'risks'),
    async siteOf(id) {
      const [v] = await (await db()).select({ version: t.duerpVersions.version }).from(t.duerpVersions).where(eq(t.duerpVersions.version, id));
      return v && { siteId: null };
    },
  },
  // Habilitations (HAB-03) : fiche salarié et case salarié × titre (formations, attestations, exigence).
  person: {
    screen: 'skills',
    allow: (role) => canEdit(role, 'skills'),
    async siteOf(id) {
      const [p] = await (await db()).select({ siteId: t.people.siteId }).from(t.people).where(eq(t.people.id, id));
      return p;
    },
  },
  skill_cell: {
    screen: 'skills',
    allow: (role) => canEdit(role, 'skills'),
    async siteOf(id) {
      const [personId, titleId, extra] = id.split('|');
      if (!personId || !titleId || extra !== undefined) return undefined;
      const d = await db();
      const [[p], [title]] = await Promise.all([
        d.select({ siteId: t.people.siteId }).from(t.people).where(eq(t.people.id, personId)),
        d.select({ id: t.trainingTitles.id }).from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
      ]);
      return p && title ? p : undefined;
    },
    async load(id) {
      const [personId, titleId] = id.split('|');
      const quals = await (await db()).select({ id: t.qualifications.id }).from(t.qualifications)
        .where(and(eq(t.qualifications.personId, personId), eq(t.qualifications.titleId, titleId)));
      const [byQual, requirement] = await Promise.all([loadChangeLogs('qualification', quals.map((q) => q.id)), loadChangeLog('qualification_requirement', id)]);
      return [...[...byQual.values()].flat(), ...requirement].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
    },
  },
  // Documents maîtrisés (DOC-04) : cycle de vie des versions et métadonnées, montré à la saisie seulement.
  document: {
    screen: 'docs',
    allow: (role) => canEdit(role, 'docs'),
    async siteOf(id) {
      const [d] = await (await db()).select({ siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, id));
      return d;
    },
  },
  // Relevés de consommation d'un mois et d'un site (DOC-10) : identifiant « site|AAAA-MM-01 ».
  consumption: {
    screen: 'env',
    async siteOf(id) {
      const [siteId, month, extra] = id.split('|');
      if (!siteId || !month || extra !== undefined || !ISO_MONTH.test(month)) return undefined;
      const [s] = await (await db()).select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, siteId));
      return s && { siteId: s.id };
    },
  },
  // Objectifs QHSE (AUD-13) : écran Audits ; objectif d'un site ou de tous les sites, sur tout le périmètre.
  qhse_objective: {
    screen: 'audits',
    scope: 'perimeter',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [o] = await (await db()).select({ siteId: t.qhseObjectives.siteId }).from(t.qhseObjectives).where(eq(t.qhseObjectives.id, n));
      return o;
    },
  },
  // Contexte du système de management (CNF-05) : commun à l'entreprise.
  context_item: {
    screen: 'audits',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [c] = await (await db()).select({ id: t.contextItems.id }).from(t.contextItems).where(eq(t.contextItems.id, n));
      return c && { siteId: null };
    },
  },
  // Registre de sécurité (VEI-15) : observation ou mise en demeure d'un site.
  safety_notice: {
    screen: 'watch',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [o] = await (await db()).select({ siteId: t.safetyNotices.siteId }).from(t.safetyNotices).where(eq(t.safetyNotices.id, n));
      return o;
    },
  },
  // Situation d'urgence d'un site (CNF-08) : lecteurs de l'écran « Évaluation des risques ».
  emergency_situation: {
    screen: 'risks',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [o] = await (await db()).select({ siteId: t.emergencySituations.siteId }).from(t.emergencySituations).where(eq(t.emergencySituations.id, n));
      return o;
    },
  },
  // Demande de changement (CNF-11) : lecteurs de l'écran Audits ; site de la demande (null : entreprise).
  change_request: {
    screen: 'audits',
    async siteOf(id) {
      const [o] = await (await db()).select({ siteId: t.changeRequests.siteId }).from(t.changeRequests).where(eq(t.changeRequests.id, id));
      return o;
    },
  },
  // Risque du DUERP (DUE-06) : historique montré à la saisie seulement ; site de son unité de travail.
  risk: {
    screen: 'risks',
    allow: (role) => canEdit(role, 'risks'),
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [r] = await (await db()).select({ siteId: t.workUnits.siteId }).from(t.risks)
        .innerJoin(t.workUnits, eq(t.workUnits.id, t.risks.unitId)).where(eq(t.risks.id, n));
      return r;
    },
  },
  // Registre des demandes d'accès au DUERP (DUE-05) : validateurs qui modifient le DUERP (comme le registre).
  duerp_access_request: {
    screen: 'risks',
    allow: (role) => canApprove(role) && canEdit(role, 'risks'),
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [r] = await (await db()).select({ siteId: t.duerpAccessRequests.siteId }).from(t.duerpAccessRequests).where(eq(t.duerpAccessRequests.id, n));
      return r;
    },
  },
  // Programme d'audit, constats et certifications (AUD-22 : site de l'élément, null = entreprise) : lecteurs de l'écran.
  audit_plan_item: {
    screen: 'audits',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [p] = await (await db()).select({ siteId: t.auditPlanItems.siteId }).from(t.auditPlanItems).where(eq(t.auditPlanItems.id, n));
      return p;
    },
  },
  audit_finding: {
    screen: 'audits',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [f] = await (await db()).select({ siteId: t.auditFindings.siteId }).from(t.auditFindings).where(eq(t.auditFindings.id, n));
      return f;
    },
  },
  certification: {
    screen: 'audits',
    async siteOf(id) {
      const [c] = await (await db()).select({ siteId: t.certifications.siteId }).from(t.certifications).where(eq(t.certifications.id, id));
      return c;
    },
  },
  // Environnement (DOC-09, DOC-02) : filière et enlèvement d'un site.
  waste_stream: {
    screen: 'env',
    async siteOf(id) {
      const [w] = await (await db()).select({ siteId: t.wasteStreams.siteId }).from(t.wasteStreams).where(eq(t.wasteStreams.id, id));
      return w;
    },
  },
  waste_entry: {
    screen: 'env',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [w] = await (await db()).select({ siteId: t.wasteEntries.siteId }).from(t.wasteEntries).where(eq(t.wasteEntries.id, n));
      return w;
    },
  },
};

const NOT_FOUND = 'Historique introuvable.';

/** Historique (les entrées les plus récentes d'abord) d'une fiche que la personne connectée peut lire. */
export async function loadEntityHistory(entity: HistoryEntity, id: string): Promise<{ entries: ChangeEntry[] } | { error: string }> {
  const rule = typeof entity === 'string' && Object.hasOwn(RULES, entity) ? RULES[entity] : undefined;
  if (!rule || typeof id !== 'string' || !id || id.length > 120) return { error: NOT_FOUND };
  const { role } = await getSession();
  if (!canSee(role, rule.screen) || (rule.allow && !rule.allow(role))) return { error: NOT_FOUND };
  const row = await rule.siteOf(id);
  if (!row || !(await siteFilter(rule.scope ?? 'site'))(row.siteId)) return { error: NOT_FOUND };
  return { entries: rule.load ? await rule.load(id) : await loadChangeLog(entity, id) };
}
