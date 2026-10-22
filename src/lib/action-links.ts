import 'server-only';
import { cache } from 'react';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addActionBlocker } from '@/components/events/shared';
import { entryRef, wasteEntryHref, wasteStreamHref } from '@/components/environment/model';
import { NON_QSE_LINK_MESSAGE, type LinkFacts } from './action-rules';
import { ORIGIN_REF_MAX, canEdit, isClosedActionStatus, type Role, type ScreenKey } from './domain';
import { requireInSite } from './guard';
import { ORIGIN_COLUMNS, ORIGIN_LINKS, originLink, type OriginColumn } from './origin-links';

// ─── Rattachements d'une action du plan à sa source ─────────────────────────
//
// Registre unique utilisé par saveAction et createActionRecord (champ `link` à la création, src/server/action-create.ts),
// par LinkActionButton (rattacher / détacher un lien complémentaire, src/server/links.ts), par l'abandon d'une action
// (détacher partout), par les actions de suite (reprise des liens, D21) et par la fiche action (liens vers les sources).
// Syntaxe d'un lien : `<type>:<arg>[:<arg>]`, ex. risk:12 · finding:3 · requirement:5.
// Ajouter un type = ajouter une entrée à ACTION_LINKS (les quatre fonctions), sans autre changement.
// Règles du paquet 1 (docs/specs/actions-qse.md § 12, D15, D20, D21 ; réponses du service QHSE du 15/10/2026) :
//   - un seul événement ou audit par action (EVENT_AUDIT_LINK_KINDS : event, finding, plan) : posé à la création
//     seulement, jamais rattaché ni détaché ensuite (EVENT_AUDIT_LOCKED) ; seul mouvement admis : la reprise par une action
//     de suite (moveSlot, D21) ;
//   - sources d'origine (ACT-01, `origin`) : plan de prévention, permis, document, filière et enlèvement, portés par une
//     colonne de l'action (src/lib/origin-links.ts) ; posées à la création seulement, jamais rattachées ni détachées
//     ensuite, conservées à l'abandon. La création d'une action depuis une version de document pose aussi `document_id`
//     (onCreate) ; une version rattachée plus tard ne le pose jamais ;
//   - habilitations, plans de prévention et permis ne donnent lieu à aucune action QSE (NON_QSE_LINK_KINDS,
//     src/lib/action-rules.ts) : refusés pour tout nouveau lien, liens repris lisibles seulement ;
//   - plus de lien déduit de la référence d'origine (originLinkFor retiré) : la référence reste un texte.
// Faits d'un élément qui décident de la source admise (admissibleSources) et référence d'origine par défaut : linkFacts.

/** Source d'une action, affichée sur sa fiche (lien cliquable). */
export type ActionSource = { kind: string; label: string; href: string; detail?: string };
/** Source lue par le registre : action porteuse et lien `type:args` qui la désigne (jamais envoyé au navigateur). */
type SourceRow = ActionSource & { actionId: string; link: string };

type LinkKind = {
  /** Écran qui porte la source : droit de rattacher (canSee) et libellé. */
  screen: ScreenKey;
  /** Rattache l'action ; renvoie un message d'erreur (source introuvable, close…) ou null. */
  attach(tx: DbOrTx, args: string[], actionId: string): Promise<string | null>;
  /** Détache l'action de cette source (sans effet si elle n'y est pas rattachée). */
  detach(tx: DbOrTx, args: string[], actionId: string): Promise<void>;
  /** Détachement refusé (unlinkAction) : message, ou null ; absent = toujours admis. Jamais appelé par l'abandon (detachAll). */
  detachBlocked?(tx: DbOrTx, args: string[], actionId: string): Promise<string | null>;
  /** Détache l'action de toutes les sources de ce type (annulation de l'action). */
  detachAll(tx: DbOrTx, actionId: string): Promise<void>;
  /** Source conservée sur une action annulée (detachAll sans effet) : absente des sources détachées. */
  keptOnCancel?: boolean;
  /** Site de la source (contrôle requireInSite) ; undefined = source sans site. */
  siteOf?(tx: DbOrTx, args: string[]): Promise<string | null | undefined>;
  /** Fiche de la source dont l'historique (change_log) trace aussi les rattachements et détachements ; absent = historique de l'action seul. */
  logAs?(args: string[]): { entityType: string; entityId: string | number } | null;
  /** Toutes les sources de ce type, par action (fiche action), avec le lien qui désigne chacune. */
  sources(db: DbOrTx, actionIds?: string[]): Promise<SourceRow[]>;
  /** Source d'origine portée par cette colonne de l'action : fixée à la création, jamais rattachée ni détachée ensuite. */
  origin?: OriginColumn;
  /** Faits de l'élément (référence d'origine par défaut, site, faits de la source admise) ; null : élément introuvable. */
  facts(db: DbOrTx, args: string[]): Promise<ElementFacts | null>;
  /** Écriture propre à la création d'une action depuis cet élément (après attach), ex. document de la version. */
  onCreate?(tx: DbOrTx, args: string[], actionId: string): Promise<void>;
};

