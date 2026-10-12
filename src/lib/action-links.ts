import 'server-only';
import { cache } from 'react';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addActionBlocker } from '@/components/events/shared';
import { entryRef } from '@/components/environment/model';
import { canEdit, isClosedActionStatus, type Role, type ScreenKey } from './domain';
import { requireInSite } from './guard';
import { ORIGIN_COLUMNS, ORIGIN_LINKS, loadOriginCatalog, originLink, resolveOriginRef, type OriginColumn } from './origin-links';
import { allowedSiteIds, inPerimeter, inSite } from './session';

// ─── Rattachements d'une action du plan à sa source ─────────────────────────
//
// Registre unique utilisé par saveAction (champ caché `link` à la création), par LinkActionButton
// (rattacher / détacher une action existante, src/server/links.ts), par l'annulation d'une action
// (détacher partout) et par la fiche action (liens vers les sources).
// Syntaxe d'un lien : `<type>:<arg>[:<arg>]`, ex. risk:12 · finding:3 · qualification:tnguyen:hauteur.
// Ajouter un type = ajouter une entrée à ACTION_LINKS (les quatre fonctions), sans autre changement.
// Sources d'origine (ACT-01, `origin`) : plan de prévention, permis, document, filière et enlèvement du registre des
// déchets, portés par une colonne de l'action (src/lib/origin-links.ts) ; posées à la création seulement (lien explicite
// ou référence d'origine résolue, originLinkFor), jamais rattachées ni détachées ensuite, conservées à l'annulation.

/** Source d'une action, affichée sur sa fiche (lien cliquable). */
export type ActionSource = { kind: string; label: string; href: string; detail?: string };

type LinkKind = {
  /** Écran qui porte la source : droit de rattacher (canSee) et libellé. */
  screen: ScreenKey;
  /** Rattache l'action ; renvoie un message d'erreur (source introuvable, close…) ou null. */
  attach(tx: DbOrTx, args: string[], actionId: string): Promise<string | null>;
  /** Détache l'action de cette source (sans effet si elle n'y est pas rattachée). */
  detach(tx: DbOrTx, args: string[], actionId: string): Promise<void>;
  /** Détache l'action de toutes les sources de ce type (annulation de l'action). */
  detachAll(tx: DbOrTx, actionId: string): Promise<void>;
  /** Source conservée sur une action annulée (detachAll sans effet) : absente des sources détachées. */
  keptOnCancel?: boolean;
  /** Site de la source (contrôle requireInSite) ; undefined = source sans site. */
  siteOf?(tx: DbOrTx, args: string[]): Promise<string | null | undefined>;
  /** Fiche de la source dont l'historique (change_log) trace aussi les rattachements et détachements ; absent = historique de l'action seul. */
  logAs?(args: string[]): { entityType: string; entityId: string | number } | null;
  /** Toutes les sources de ce type, par action (fiche action). */
  sources(db: DbOrTx, actionIds?: string[]): Promise<(ActionSource & { actionId: string })[]>;
  /** Source d'origine portée par cette colonne de l'action : fixée à la création, jamais rattachée ni détachée ensuite. */
  origin?: OriginColumn;
};

const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : NaN);
const NOT_FOUND = 'Élément introuvable : le rattachement est impossible.';
/** Rattacher ou détacher une source d'origine après la création de l'action (linkAction, unlinkAction). */
export const ORIGIN_LOCKED = "L'origine d'une action est fixée à sa création : elle ne se rattache ni ne se détache ensuite.";
const enc = encodeURIComponent;
/** Revue de direction sur /audits : année du programme de la revue, carte « Revue » ouverte sur elle. */
const reviewHref = (id: number, reviewOn: string) => `/audits?annee=${reviewOn.slice(0, 4)}&revue=${id}#revue`;
const only = (ids?: string[]) => <R extends { actionId: string | null }>(rows: R[]) => rows.filter((r) => !!r.actionId && (!ids || ids.includes(r.actionId)));

