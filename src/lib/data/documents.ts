import 'server-only';
import { cache } from 'react';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  DOC_ORIGINS, DOC_STATUS, DOC_TYPES, DOC_TYPE_KEYS, compareVersions, processLabel, versionStatus,
  type DocOrigin, type DocStatus, type DocType, type VersionStatus,
} from '@/lib/rules/documents';
import { addDays, addMonths, daysBetween, fmtDayMonth, parisDay } from '../dates';
import { today } from '@/lib/today';
import { TODO_HORIZON_DAYS, canApprove, isClosedActionStatus, type TodoItem, type Tone } from '../domain';
import { actionView, lcfirst, loadActionRows, loadActions, loadPeople, loadSiteRows, type ActionRow, type Person } from '../queries';
import { actionLabel } from '../action-rules';
import { loadQhseLeads } from './leads';
import { currentSiteId, getSession, inSite, siteFilter, type SiteScope } from '../session';
import { loadChangeLogs } from './changelog';
import { loadLinkedEvents, type LinkedEvent } from './linked-events';

// ─── Documents maîtrisés (ISO 9001 §7.5) ────────────────────────────────────
// Le statut d'un document, sa version en vigueur et sa prochaine revue sont déduits des versions.

export type Retirement = { on: string; by: string; reason: string | null };

/**
 * Action du plan d'actions liée à un document ou à une version : libellé court (actionLabel du détail), avancement affiché
 * (« En retard » le cas échéant) ; `open` = ni Vérifiée ni Abandonnée (une action Terminée attend sa vérification).
 */
export type LinkedAction = { id: string; label: string; statusLabel: string; tone: Tone; dueOn: string; late: boolean; open: boolean };

export type VersionView = {
  id: number;
  version: string;
  status: VersionStatus;
  statusLabel: string;
  tone: Tone;
  summary: string;
  authorId: string | null;
  author: string;
  approver: string;
  /** Dernier renvoi en brouillon (DOC-06) : date et corrections demandées, jusqu'à la nouvelle soumission. */
  returned: { on: string; reason: string } | null;
  submittedOn: string | null;
  approvedOn: string | null;
  file: { id: string; name: string; size: number } | null;
  action: LinkedAction | null;
};

/** Revue périodique sans modification (DOC-15) : date, version maintenue, auteur, conclusion ; annulée (motif) le cas échéant. */
export type DocReviewView = {
  id: number; version: string; reviewedOn: string; reviewer: string; conclusion: string;
  cancelled: { on: string; by: string; reason: string } | null;
};

export type DocumentRow = {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  typeIcon: string;
  process: string;
  processLabel: string;
  ownerId: string;
  owner: string;
  reviewMonths: number;
  distribution: string;
  siteId: string | null;
  siteLabel: string;
  status: DocStatus;
  statusLabel: string;
  statusTone: Tone;
  /** Retiré avant toute approbation (aucune version n'a été en vigueur) : peut être relancé par une nouvelle version. */
  abandoned: boolean;
  /** Retrait (« Rendre obsolète ») : quand, par qui et pourquoi, d'après l'historique du document. */
  retired: Retirement | null;
  /** Version approuvée diffusée. */
  current: VersionView | null;
  /** Révision en cours (brouillon ou en revue), postérieure à la version en vigueur. */
  pending: VersionView | null;
  /** Historique, de la plus récente à la plus ancienne. */
  versions: VersionView[];
  /** DOC-17 : origine (interne, externe), émetteur d'un document externe, durée de conservation. */
  origin: DocOrigin; originLabel: string; issuer: string | null; retention: string | null;
  /** DOC-15 : revues périodiques sans modification, la plus récente d'abord (annulées comprises, barrées). */
  reviews: DocReviewView[];
  /** Dernière revue (approbation de la version en vigueur ou revue sans modification) dont repart la prochaine revue. */
  lastReviewedOn: string | null;
  nextReviewOn: string | null;
  /** Jours avant la prochaine revue (négatif si dépassée). */
  reviewDays: number | null;
  overdue: boolean;
  dueSoon: boolean;
  /**
   * Actions non closes rattachées au document : son document d'origine (actions.document_id, posé à la création, ACT-01)
   * ou l'une de ses versions (document_versions.action_id : une version rattachée après coup ne pose jamais
   * document_id, D15). Sans doublon, la plus récente d'abord.
   */
  reviewActions: LinkedAction[];
  /** Actions closes (Vérifiées) rattachées au document ou à ses versions, la plus récente d'abord (EVT-14). */
  closedActions: LinkedAction[];
  /** Événements rattachés au document (events.document_id, EVT-14) : rédacteurs et approbateurs seulement. */
  events: LinkedEvent[];
  /** Détail proposé pour une action de revue périodique. */
  actionTitle: string;
};