/** Faits d'un élément lié (linkFacts) : référence d'origine par défaut, site (null : élément commun) et faits de la source. */
export type ElementFacts = { reference: string; siteId: string | null; facts: LinkFacts };

const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : NaN);
const NOT_FOUND = 'Élément introuvable : le rattachement est impossible.';
/** Rattacher ou détacher une source d'origine après la création de l'action (linkAction, unlinkAction). */
export const ORIGIN_LOCKED = "L'origine d'une action est fixée à sa création : elle ne se rattache ni ne se détache ensuite.";
/** Rattacher ou détacher un événement ou un audit après la création de l'action (D15). */
export const EVENT_AUDIT_LOCKED = "L'événement ou l'audit d'une action est fixé à sa création.";
/** Référence d'origine par défaut, ramenée à ORIGIN_REF_MAX caractères. */
const ref = (s: string) => (s.length > ORIGIN_REF_MAX ? `${s.slice(0, ORIGIN_REF_MAX - 1).trimEnd()}…` : s);
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const enc = encodeURIComponent;
/** Revue de direction sur /audits : année du programme de la revue, carte « Revue » ouverte sur elle. */
const reviewHref = (id: number, reviewOn: string) => `/audits?annee=${reviewOn.slice(0, 4)}&revue=${id}#revue`;
const only = (ids?: string[]) => <R extends { actionId: string | null }>(rows: R[]) => rows.filter((r) => !!r.actionId && (!ids || ids.includes(r.actionId)));

/** Source à action unique (constat, exigence, contrôle…) déjà portée par une autre action ouverte : refus, jamais de remplacement silencieux. */
async function slotTaken(tx: DbOrTx, current: string | null, actionId: string): Promise<string | null> {
  if (!current || current === actionId) return null;
  const [prev] = await tx.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.id, current));
  return prev && !isClosedActionStatus(prev.status)
    ? `Déjà rattaché à l'action ${current}, encore ouverte : détachez-la ou abandonnez-la avant d'en rattacher une autre.` : null;
}

/** Source d'origine trouvée (`blocked` : rattachement refusé, ex. plan annulé). */
type OriginSource = { id: string | number; siteId: string | null; reference: string; blocked?: string | null };

/**
 * Type de lien d'une source d'origine (colonne `column` de l'action) : rattachement à la création seulement ; detach et
 * detachAll sans effet (origine verrouillée, conservée sur une action abandonnée).
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
    async detachAll() { /* la source d'origine reste lisible sur une action abandonnée */ },
    async siteOf(tx, [id = '']) {
      return (await def.find(tx, id))?.siteId;
    },
    async facts(db, [id = '']) {
      const src = await def.find(db, id);
      return src ? { reference: ref(src.reference), siteId: src.siteId, facts: {} } : null;
    },
    logAs: def.logAs,
    sources: def.sources,
  };
}