/** Source à action unique (constat, exigence, contrôle…) déjà portée par une autre action ouverte : refus, jamais de remplacement silencieux. */
async function slotTaken(tx: DbOrTx, current: string | null, actionId: string): Promise<string | null> {
  if (!current || current === actionId) return null;
  const [prev] = await tx.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.id, current));
  return prev && !isClosedActionStatus(prev.status) ? `Déjà rattaché à l'action ${current} : détachez-la avant d'en rattacher une autre.` : null;
}

/** Source d'origine trouvée (`blocked` : rattachement refusé, ex. plan annulé). */
type OriginSource = { id: string | number; siteId: string | null; blocked?: string | null };

/**
 * Type de lien d'une source d'origine (colonne `column` de l'action) : rattachement à la création seulement ; detach et
 * detachAll sans effet (origine verrouillée, conservée sur une action annulée).
 */
function originKind(column: OriginColumn, def: {
  screen: ScreenKey;
  find(tx: DbOrTx, id: string): Promise<OriginSource | undefined>;
  logAs?: LinkKind['logAs'];
  sources: LinkKind['sources'];
}): LinkKind {
  return {
    screen: def.screen,
    origin: column,
    keptOnCancel: true,
    async attach(tx, [id = ''], actionId) {
      const src = await def.find(tx, id);
      if (!src) return NOT_FOUND;
      if (src.blocked) return src.blocked;
      const [a] = await tx.select({ current: t.actions[column] }).from(t.actions).where(eq(t.actions.id, actionId));
      if (!a) return 'Action introuvable.';
      if (a.current != null && String(a.current) !== String(src.id)) return ORIGIN_LOCKED;
      await tx.update(t.actions).set({ [column]: src.id } as Partial<typeof t.actions.$inferInsert>).where(eq(t.actions.id, actionId));
      return null;
    },
    async detach() { /* origine verrouillée */ },
    async detachAll() { /* la source d'origine reste lisible sur une action annulée */ },
    async siteOf(tx, [id = '']) {
      return (await def.find(tx, id))?.siteId;
    },
    logAs: def.logAs,
    sources: def.sources,
  };
}