const dayOf = (iso: string) => parisDay(new Date(iso));
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
export const matchesSearch = (d: Pick<DocumentRow, 'id' | 'title'>, q: string) => !q || fold(`${d.id} ${d.title}`).includes(fold(q));

const typeRank = (type: string) => {
  const i = DOC_TYPE_KEYS.indexOf(type as DocType);
  return i < 0 ? DOC_TYPE_KEYS.length : i;
};

type RawDocumentData = {
  people: Map<string, Person>;
  docs: (typeof t.documents.$inferSelect)[];
  versions: (typeof t.documentVersions.$inferSelect)[];
  files: { id: string; entityId: string; fileName: string; size: number }[];
  actions: ActionRow[];
  sites: { id: string; label: string }[];
  /** Dernier retrait tracé par document (change_log, action « archive »). */
  retirements?: Map<string, Retirement>;
  /** Événements rattachés par document (loadLinkedEvents). */
  events?: Map<string, LinkedEvent[]>;
  /** DOC-15 : revues périodiques sans modification. */
  reviews?: (typeof t.documentReviews.$inferSelect)[];
};

/** Construit les lignes du registre à partir des tables (règles de statut, version en vigueur, prochaine revue). */
export function buildDocumentRows({ people, docs, versions, files, actions, sites, retirements, events, reviews = [] }: RawDocumentData, site: string | null, now: string): DocumentRow[] {
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '—' : '—');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const fileOf = new Map(files.map((f) => [f.entityId, { id: f.id, name: f.fileName, size: f.size }])); // le dernier dépôt l'emporte

  const linked = (a: ActionRow): LinkedAction => {
    const v = actionView(a, people, now);
    return { id: a.id, label: v.label, statusLabel: v.statusLabel, tone: v.tone, dueOn: a.dueOn, late: v.late, open: !isClosedActionStatus(a.status) };
  };
  const actionById = new Map(actions.map((a) => [a.id, a]));
  // Couples « action liée à une version | document de la version ».
  const versionLinks = new Set(versions.filter((v) => v.actionId).map((v) => `${v.actionId}|${v.documentId}`));

  const versionView = (v: typeof versions[number]): VersionView => {
    const s = versionStatus(v.status, v.approvedOn);
    const action = v.actionId ? actionById.get(v.actionId) : undefined;
    return {
      id: v.id, version: v.version, status: v.status as VersionStatus, statusLabel: s.label, tone: s.tone, summary: v.summary,
      authorId: v.authorId, author: name(v.authorId), approver: v.approverId ? name(v.approverId) : '—', submittedOn: v.submittedOn, approvedOn: v.approvedOn,
      returned: v.status === 'brouillon' && v.returnedOn ? { on: v.returnedOn, reason: v.returnReason ?? '' } : null,
      file: fileOf.get(String(v.id)) ?? null,
      action: action ? linked(action) : null,
    };
  };

  const docActions = (id: string) => actions
    .filter((a) => a.documentId === id || versionLinks.has(`${a.id}|${id}`))
    .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map(linked);
  const rows: DocumentRow[] = docs.filter((d) => inSite(site, d.siteId)).map((d) => {
    const vs = versions.filter((v) => v.documentId === d.id).sort((a, b) => compareVersions(b.version, a.version)).map(versionView);
    const current = vs.find((v) => v.status === 'approuve') ?? null;
    const pending = vs.find((v) => v.status === 'brouillon' || v.status === 'en_revue') ?? null;
    const status: DocStatus = current ? 'vigueur' : pending?.status === 'en_revue' ? 'revue' : pending ? 'brouillon' : 'obsolete';
    // DOC-15 : la prochaine revue repart de la plus récente de l'approbation de la version en vigueur et des revues sans
    // modification de cette version (non annulées).
    const docReviews = reviews.filter((r) => r.documentId === d.id).sort((a, b) => b.reviewedOn.localeCompare(a.reviewedOn) || b.id - a.id);
    const lastReview = current ? docReviews.find((r) => !r.cancelledAt && r.version === current.version && (!current.approvedOn || r.reviewedOn >= current.approvedOn)) : undefined;
    const lastReviewedOn = lastReview?.reviewedOn ?? current?.approvedOn ?? null;
    const nextReviewOn = lastReviewedOn ? addMonths(lastReviewedOn, d.reviewMonths) : null;
    const reviewDays = nextReviewOn ? daysBetween(now, nextReviewOn) : null;
    const type = DOC_TYPES[d.type as DocType];
    const neverApproved = !vs.some((v) => v.approvedOn);
    return {
      id: d.id,
      title: d.title,
      type: d.type,
      typeLabel: type?.label ?? d.type,
      typeIcon: type?.icon ?? 'ph-file',
      process: d.process,
      processLabel: processLabel(d.process),
      ownerId: d.ownerId,
      owner: name(d.ownerId),
      reviewMonths: d.reviewMonths,
      distribution: d.distribution,
      origin: (d.origin === 'externe' ? 'externe' : 'interne') as DocOrigin,
      originLabel: DOC_ORIGINS[d.origin as DocOrigin] ?? d.origin,
      issuer: d.issuer,
      retention: d.retention,
      reviews: docReviews.map((r) => ({
        id: r.id, version: r.version, reviewedOn: r.reviewedOn, reviewer: name(r.reviewerId), conclusion: r.conclusion,
        cancelled: r.cancelledAt ? { on: parisDay(r.cancelledAt), by: name(r.cancelledById), reason: r.cancelReason ?? '' } : null,
      })),
      lastReviewedOn,
      siteId: d.siteId,
      siteLabel: d.siteId ? siteLabel.get(d.siteId) ?? d.siteId : 'Tous les sites',
      status,
      statusLabel: status === 'obsolete' && neverApproved ? 'Abandonné' : DOC_STATUS[status].label,
      statusTone: DOC_STATUS[status].tone,
      abandoned: status === 'obsolete' && neverApproved,
      retired: status === 'obsolete' && !neverApproved ? retirements?.get(d.id) ?? null : null,
      current,
      pending,
      versions: vs,
      nextReviewOn,
      reviewDays,
      overdue: reviewDays != null && reviewDays < 0,
      dueSoon: reviewDays != null && reviewDays >= 0 && reviewDays <= TODO_HORIZON_DAYS,
      reviewActions: docActions(d.id).filter((a) => a.open),
      closedActions: docActions(d.id).filter((a) => !a.open),
      events: events?.get(d.id) ?? [],
      actionTitle: `Revue périodique de ${d.id} — ${lcfirst(d.title)}`,
    };
  });

  return rows.sort((a, b) => Number(a.status === 'obsolete') - Number(b.status === 'obsolete')
    || typeRank(a.type) - typeRank(b.type) || a.id.localeCompare(b.id, 'fr', { numeric: true }));
}