const ORIGIN_KINDS: Record<string, LinkKind> = {
  // Plans de prévention et permis : liens repris seulement (aucune action QSE depuis la Prévention, 15/10/2026).
  [ORIGIN_LINKS.preventionPlanId.kind]: originKind('preventionPlanId', {
    screen: 'prevention',
    async find(tx, id) {
      const [p] = await tx.select({ id: t.preventionPlans.id, siteId: t.preventionPlans.siteId, status: t.preventionPlans.status }).from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
      return p && { ...p, reference: p.id, blocked: p.status === 'annule' ? 'Plan de prévention annulé : rattachement impossible.' : null };
    },
    logAs: ([id]) => (id ? { entityType: 'prevention_plan', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.preventionPlans.id, title: t.preventionPlans.title })
        .from(t.actions).innerJoin(t.preventionPlans, eq(t.actions.preventionPlanId, t.preventionPlans.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, link: `preventionplan:${r.id}`, kind: 'preventionplan', label: r.id, detail: r.title, href: `/prevention?plan=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.permitId.kind]: originKind('permitId', {
    screen: 'prevention',
    async find(tx, id) {
      const [p] = await tx.select({ id: t.permits.id, siteId: t.permits.siteId, status: t.permits.status }).from(t.permits).where(eq(t.permits.id, id));
      return p && { ...p, reference: p.id, blocked: p.status === 'annule' ? 'Permis annulé : rattachement impossible.' : null };
    },
    logAs: ([id]) => (id ? { entityType: 'permit', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.permits.id, description: t.permits.description })
        .from(t.actions).innerJoin(t.permits, eq(t.actions.permitId, t.permits.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, link: `permit:${r.id}`, kind: 'permit', label: r.id, detail: r.description.slice(0, 80), href: `/prevention?onglet=permis&permis=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.documentId.kind]: originKind('documentId', {
    screen: 'docs',
    async find(tx, id) {
      const [d] = await tx.select({ id: t.documents.id, siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, id));
      return d && { ...d, reference: d.id };
    },
    logAs: ([id]) => (id ? { entityType: 'document', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.documents.id, title: t.documents.title })
        .from(t.actions).innerJoin(t.documents, eq(t.actions.documentId, t.documents.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, link: `document:${r.id}`, kind: 'document', label: r.id, detail: r.title, href: `/documents?doc=${enc(r.id)}` }));
    },
  }),

  [ORIGIN_LINKS.wasteStreamId.kind]: originKind('wasteStreamId', {
    screen: 'env',
    async find(tx, id) {
      const [s] = await tx.select({ id: t.wasteStreams.id, siteId: t.wasteStreams.siteId }).from(t.wasteStreams).where(eq(t.wasteStreams.id, id));
      return s && { ...s, reference: s.id };
    },
    logAs: ([id]) => (id ? { entityType: 'waste_stream', entityId: id } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.wasteStreams.id, label: t.wasteStreams.label })
        .from(t.actions).innerJoin(t.wasteStreams, eq(t.actions.wasteStreamId, t.wasteStreams.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, link: `wastestream:${r.id}`, kind: 'wastestream', label: r.id, detail: r.label, href: wasteStreamHref(r.id) }));
    },
  }),

  [ORIGIN_LINKS.wasteEntryId.kind]: originKind('wasteEntryId', {
    screen: 'env',
    async find(tx, id) {
      const [e] = await tx.select({ id: t.wasteEntries.id, siteId: t.wasteEntries.siteId, streamId: t.wasteEntries.streamId, removedOn: t.wasteEntries.removedOn, cancelledAt: t.wasteEntries.cancelledAt })
        .from(t.wasteEntries).where(eq(t.wasteEntries.id, num(id)));
      return e && { id: e.id, siteId: e.siteId, reference: entryRef(e.streamId, e.removedOn), blocked: e.cancelledAt ? 'Enlèvement annulé : rattachement impossible.' : null };
    },
    logAs: ([id]) => (Number.isInteger(num(id)) ? { entityType: 'waste_entry', entityId: num(id) } : null),
    async sources(db, ids) {
      const rows = await db.select({
        actionId: t.actions.id, id: t.wasteEntries.id, streamId: t.wasteEntries.streamId, removedOn: t.wasteEntries.removedOn, cancelledAt: t.wasteEntries.cancelledAt, stream: t.wasteStreams.label,
      }).from(t.actions).innerJoin(t.wasteEntries, eq(t.actions.wasteEntryId, t.wasteEntries.id)).innerJoin(t.wasteStreams, eq(t.wasteEntries.streamId, t.wasteStreams.id));
      // Fiche de l'enlèvement (DOC-08) : registre de son année, filtré sur sa filière (vue « Annulés » s'il est annulé).
      return only(ids)(rows).map((r) => ({
        actionId: r.actionId, link: `wasteentry:${r.id}`, kind: 'wasteentry', label: entryRef(r.streamId, r.removedOn), detail: `${r.stream}${r.cancelledAt ? ' · enlèvement annulé' : ''}`,
        href: wasteEntryHref({ id: r.id, removedOn: r.removedOn, streamId: r.streamId, cancelled: !!r.cancelledAt }),
      }));
    },
  }),
};