const ORIGIN_KINDS: Record<string, LinkKind> = {
  [ORIGIN_LINKS.preventionPlanId.kind]: originKind('preventionPlanId', {
    screen: 'prevention',
    async find(tx, id) {
      const [p] = await tx.select({ id: t.preventionPlans.id, siteId: t.preventionPlans.siteId, status: t.preventionPlans.status }).from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
      return p && { ...p, blocked: p.status === 'annule' ? 'Plan de prévention annulé : rattachement impossible.' : null };
    },
    logAs: ([id]) => (id ? { entityType: 'prevention_plan', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.preventionPlans.id, title: t.preventionPlans.title })
        .from(t.actions).innerJoin(t.preventionPlans, eq(t.actions.preventionPlanId, t.preventionPlans.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, kind: 'preventionplan', label: r.id, detail: r.title, href: `/prevention?plan=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.permitId.kind]: originKind('permitId', {
    screen: 'prevention',
    async find(tx, id) {
      const [p] = await tx.select({ id: t.permits.id, siteId: t.permits.siteId, status: t.permits.status }).from(t.permits).where(eq(t.permits.id, id));
      return p && { ...p, blocked: p.status === 'annule' ? 'Permis annulé : rattachement impossible.' : null };
    },
    logAs: ([id]) => (id ? { entityType: 'permit', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.permits.id, description: t.permits.description })
        .from(t.actions).innerJoin(t.permits, eq(t.actions.permitId, t.permits.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, kind: 'permit', label: r.id, detail: r.description.slice(0, 80), href: `/prevention?onglet=permis&permis=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.documentId.kind]: originKind('documentId', {
    screen: 'docs',
    async find(tx, id) {
      const [d] = await tx.select({ id: t.documents.id, siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, id));
      return d;
    },
    logAs: ([id]) => (id ? { entityType: 'document', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.documents.id, title: t.documents.title })
        .from(t.actions).innerJoin(t.documents, eq(t.actions.documentId, t.documents.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, kind: 'document', label: r.id, detail: r.title, href: `/documents?doc=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.wasteStreamId.kind]: originKind('wasteStreamId', {
    screen: 'env',
    async find(tx, id) {
      const [s] = await tx.select({ id: t.wasteStreams.id, siteId: t.wasteStreams.siteId }).from(t.wasteStreams).where(eq(t.wasteStreams.id, id));
      return s;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.wasteStreams.id, label: t.wasteStreams.label })
        .from(t.actions).innerJoin(t.wasteStreams, eq(t.actions.wasteStreamId, t.wasteStreams.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, kind: 'wastestream', label: r.id, detail: r.label, href: `/environnement?filiere=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.wasteEntryId.kind]: originKind('wasteEntryId', {
    screen: 'env',
    async find(tx, id) {
      const [e] = await tx.select({ id: t.wasteEntries.id, siteId: t.wasteEntries.siteId, cancelledAt: t.wasteEntries.cancelledAt }).from(t.wasteEntries).where(eq(t.wasteEntries.id, num(id)));
      return e && { id: e.id, siteId: e.siteId, blocked: e.cancelledAt ? 'Enlèvement annulé : rattachement impossible.' : null };
    },
    logAs: ([id]) => (Number.isInteger(num(id)) ? { entityType: 'waste_entry', entityId: num(id) } : null),
    async sources(db, ids) {
      const rows = await db.select({
        actionId: t.actions.id, streamId: t.wasteEntries.streamId, removedOn: t.wasteEntries.removedOn, cancelledAt: t.wasteEntries.cancelledAt, stream: t.wasteStreams.label,
      }).from(t.actions).innerJoin(t.wasteEntries, eq(t.actions.wasteEntryId, t.wasteEntries.id)).innerJoin(t.wasteStreams, eq(t.wasteEntries.streamId, t.wasteStreams.id));
      // Registre de l'année de l'enlèvement, filtré sur sa filière (vue « Annulés » pour un enlèvement annulé).
      return only(ids)(rows).map((r) => ({
        actionId: r.actionId, kind: 'wasteentry', label: entryRef(r.streamId, r.removedOn), detail: `${r.stream}${r.cancelledAt ? ' · enlèvement annulé' : ''}`,
        href: `/environnement?annee=${r.removedOn.slice(0, 4)}&filiere=${enc(r.streamId)}${r.cancelledAt ? '&vue=annules' : ''}`,
      }));
    },
  }),
};

export const ACTION_LINKS: Record<string, LinkKind> = {
  event: {
    screen: 'events',
    async attach(tx, [id], actionId) {
      const [ev] = await tx.select().from(t.events).where(eq(t.events.id, id ?? ''));
      if (!ev) return NOT_FOUND;
      if (ev.dismissedAt) return 'Événement classé sans suite : rattachement impossible.';
      const blocked = addActionBlocker(ev.step);
      if (blocked) return blocked;
      await tx.update(t.actions).set({ eventId: ev.id }).where(eq(t.actions.id, actionId));
      return null;
    },
    async detach(tx, [id], actionId) {
      await tx.update(t.actions).set({ eventId: null }).where(and(eq(t.actions.id, actionId), eq(t.actions.eventId, id ?? '')));
    },
    async detachAll() { /* l'événement d'origine reste lisible sur une action annulée (fiche événement : « Annulée ») */ },
    keptOnCancel: true,
    async siteOf(tx, [id]) {
      const [ev] = await tx.select({ siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, id ?? ''));
      return ev?.siteId;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.events.id, title: t.events.title })
        .from(t.actions).innerJoin(t.events, eq(t.actions.eventId, t.events.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'event', label: `${r.id} · ${r.title}`, href: `/evenements?sel=${r.id}` }));
    },
  },

  risk: {
    screen: 'risks',
    async attach(tx, [a], actionId) {
      const [risk] = await tx.select({ id: t.risks.id, archivedAt: t.risks.archivedAt }).from(t.risks).where(eq(t.risks.id, num(a)));
      if (!risk) return NOT_FOUND;
      if (risk.archivedAt) return 'Risque archivé : rattachement impossible.';
      await tx.insert(t.riskActions).values({ riskId: risk.id, actionId }).onConflictDoNothing();
      return null;
    },
    async detach(tx, [a], actionId) {
      await tx.delete(t.riskActions).where(and(eq(t.riskActions.riskId, num(a)), eq(t.riskActions.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.delete(t.riskActions).where(eq(t.riskActions.actionId, actionId));
    },
    async siteOf(tx, [a]) {
      const [r] = await tx.select({ siteId: t.workUnits.siteId }).from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.risks.id, num(a)));
      return r ? r.siteId : undefined;
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'risk', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.riskActions.actionId, riskId: t.risks.id, unitId: t.workUnits.id, unit: t.workUnits.label, hazard: t.risks.hazard, g: t.risks.gravity, p: t.risks.probability })
        .from(t.riskActions).innerJoin(t.risks, eq(t.riskActions.riskId, t.risks.id)).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'risk', label: `${r.unit} · ${r.hazard}`, detail: `cotation ${r.g * r.p}`, href: `/risques?unite=${r.unitId}&risque=${r.riskId}` }));
    },
  },

  finding: {
    screen: 'audits',
    async attach(tx, [a], actionId) {
      const [row] = await tx.select({ actionId: t.auditFindings.actionId, cancelledAt: t.auditFindings.cancelledAt }).from(t.auditFindings).where(eq(t.auditFindings.id, num(a)));
      if (!row) return NOT_FOUND;
      if (row.cancelledAt) return 'Constat annulé : rattachement impossible.';
      const taken = await slotTaken(tx, row.actionId, actionId);
      if (!taken) await tx.update(t.auditFindings).set({ actionId }).where(eq(t.auditFindings.id, num(a)));
      return taken;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.auditFindings).set({ actionId: null }).where(and(eq(t.auditFindings.id, num(a)), eq(t.auditFindings.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.auditFindings).set({ actionId: null }).where(eq(t.auditFindings.actionId, actionId));
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'audit_finding', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.auditFindings.actionId, id: t.auditFindings.id, audit: t.auditFindings.audit, cancelledAt: t.auditFindings.cancelledAt })
        .from(t.auditFindings).where(isNotNull(t.auditFindings.actionId));
      // Un constat annulé garde son action : la source reste lisible (filtre « Annulés » de l'écran Audits).
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'finding', label: `Constat${r.cancelledAt ? ' annulé' : ''} · ${r.audit}`, href: `/audits?constat=${r.id}` }));
    },
  },

  plan: {
    screen: 'audits',
    async attach(tx, [a], actionId) {
      const [row] = await tx.select({ actionId: t.auditPlanItems.actionId }).from(t.auditPlanItems).where(eq(t.auditPlanItems.id, num(a)));
      if (!row) return NOT_FOUND;
      const taken = await slotTaken(tx, row.actionId, actionId);
      if (!taken) await tx.update(t.auditPlanItems).set({ actionId }).where(eq(t.auditPlanItems.id, num(a)));
      return taken;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.auditPlanItems).set({ actionId: null }).where(and(eq(t.auditPlanItems.id, num(a)), eq(t.auditPlanItems.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.auditPlanItems).set({ actionId: null }).where(eq(t.auditPlanItems.actionId, actionId));
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'audit_plan_item', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.auditPlanItems.actionId, id: t.auditPlanItems.id, year: t.auditPlanItems.year, label: t.auditPlanItems.label, detail: t.auditPlanItems.detail })
        .from(t.auditPlanItems).where(isNotNull(t.auditPlanItems.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'plan', label: `Programme ${r.year} · ${r.detail ?? r.label}`, href: `/audits?annee=${r.year}&element=${r.id}` }));
    },
  },

  requirement: {
    screen: 'watch',
    async attach(tx, [a], actionId) {
      const [row] = await tx.select({ actionId: t.requirements.actionId, archivedAt: t.requirements.archivedAt }).from(t.requirements).where(eq(t.requirements.id, num(a)));
      if (!row) return NOT_FOUND;
      if (row.archivedAt) return 'Exigence archivée (texte abrogé) : rattachement impossible.';
      const taken = await slotTaken(tx, row.actionId, actionId);
      if (!taken) await tx.update(t.requirements).set({ actionId }).where(eq(t.requirements.id, num(a)));
      return taken;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.requirements).set({ actionId: null }).where(and(eq(t.requirements.id, num(a)), eq(t.requirements.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.requirements).set({ actionId: null }).where(eq(t.requirements.actionId, actionId));
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.requirements.actionId, id: t.requirements.id, text: t.requirements.text }).from(t.requirements).where(isNotNull(t.requirements.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'requirement', label: `Exigence · ${r.text.slice(0, 60)}`, href: `/veille?onglet=exigences&exigence=${r.id}` }));
    },
  },

  control: {
    screen: 'watch',
    async attach(tx, [a], actionId) {
      const [row] = await tx.select({ actionId: t.controls.actionId, archivedAt: t.controls.archivedAt }).from(t.controls).where(eq(t.controls.id, num(a)));
      if (!row) return NOT_FOUND;
      if (row.archivedAt) return 'Contrôle archivé (équipement réformé) : rattachement impossible.';
      const taken = await slotTaken(tx, row.actionId, actionId);
      if (!taken) await tx.update(t.controls).set({ actionId }).where(eq(t.controls.id, num(a)));
      return taken;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.controls).set({ actionId: null }).where(and(eq(t.controls.id, num(a)), eq(t.controls.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.controls).set({ actionId: null }).where(eq(t.controls.actionId, actionId));
    },
    async siteOf(tx, [a]) {
      const [c] = await tx.select({ siteId: t.controls.siteId }).from(t.controls).where(eq(t.controls.id, num(a)));
      return c ? c.siteId : undefined;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.controls.actionId, id: t.controls.id, equipment: t.controls.equipment, type: t.controls.controlType }).from(t.controls).where(isNotNull(t.controls.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'control', label: `${r.type} · ${r.equipment}`, href: `/veille?onglet=controles&controle=${r.id}` }));
    },
  },

  docversion: {
    screen: 'docs',
    async attach(tx, [a], actionId) {
      const [row] = await tx.select({ actionId: t.documentVersions.actionId }).from(t.documentVersions).where(eq(t.documentVersions.id, num(a)));
      if (!row) return NOT_FOUND;
      const taken = await slotTaken(tx, row.actionId, actionId);
      if (!taken) await tx.update(t.documentVersions).set({ actionId }).where(eq(t.documentVersions.id, num(a)));
      return taken;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.documentVersions).set({ actionId: null }).where(and(eq(t.documentVersions.id, num(a)), eq(t.documentVersions.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.documentVersions).set({ actionId: null }).where(eq(t.documentVersions.actionId, actionId));
    },
    async siteOf(tx, [a]) {
      const [d] = await tx.select({ siteId: t.documents.siteId }).from(t.documentVersions)
        .innerJoin(t.documents, eq(t.documentVersions.documentId, t.documents.id)).where(eq(t.documentVersions.id, num(a)));
      return d ? d.siteId : undefined;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.documentVersions.actionId, documentId: t.documentVersions.documentId, version: t.documentVersions.version })
        .from(t.documentVersions).where(isNotNull(t.documentVersions.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'docversion', label: `${r.documentId} · version ${r.version}`, href: `/documents?doc=${r.documentId}` }));
    },
  },

  qualification: {
    screen: 'skills',
    async attach(tx, [personId = '', titleId = ''], actionId) {
      const where = and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId));
      const [req] = await tx.select({ renewal: t.qualificationRequirements.renewalActionId }).from(t.qualificationRequirements).where(where);
      if (!req) return NOT_FOUND;
      // Ne remplace pas un recyclage déjà planifié et encore ouvert (une action clôturée ou annulée peut être remplacée).
      if (req.renewal && req.renewal !== actionId) {
        const [prev] = await tx.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.id, req.renewal));
        if (prev && !isClosedActionStatus(prev.status)) return `Un recyclage est déjà planifié (${req.renewal}) : clôturez-le ou annulez-le avant d'en rattacher un autre.`;
      }
      await tx.update(t.qualificationRequirements).set({ renewalActionId: actionId }).where(where);
      return null;
    },
    async detach(tx, [personId = '', titleId = ''], actionId) {
      await tx.update(t.qualificationRequirements).set({ renewalActionId: null })
        .where(and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId), eq(t.qualificationRequirements.renewalActionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.qualificationRequirements).set({ renewalActionId: null }).where(eq(t.qualificationRequirements.renewalActionId, actionId));
    },
    async siteOf(tx, [personId = '']) {
      const [p] = await tx.select({ siteId: t.people.siteId }).from(t.people).where(eq(t.people.id, personId));
      return p ? p.siteId : undefined;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.qualificationRequirements.renewalActionId, personId: t.people.id, person: t.people.name, titleId: t.trainingTitles.id, title: t.trainingTitles.label })
        .from(t.qualificationRequirements)
        .innerJoin(t.people, eq(t.qualificationRequirements.personId, t.people.id))
        .innerJoin(t.trainingTitles, eq(t.qualificationRequirements.titleId, t.trainingTitles.id))
        .where(isNotNull(t.qualificationRequirements.renewalActionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'qualification', label: `${r.person} · ${r.title}`, href: `/habilitations?salarie=${r.personId}&titre=${r.titleId}` }));
    },
  },

  review: {
    screen: 'audits',
    async attach(tx, [a], actionId) {
      const [rev] = await tx.select({ id: t.reviews.id, status: t.reviews.status }).from(t.reviews).where(eq(t.reviews.id, num(a)));
      if (!rev) return NOT_FOUND;
      if (rev.status === 'cloturee' || rev.status === 'annulee') return 'Revue clôturée : rattachement impossible.';
      await tx.update(t.actions).set({ reviewId: rev.id }).where(eq(t.actions.id, actionId));
      return null;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.actions).set({ reviewId: null }).where(and(eq(t.actions.id, actionId), eq(t.actions.reviewId, num(a))));
    },
    async detachAll() { /* la revue d'origine reste lisible sur une action annulée */ },
    keptOnCancel: true,
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.reviews.id, reviewOn: t.reviews.reviewOn })
        .from(t.actions).innerJoin(t.reviews, eq(t.actions.reviewId, t.reviews.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'review', label: `Revue de direction du ${r.reviewOn.slice(8, 10)}/${r.reviewOn.slice(5, 7)}/${r.reviewOn.slice(0, 4)}`, href: reviewHref(r.id, r.reviewOn) }));
    },
  },

  reviewdecision: {
    screen: 'audits',
    async attach(tx, [a], actionId) {
      const [d] = await tx.select({ id: t.reviewDecisions.id, reviewId: t.reviewDecisions.reviewId, actionId: t.reviewDecisions.actionId, status: t.reviews.status })
        .from(t.reviewDecisions).innerJoin(t.reviews, eq(t.reviewDecisions.reviewId, t.reviews.id)).where(eq(t.reviewDecisions.id, num(a)));
      if (!d) return NOT_FOUND;
      if (d.status === 'cloturee' || d.status === 'annulee') return 'Revue clôturée : rattachement impossible.';
      const taken = await slotTaken(tx, d.actionId, actionId);
      if (taken) return taken;
      await tx.update(t.reviewDecisions).set({ actionId }).where(eq(t.reviewDecisions.id, d.id));
      await tx.update(t.actions).set({ reviewId: d.reviewId }).where(eq(t.actions.id, actionId));
      return null;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.reviewDecisions).set({ actionId: null }).where(and(eq(t.reviewDecisions.id, num(a)), eq(t.reviewDecisions.actionId, actionId)));
    },
    async detachAll(tx, actionId) {
      await tx.update(t.reviewDecisions).set({ actionId: null }).where(eq(t.reviewDecisions.actionId, actionId));
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.reviewDecisions.actionId, reviewId: t.reviewDecisions.reviewId, text: t.reviewDecisions.text, reviewOn: t.reviews.reviewOn })
        .from(t.reviewDecisions).innerJoin(t.reviews, eq(t.reviewDecisions.reviewId, t.reviews.id)).where(isNotNull(t.reviewDecisions.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, kind: 'reviewdecision', label: `Décision de revue · ${r.text.slice(0, 60)}`, href: reviewHref(r.reviewId, r.reviewOn) }));
    },
  },

  ...ORIGIN_KINDS,
};