/**
 * Documents du site sélectionné (scope 'site') ou de tout le périmètre (scope 'perimeter' : échéances, TDB-05) ; les
 * documents sans site valent pour toute l'entreprise.
 */
const loadDocumentBase = cache(async (scope: SiteScope = 'site') => {
  const db = await getDb();
  const now = today();
  const [site, keep, perimeter, people, docs, versions, files, actions, sites, reviews] = await Promise.all([
    currentSiteId(),
    siteFilter(scope),
    siteFilter('perimeter'),
    loadPeople(),
    db.select().from(t.documents),
    db.select().from(t.documentVersions).orderBy(asc(t.documentVersions.id)),
    db.select({ id: t.attachments.id, entityId: t.attachments.entityId, fileName: t.attachments.fileName, size: t.attachments.size })
      .from(t.attachments).where(eq(t.attachments.entityType, 'document_version')).orderBy(asc(t.attachments.createdAt)),
    loadActionRows().then((rows) => rows.filter((a) => a.status !== 'abandonnee')),
    loadSiteRows(),
    db.select().from(t.documentReviews).orderBy(asc(t.documentReviews.id)),
  ]);
  // Retraits tracés (motif obligatoire) : l'entrée « archive » la plus récente de chaque document.
  const logs = await loadChangeLogs('document', docs.map((d) => d.id));
  const retirements = new Map([...logs].flatMap(([id, entries]) => {
    const e = entries.find((x) => x.action === 'archive');
    return e ? [[id, { on: dayOf(e.at), by: e.who, reason: e.reason }] as const] : [];
  }));
  const kept = docs.filter((d) => keep(d.siteId));
  // EVT-14 : événements rattachés (périmètre, jamais une maladie professionnelle hors rôles habilités ; rien pour le Salarié).
  const events = await loadLinkedEvents('document', kept.map((d) => d.id));
  const rows = buildDocumentRows({ people, docs: kept, versions, files, actions, sites, retirements, events, reviews }, null, now);
  // Documents rattachés à un autre site du périmètre : la fiche ouverte par ?doc= (après création ou changement de site)
  // l'explique. Hors du périmètre : rien n'est révélé (bandeau « introuvable », UX-13).
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const inPerimeterIds = docs.filter((d) => perimeter(d.siteId)).map((d) => d.id);
  const elsewhere: Record<string, string> = Object.fromEntries(docs
    .filter((d) => d.siteId && !inSite(site, d.siteId) && perimeter(d.siteId))
    .map((d) => [d.id, siteLabel.get(d.siteId!) ?? d.siteId!]));
  // Documents ayant une version en vigueur (tous sites) : seuls signalés « ailleurs » en consultation seule.
  const inForceIds = new Set(versions.filter((v) => v.status === 'approuve').map((v) => v.documentId));
  const approvedIds = new Set(versions.filter((v) => v.approvedOn).map((v) => v.documentId));
  return { rows, allIds: docs.map((d) => d.id), inPerimeterIds, elsewhere, inForceIds, approvedIds, now };
});