/** Ligne du programme d'audit (piste) d'un élément du programme. */
async function planTrack(db: DbOrTx, planItemId: number | null): Promise<string | null> {
  if (planItemId == null) return null;
  const [p] = await db.select({ track: t.auditPlanItems.track }).from(t.auditPlanItems).where(eq(t.auditPlanItems.id, planItemId));
  return p?.track ?? null;
}

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
    async detachAll() { /* l'événement d'origine reste lisible sur une action abandonnée (fiche événement : « Abandonnée ») */ },
    keptOnCancel: true,
    async siteOf(tx, [id]) {
      const [ev] = await tx.select({ siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, id ?? ''));
      return ev?.siteId;
    },
    async facts(db, [id]) {
      // Intitulé neutre de l'événement seulement (jamais un champ de santé : identifiant comme référence, § 4).
      const [ev] = await db.select({ id: t.events.id, siteId: t.events.siteId, type: t.events.type }).from(t.events).where(eq(t.events.id, id ?? ''));
      return ev ? { reference: ev.id, siteId: ev.siteId, facts: { eventType: ev.type } } : null;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.events.id, title: t.events.title })
        .from(t.actions).innerJoin(t.events, eq(t.actions.eventId, t.events.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `event:${r.id}`, kind: 'event', label: `${r.id} · ${r.title}`, href: `/evenements?sel=${r.id}` }));
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
    async facts(db, [a]) {
      const [r] = await db.select({ unit: t.workUnits.label, hazard: t.risks.hazard, siteId: t.workUnits.siteId }).from(t.risks)
        .innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.risks.id, num(a)));
      return r ? { reference: ref(`DUERP · ${r.unit} · ${r.hazard}`), siteId: r.siteId, facts: {} } : null;
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'risk', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.riskActions.actionId, riskId: t.risks.id, unitId: t.workUnits.id, unit: t.workUnits.label, hazard: t.risks.hazard, g: t.risks.gravity, p: t.risks.probability })
        .from(t.riskActions).innerJoin(t.risks, eq(t.riskActions.riskId, t.risks.id)).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `risk:${r.riskId}`, kind: 'risk', label: `${r.unit} · ${r.hazard}`, detail: `cotation ${r.g * r.p}`, href: `/risques?unite=${r.unitId}&risque=${r.riskId}` }));
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
    async facts(db, [a]) {
      const [f] = await db.select({ audit: t.auditFindings.audit, clause: t.auditFindings.clause, planItemId: t.auditFindings.planItemId }).from(t.auditFindings).where(eq(t.auditFindings.id, num(a)));
      return f ? { reference: ref(`Constat · ${f.audit}${f.clause ? ` · ${f.clause}` : ''}`), siteId: null, facts: { track: await planTrack(db, f.planItemId) } } : null;
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'audit_finding', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.auditFindings.actionId, id: t.auditFindings.id, audit: t.auditFindings.audit, cancelledAt: t.auditFindings.cancelledAt })
        .from(t.auditFindings).where(isNotNull(t.auditFindings.actionId));
      // Un constat annulé garde son action : la source reste lisible (filtre « Annulés » de l'écran Audits).
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `finding:${r.id}`, kind: 'finding', label: `Constat${r.cancelledAt ? ' annulé' : ''} · ${r.audit}`, href: `/audits?constat=${r.id}` }));
    },
  },

  plan: {
    screen: 'audits',
    async attach(tx, [a], actionId) {
      const [row] = await tx.select({ actionId: t.auditPlanItems.actionId, cancelledAt: t.auditPlanItems.cancelledAt }).from(t.auditPlanItems).where(eq(t.auditPlanItems.id, num(a)));
      if (!row) return NOT_FOUND;
      if (row.cancelledAt) return "Élément du programme d'audit annulé : rattachement impossible.";
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
    async facts(db, [a]) {
      const [p] = await db.select({ year: t.auditPlanItems.year, label: t.auditPlanItems.label, detail: t.auditPlanItems.detail, track: t.auditPlanItems.track })
        .from(t.auditPlanItems).where(eq(t.auditPlanItems.id, num(a)));
      return p ? { reference: ref(`Programme ${p.year} · ${p.detail ?? p.label}`), siteId: null, facts: { track: p.track } } : null;
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'audit_plan_item', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.auditPlanItems.actionId, id: t.auditPlanItems.id, year: t.auditPlanItems.year, label: t.auditPlanItems.label, detail: t.auditPlanItems.detail })
        .from(t.auditPlanItems).where(isNotNull(t.auditPlanItems.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `plan:${r.id}`, kind: 'plan', label: `Programme ${r.year} · ${r.detail ?? r.label}`, href: `/audits?annee=${r.year}&element=${r.id}` }));
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
    async facts(db, [a]) {
      const [r] = await db.select({ text: t.requirements.text }).from(t.requirements).where(eq(t.requirements.id, num(a)));
      return r ? { reference: ref(r.text), siteId: null, facts: {} } : null;
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'requirement', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.requirements.actionId, id: t.requirements.id, text: t.requirements.text }).from(t.requirements).where(isNotNull(t.requirements.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `requirement:${r.id}`, kind: 'requirement', label: `Exigence · ${r.text.slice(0, 60)}`, href: `/veille?onglet=exigences&exigence=${r.id}` }));
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
    async facts(db, [a]) {
      const [c] = await db.select({ siteId: t.controls.siteId, equipment: t.controls.equipment, type: t.controls.controlType }).from(t.controls).where(eq(t.controls.id, num(a)));
      return c ? { reference: ref(`${c.type} · ${c.equipment}`), siteId: c.siteId, facts: {} } : null;
    },
    logAs: ([a]) => (Number.isInteger(num(a)) ? { entityType: 'control', entityId: num(a) } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.controls.actionId, id: t.controls.id, equipment: t.controls.equipment, type: t.controls.controlType }).from(t.controls).where(isNotNull(t.controls.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `control:${r.id}`, kind: 'control', label: `${r.type} · ${r.equipment}`, href: `/veille?onglet=controles&controle=${r.id}` }));
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
    async facts(db, [a]) {
      const [d] = await db.select({ documentId: t.documentVersions.documentId, version: t.documentVersions.version, siteId: t.documents.siteId }).from(t.documentVersions)
        .innerJoin(t.documents, eq(t.documentVersions.documentId, t.documents.id)).where(eq(t.documentVersions.id, num(a)));
      return d ? { reference: ref(`${d.documentId} · version ${d.version}`), siteId: d.siteId, facts: {} } : null;
    },
    // Création depuis une version : l'action porte aussi son document (ACT-01, à la création seulement, D15).
    async onCreate(tx, [a], actionId) {
      const [v] = await tx.select({ documentId: t.documentVersions.documentId }).from(t.documentVersions).where(eq(t.documentVersions.id, num(a)));
      if (v) await tx.update(t.actions).set({ documentId: v.documentId }).where(and(eq(t.actions.id, actionId), isNull(t.actions.documentId)));
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.documentVersions.actionId, id: t.documentVersions.id, documentId: t.documentVersions.documentId, version: t.documentVersions.version })
        .from(t.documentVersions).where(isNotNull(t.documentVersions.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `docversion:${r.id}`, kind: 'docversion', label: `${r.documentId} · version ${r.version}`, href: `/documents?doc=${r.documentId}` }));
    },
  },

  // Habilitations : liens repris seulement (aucune action QSE pour un recyclage, 15/10/2026) ; jamais de nouveau lien.
  // HAB-04 : la case de la matrice est portée par l'action (qualification_person_id / qualification_title_id), conservée
  // quand l'action est close ou abandonnée et quand le titre n'est plus requis ; jamais détachée.
  qualification: {
    screen: 'skills',
    async attach() { return NON_QSE_LINK_MESSAGE; },
    async detach() { /* habilitation d'origine verrouillée */ },
    async detachAll() { /* la case reste lisible sur une action abandonnée */ },
    keptOnCancel: true,
    async siteOf(tx, [personId = '']) {
      const [p] = await tx.select({ siteId: t.people.siteId }).from(t.people).where(eq(t.people.id, personId));
      return p ? p.siteId : undefined;
    },
    async facts(db, [personId = '', titleId = '']) {
      const [q] = await db.select({ person: t.people.name, siteId: t.people.siteId, title: t.trainingTitles.label }).from(t.people)
        .innerJoin(t.trainingTitles, eq(t.trainingTitles.id, titleId))
        .where(eq(t.people.id, personId));
      return q ? { reference: ref(`${q.person} · ${q.title}`), siteId: q.siteId, facts: {} } : null;
    },
    // Case de la matrice (personne × titre) : historique de l'exigence (HAB-03, skill_cell).
    logAs: ([personId, titleId]) => (personId && titleId ? { entityType: 'qualification_requirement', entityId: `${personId}|${titleId}` } : null),
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, personId: t.people.id, person: t.people.name, titleId: t.trainingTitles.id, title: t.trainingTitles.label })
        .from(t.actions)
        .innerJoin(t.people, eq(t.actions.qualificationPersonId, t.people.id))
        .innerJoin(t.trainingTitles, eq(t.actions.qualificationTitleId, t.trainingTitles.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId, link: `qualification:${r.personId}:${r.titleId}`, kind: 'qualification', label: `${r.person} · ${r.title}`, href: `/habilitations?salarie=${r.personId}&titre=${r.titleId}` }));
    },
  },

  review: {
    screen: 'audits',
    async attach(tx, [a], actionId) {
      const [rev] = await tx.select({ id: t.reviews.id, status: t.reviews.status }).from(t.reviews).where(eq(t.reviews.id, num(a)));
      if (!rev) return NOT_FOUND;
      if (rev.status === 'cloturee' || rev.status === 'annulee') return 'Revue clôturée : rattachement impossible.';
      const other = await otherReview(tx, actionId, rev.id);
      if (other) return other;
      await tx.update(t.actions).set({ reviewId: rev.id }).where(eq(t.actions.id, actionId));
      return null;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.actions).set({ reviewId: null }).where(and(eq(t.actions.id, actionId), eq(t.actions.reviewId, num(a))));
    },
    // AUD-12 : dossier d'une revue clôturée figé ; une décision de la revue encore portée par l'action la retient.
    async detachBlocked(tx, [a], actionId) {
      const closed = await closedReview(tx, num(a));
      if (closed) return closed;
      const [d] = await tx.select({ id: t.reviewDecisions.id }).from(t.reviewDecisions)
        .where(and(eq(t.reviewDecisions.reviewId, num(a)), eq(t.reviewDecisions.actionId, actionId)));
      return d ? `L'action ${actionId} porte une décision de cette revue : détachez d'abord la décision.` : null;
    },
    async detachAll() { /* la revue d'origine reste lisible sur une action abandonnée */ },
    keptOnCancel: true,
    async facts(db, [a]) {
      const [r] = await db.select({ reviewOn: t.reviews.reviewOn }).from(t.reviews).where(eq(t.reviews.id, num(a)));
      return r ? { reference: `Revue de direction du ${ddmmyyyy(r.reviewOn)}`, siteId: null, facts: {} } : null;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.actions.id, id: t.reviews.id, reviewOn: t.reviews.reviewOn })
        .from(t.actions).innerJoin(t.reviews, eq(t.actions.reviewId, t.reviews.id));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `review:${r.id}`, kind: 'review', label: `Revue de direction du ${ddmmyyyy(r.reviewOn)}`, href: reviewHref(r.id, r.reviewOn) }));
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
      const other = await otherReview(tx, actionId, d.reviewId);
      if (other) return other;
      await tx.update(t.reviewDecisions).set({ actionId }).where(eq(t.reviewDecisions.id, d.id));
      await tx.update(t.actions).set({ reviewId: d.reviewId }).where(eq(t.actions.id, actionId));
      return null;
    },
    async detach(tx, [a], actionId) {
      await tx.update(t.reviewDecisions).set({ actionId: null }).where(and(eq(t.reviewDecisions.id, num(a)), eq(t.reviewDecisions.actionId, actionId)));
    },
    async detachBlocked(tx, [a]) {
      const [d] = await tx.select({ reviewId: t.reviewDecisions.reviewId }).from(t.reviewDecisions).where(eq(t.reviewDecisions.id, num(a)));
      return d ? closedReview(tx, d.reviewId) : null;
    },
    async detachAll(tx, actionId) {
      await tx.update(t.reviewDecisions).set({ actionId: null }).where(eq(t.reviewDecisions.actionId, actionId));
    },
    async facts(db, [a]) {
      const [d] = await db.select({ text: t.reviewDecisions.text, kind: t.reviewDecisions.kind }).from(t.reviewDecisions).where(eq(t.reviewDecisions.id, num(a)));
      return d ? { reference: ref(`Décision de revue · ${d.text}`), siteId: null, facts: { decisionKind: d.kind } } : null;
    },
    async sources(db, ids) {
      const rows = await db.select({ actionId: t.reviewDecisions.actionId, id: t.reviewDecisions.id, reviewId: t.reviewDecisions.reviewId, text: t.reviewDecisions.text, reviewOn: t.reviews.reviewOn })
        .from(t.reviewDecisions).innerJoin(t.reviews, eq(t.reviewDecisions.reviewId, t.reviews.id)).where(isNotNull(t.reviewDecisions.actionId));
      return only(ids)(rows).map((r) => ({ actionId: r.actionId!, link: `reviewdecision:${r.id}`, kind: 'reviewdecision', label: `Décision de revue · ${r.text.slice(0, 60)}`, href: reviewHref(r.reviewId, r.reviewOn) }));
    },
  },

  ...ORIGIN_KINDS,
};