/** Décompose un lien `type:arg[:arg]` ; null si le type est inconnu. */
export function parseActionLink(link: string): { kind: string; def: LinkKind; args: string[] } | null {
  const [kind, ...args] = link.split(':');
  const def = ACTION_LINKS[kind];
  return def ? { kind, def, args } : null;
}

/**
 * Contrôles d'un rattachement demandé par l'interface (saveAction, linkAction, src/server/links.ts) :
 * type connu, écran de la source ouvert en saisie au rôle, source du site sélectionné.
 */
export async function checkActionLink(db: DbOrTx, role: Role, link: string): Promise<{ error: string } | { parsed: NonNullable<ReturnType<typeof parseActionLink>> }> {
  const parsed = parseActionLink(link);
  if (!parsed) return { error: 'Type de rattachement inconnu.' };
  if (!canEdit(role, parsed.def.screen)) return { error: 'Votre rôle ne permet pas cette modification.' };
  const siteError = parsed.def.siteOf ? await requireInSite(await parsed.def.siteOf(db, parsed.args)) : null;
  return siteError ? { error: siteError } : { parsed };
}

/**
 * Source d'origine d'une nouvelle action (ACT-01) : `link` de l'écran appelant quand c'est un type d'origine, sinon la
 * référence d'origine résolue comme par la reprise (resolveOriginRef : plan, permis, document, filière ou enlèvement) ;
 * null si l'origine n'en a pas ou si la référence ne désigne aucune fiche (texte libre, « Registre des déchets 2026 »).
 * Contrôles : type de lien conforme à l'origine de l'action, source du site sélectionné (requireInSite) et du site de
 * l'action ; une référence qui désigne une fiche hors du périmètre de la personne reste un simple texte. Le lien
 * explicite passe aussi par checkActionLink (écran ouvert en saisie au rôle) ; une référence résolue non : rattacher
 * l'action à son origine ne modifie que l'action, déjà réservée à l'encadrement. Le rattachement lui-même
 * (applyActionLink, dans la transaction de création) refuse une source annulée.
 */