/**
 * Vue en consultation seule (rôles sans droit de rédaction) : documents en vigueur uniquement, réduits à leur version
 * approuvée. Ni brouillons, ni révisions en cours, ni versions archivées, ni actions liées (ISO 9001 §7.5.3 : seule la
 * version approuvée est diffusée).
 */
const readerView = (r: DocumentRow): DocumentRow => {
  const current = { ...r.current!, action: null };
  return { ...r, pending: null, versions: [current], current, reviewActions: [], closedActions: [], events: [], overdue: false, dueSoon: false };
};

/** Document demandé par lien (?doc=) mais absent de la consultation : jamais approuvé, ou retiré de la diffusion. */
export type UnavailableDoc = 'draft' | 'retired';

/** Écran « Documents maîtrisés » : registre, indicateurs et listes de choix. `readOnly` : consultation des documents en vigueur. */
export async function loadDocuments({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [base, actions] = await Promise.all([loadDocumentBase(), loadActions()]);
  const { now } = base;
  if (readOnly) {
    const rows = base.rows.filter((r) => r.current).map(readerView);
    const inForce = new Set(rows.map((r) => r.id));
    const kpis: KpiTile[] = [
      { key: 'vigueur', label: 'Documents en vigueur', value: rows.length, sub: '', subTone: 'neutral', note: 'Dernière version approuvée et diffusée' },
    ];
    // Lien vers un document sans version en vigueur (origine d'une action, procédure citée ailleurs) : la fiche l'explique.
    const unavailable: Record<string, UnavailableDoc> = Object.fromEntries(base.inPerimeterIds
      .filter((id) => !base.inForceIds.has(id))
      .map((id) => [id, base.approvedIds.has(id) ? 'retired' : 'draft']));
    return {
      rows, allIds: [] as string[], now, kpis, overdueCount: 0, actionOptions: [] as (readonly [string, string])[], suggestedDueOn: addDays(now, 30),
      elsewhere: Object.fromEntries(Object.entries(base.elsewhere).filter(([id]) => base.inForceIds.has(id) && !inForce.has(id))),
      unavailable,
    };
  }
  const { rows, allIds, elsewhere } = base;
  const inForce = rows.filter((r) => r.current);
  const overdue = rows.filter((r) => r.overdue).sort((a, b) => (a.reviewDays ?? 0) - (b.reviewDays ?? 0));
  const soon = rows.filter((r) => r.dueSoon);
  const inReview = rows.flatMap((r) => r.versions.filter((v) => v.status === 'en_revue'));
  const drafts = rows.flatMap((r) => r.versions.filter((v) => v.status === 'brouillon'));
  const oldest = overdue[0];

  const kpis: KpiTile[] = [
    { key: 'vigueur', label: 'Documents en vigueur', value: inForce.length, sub: `sur ${rows.length}`, subTone: 'neutral', note: 'Dernière version approuvée et diffusée' },
    { key: 'revue', label: 'En revue · à approuver', value: inReview.length, sub: inReview.length ? 'en attente' : '', subTone: 'warn', note: 'Approbation : animateur QHSE ou direction' },
    {
      key: 'retard', label: 'Révisions en retard', value: overdue.length, sub: soon.length ? `+ ${soon.length} sous ${TODO_HORIZON_DAYS} j` : '', subTone: 'warn',
      note: oldest ? `Plus ancienne : ${oldest.id} · +${-(oldest.reviewDays ?? 0)} j` : 'Aucune revue périodique dépassée',
    },
    { key: 'brouillon', label: 'Brouillons', value: drafts.length, sub: '', subTone: 'neutral', note: 'Créations et révisions en rédaction' },
  ];

  // Actions à rattacher à une version (service QHSE seulement, la page ne les transmet qu'à lui) : ni Vérifiées ni Abandonnées.
  const actionOptions = actions
    .filter((a) => !isClosedActionStatus(a.status))
    .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((a) => [a.id, `${a.id} · ${actionLabel(a.detail)}`] as const);

  return { rows, allIds, elsewhere, unavailable: {} as Record<string, UnavailableDoc>, now, kpis, overdueCount: overdue.length, actionOptions, suggestedDueOn: addDays(now, 30) };
}
type KpiTile = { key: 'vigueur' | 'revue' | 'retard' | 'brouillon'; label: string; value: number; sub: string; subTone: Tone; note: string };

/**
 * Suite déjà donnée à une revue périodique (DOC-14) : révision en cours (« · révision B en revue »), sinon action de revue
 * ouverte (« · action A-12 en cours ») ; vide sinon. L'échéance reste due jusqu'à l'approbation de la révision.
 */
const reviewProgress = (r: Pick<DocumentRow, 'current' | 'pending' | 'reviewActions'>) =>
  r.current && r.pending ? ` · révision ${r.pending.version} ${r.pending.status === 'en_revue' ? 'en revue' : 'en brouillon'}`
    : r.reviewActions.length ? ` · action ${r.reviewActions[0].id} en cours` : '';

/**
 * Échéances documentaires, sur tous les sites du périmètre (TDB-05, siteId du document ; null = tous les sites) :
 * - revues périodiques dépassées ou à moins de 15 j (propriétaire du document), y compris pendant une révision en cours
 *   (DOC-14 : la version en vigueur reste celle à revoir tant que la révision n'est pas approuvée ; l'intitulé indique la
 *   révision, sinon l'action de revue ouverte) ;
 * - versions en revue à approuver (approbateurs : animateur QHSE et direction).
 * Rôle en consultation seule : visibleTodo ne lui laisse que ses propres échéances (propriétaire du document).
 */
export const loadDocumentSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [{ rows, now }, { role }] = await Promise.all([loadDocumentBase('perimeter'), getSession()]);
  const href = (id: string) => `/documents?doc=${encodeURIComponent(id)}`;
  const reviews: TodoItem[] = rows
    .filter((r) => r.nextReviewOn && (r.overdue || r.dueSoon))
    .map((r) => {
      const title = r.overdue ? `${r.id} · ${r.title} — revue dépassée depuis le ${fmtDayMonth(r.nextReviewOn!)}` : `${r.id} · revue périodique « ${r.title} »`;
      return {
        date: r.overdue ? now : r.nextReviewOn!,
        dueOn: r.nextReviewOn!,
        kind: 'Revue documentaire',
        tone: r.overdue ? 'danger' : 'warn',
        overdue: r.overdue,
        title: `${title}${reviewProgress(r)}`,
        // Clé sans la suite donnée (DOC-14) : l'échéance ne redevient pas non lue quand la révision avance.
        key: ['Revue documentaire', href(r.id), title].join('|'),
        who: r.owner,
        ownerIds: [r.ownerId],
        siteId: r.siteId,
        href: href(r.id),
      } satisfies TodoItem;
    });
  // Approbateurs : animateurs QHSE et direction (dernier rôle connu).
  const approvers = (await loadQhseLeads()).approvers.map((p) => p.id);
  const approvals: TodoItem[] = canApprove(role)
    ? rows.flatMap((r) => r.versions.filter((v) => v.status === 'en_revue').map((v) => ({
      date: v.submittedOn ?? now,
      kind: 'Approbation documentaire',
      tone: 'warn',
      title: `${r.id} · version ${v.version} à approuver`,
      who: 'Animateur QHSE / Direction',
      ownerIds: approvers,
      siteId: r.siteId,
      href: href(r.id),
    } satisfies TodoItem)))
    : [];
  // Brouillon renvoyé par l'approbateur (DOC-06) : corrections à apporter par l'auteur, jusqu'à la nouvelle soumission.
  const returns: TodoItem[] = rows.flatMap((r) => r.versions.filter((v) => v.returned && v.authorId).map((v) => ({
    date: v.returned!.on,
    kind: 'Révision documentaire',
    tone: 'warn',
    title: `${r.id} · version ${v.version} renvoyée en brouillon : corrections demandées`,
    who: v.author,
    ownerIds: [v.authorId!],
    siteId: r.siteId,
    href: href(r.id),
  } satisfies TodoItem)));
  return { todo: [...reviews, ...approvals, ...returns].sort((a, b) => a.date.localeCompare(b.date)) };
});