/**
 * AUD-12 : une action relève d'une seule revue de direction — sa revue (`review_id`) ou celle d'une décision qu'elle porte
 * (ligne reprise sans `review_id`) ; rattacher l'action d'une autre revue (à la revue ou à une de ses décisions) est
 * refusé, jamais un déplacement silencieux.
 */
async function otherReview(tx: DbOrTx, actionId: string, reviewId: number): Promise<string | null> {
  const [a] = await tx.select({ reviewId: t.actions.reviewId }).from(t.actions).where(eq(t.actions.id, actionId));
  const [d] = await tx.select({ reviewId: t.reviewDecisions.reviewId }).from(t.reviewDecisions)
    .where(and(eq(t.reviewDecisions.actionId, actionId), ne(t.reviewDecisions.reviewId, reviewId)));
  return (a?.reviewId != null && a.reviewId !== reviewId) || d ? `L'action ${actionId} relève déjà d'une autre revue de direction.` : null;
}

/** AUD-12 : revue clôturée ou annulée — son dossier est figé, ses rattachements ne changent plus. */
async function closedReview(tx: DbOrTx, reviewId: number): Promise<string | null> {
  const [r] = await tx.select({ status: t.reviews.status }).from(t.reviews).where(eq(t.reviews.id, reviewId));
  return r && (r.status === 'cloturee' || r.status === 'annulee') ? 'Revue clôturée : son dossier est figé, le rattachement ne change plus.' : null;
}