export async function originLinkFor(db: DbOrTx, a: { origin: string; originRef: string; link: string | null; siteId: string | null }): Promise<
  { link: string | null } | { error: string; fieldErrors: Record<string, string> }
> {
  const explicit = a.link ? parseActionLink(a.link) : null;
  let link: string | null = null;
  if (explicit?.def.origin) {
    if (ORIGIN_LINKS[explicit.def.origin].origin !== a.origin) {
      const error = "Ce rattachement ne correspond pas à l'origine de l'action.";
      return { error, fieldErrors: { origin: error } };
    }
    link = a.link;
  } else {
    const found = resolveOriginRef(a.origin, a.originRef, await loadOriginCatalog(db, a.originRef));
    if (found?.column) link = originLink(found.column, found.target);
  }
  const parsed = link ? parseActionLink(link) : null;
  if (!parsed) return { link: null };
  const sourceSite = await parsed.def.siteOf?.(db, parsed.args);
  // Référence d'une fiche hors du périmètre de la personne : simple texte, sans rien révéler de la fiche (SEC-02).
  if (!explicit?.def.origin && !inPerimeter(await allowedSiteIds(), sourceSite)) return { link: null };
  const blocked = await requireInSite(sourceSite);
  if (blocked) return { error: `Référence d'origine ${a.originRef} : ${blocked.charAt(0).toLowerCase()}${blocked.slice(1)}`, fieldErrors: { originRef: blocked } };
  if (!inSite(sourceSite ?? null, a.siteId)) {
    const error = `L'action doit concerner le site de sa source (${a.originRef}) : choisissez ce site.`;
    return { error, fieldErrors: { siteId: 'Site différent de celui de la source.' } };
  }
  return { link };
}