/** Décompose un lien `type:arg[:arg]` ; null si le type est inconnu. */
export function parseActionLink(link: string): { kind: string; def: LinkKind; args: string[] } | null {
  const [kind, ...args] = link.split(':');
  const def = Object.hasOwn(ACTION_LINKS, kind) ? ACTION_LINKS[kind] : undefined;
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
 * Faits de l'élément désigné par `link` (§ 2.12b) : référence d'origine par défaut (identifiant de l'événement,
 * « Constat · <audit> », « Programme <année> · <libellé> », texte de l'exigence, contrôle, document, filière, enlèvement,
 * revue, décision), site de l'élément (null : élément commun à l'entreprise) et faits qui décident de la source
 * (admissibleSources : type d'événement, ligne du programme d'audit, nature de la décision). null : type inconnu ou
 * élément introuvable. Ne contrôle aucun droit : l'appelant vérifie le rôle et le périmètre.
 */
export async function linkFacts(db: DbOrTx, link: string): Promise<ElementFacts | null> {
  const parsed = parseActionLink(link);
  return parsed ? parsed.def.facts(db, parsed.args) : null;
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

/** Écriture propre à la création d'une action depuis `link` (LinkKind.onCreate : document d'une version), après le rattachement. */
export async function applyCreationLink(tx: DbOrTx, link: string, actionId: string): Promise<void> {
  const parsed = parseActionLink(link);
  await parsed?.def.onCreate?.(tx, parsed.args, actionId);
}

/** Lien détaché par l'abandon d'une action : libellé (journal de l'action) et fiche source qui trace aussi le détachement. */
export type DetachedLink = { label: string; logEntity: { entityType: string; entityId: string | number } | null };

/** Détache une action de toutes ses sources détachables (abandon) ; renvoie les liens détachés (pour logChange). */
export async function detachAllLinks(tx: DbOrTx, actionId: string): Promise<DetachedLink[]> {
  const out: DetachedLink[] = [];
  for (const def of Object.values(ACTION_LINKS)) {
    if (def.keptOnCancel) continue;
    out.push(...(await def.sources(tx, [actionId])).map((s) => ({ label: s.label, logEntity: linkLogEntity(s.link) })));
    await def.detachAll(tx, actionId);
  }
  return out;
}

/** Liens portés par une action (registre : événement, rattachements, sources d'origine), avec leur libellé. */
export async function actionLinks(db: DbOrTx, actionId: string): Promise<{ kind: string; link: string; label: string }[]> {
  const all = await Promise.all(Object.values(ACTION_LINKS).map((def) => def.sources(db, [actionId])));
  return all.flat().map((s) => ({ kind: s.kind, link: s.link, label: s.label }));
}

/**
 * Reprise d'un lien à action unique (constat, élément du programme, exigence, contrôle, version, décision) par l'action de
 * suite `toId` (D21) : le lien passe de `fromId` à `toId` dans la transaction de la vérification, après le passage de
 * `fromId` à « Vérifiée » (l'action vérifiée ne retient plus l'élément). Renvoie un message si l'élément refuse (constat
 * annulé, exigence archivée…) : rien n'est alors changé, l'action vérifiée garde son lien.
 */
export async function moveSlot(tx: DbOrTx, kind: string, args: string[], fromId: string, toId: string): Promise<string | null> {
  const def = Object.hasOwn(ACTION_LINKS, kind) ? ACTION_LINKS[kind] : undefined;
  if (!def) return 'Type de rattachement inconnu.';
  const link = [kind, ...args].join(':');
  const held = (await def.sources(tx, [fromId])).some((s) => s.link === link);
  if (!held) return `L'action ${fromId} ne porte pas cet élément.`;
  return def.attach(tx, args, toId);
}

/**
 * Sources d'une action (fiche action) : chaque élément lié, avec le lien « kind:args » qui le désigne (« Détacher » d'un
 * lien complémentaire, ACT-02 ; l'appelant ne l'envoie au navigateur que pour le QHSE).
 */
export const loadActionSources = cache(async (actionId: string): Promise<(ActionSource & { link: string })[]> => {
  const db = await getDb();
  const all = (await Promise.all(Object.values(ACTION_LINKS).map((def) => def.sources(db, [actionId])))).flat();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return all.map(({ actionId: _id, ...src }) => src);
});

/** Actions encore ouvertes parmi `ids` (contrôle avant rattachement). */
export async function openActionIds(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions).where(inArray(t.actions.id, ids));
  return new Set(rows.filter((r) => !isClosedActionStatus(r.status)).map((r) => r.id));
}