/** Site de la source d'origine portée par l'action (colonnes ACT-01) : undefined sans source d'origine, null = sans site. */
export async function originSiteOf(db: DbOrTx, a: Pick<typeof t.actions.$inferSelect, OriginColumn>): Promise<string | null | undefined> {
  const column = ORIGIN_COLUMNS.find((c) => a[c] != null);
  const parsed = column ? parseActionLink(originLink(column, a[column]!)) : null;
  return parsed ? (await parsed.def.siteOf?.(db, parsed.args)) ?? null : undefined;
}

/** Fiche dont l'historique trace aussi les rattachements à la source `link` (LinkKind.logAs) ; null sinon. */
export function linkLogEntity(link: string) {
  const parsed = parseActionLink(link);
  return parsed?.def.logAs?.(parsed.args) ?? null;
}

/** Rattache une action à la source décrite par `link` ; renvoie un message d'erreur ou null. */
export async function applyActionLink(tx: DbOrTx, link: string, actionId: string): Promise<string | null> {
  const parsed = parseActionLink(link);
  if (!parsed) return 'Type de rattachement inconnu.';
  return parsed.def.attach(tx, parsed.args, actionId);
}

/** Détache une action de toutes ses sources (annulation) ; renvoie les libellés détachés (pour logChange). */
export async function detachAllLinks(tx: DbOrTx, actionId: string): Promise<string[]> {
  const labels: string[] = [];
  for (const def of Object.values(ACTION_LINKS)) {
    if (def.keptOnCancel) continue;
    labels.push(...(await def.sources(tx, [actionId])).map((s) => s.label));
    await def.detachAll(tx, actionId);
  }
  return labels;
}

/** Sources de chaque action (identifiant → sources), pour la fiche action et le plan. */
export const loadLinkSources = cache(async (): Promise<Map<string, ActionSource[]>> => {
  const db = await getDb();
  const all = (await Promise.all(Object.values(ACTION_LINKS).map((def) => def.sources(db)))).flat();
  const map = new Map<string, ActionSource[]>();
  all.forEach(({ actionId, ...src }) => map.set(actionId, [...(map.get(actionId) ?? []), src]));
  return map;
});

/** Actions encore ouvertes parmi `ids` (contrôle avant rattachement). */
export async function openActionIds(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions).where(inArray(t.actions.id, ids));
  return new Set(rows.filter((r) => !isClosedActionStatus(r.status)).map((r) => r.id));
}
