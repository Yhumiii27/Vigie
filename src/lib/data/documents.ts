import 'server-only';
import { cache } from 'react';
import { asc, eq, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  DOC_STATUS, DOC_TYPES, DOC_TYPE_KEYS, compareVersions, processLabel, versionStatus,
  type DocStatus, type DocType, type VersionStatus,
} from '@/components/documents/meta';
import { addDays, addMonths, daysBetween, fmtDayMonth, parisDay } from '../dates';
import { today } from '@/lib/today';
import { canApprove, isClosedActionStatus, type TodoItem, type Tone } from '../domain';
import { actionView, lcfirst, loadActions, loadPeople, type ActionRow, type Person } from '../queries';
import { actionLabel } from '../action-rules';
import { loadQhseLeads } from './leads';
import { currentSiteId, getSession, inSite, siteFilter, type SiteScope } from '../session';
import { loadChangeLogs } from './changelog';

// ─── Documents maîtrisés (ISO 9001 §7.5) ────────────────────────────────────
// Le statut d'un document, sa version en vigueur et sa prochaine revue sont déduits des versions.

export const DOC_SOON_DAYS = 15;

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
  author: string;
  approver: string;
  submittedOn: string | null;
  approvedOn: string | null;
  file: { id: string; name: string; size: number } | null;
  action: LinkedAction | null;
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
};

/** Construit les lignes du registre à partir des tables (règles de statut, version en vigueur, prochaine revue). */
export function buildDocumentRows({ people, docs, versions, files, actions, sites, retirements }: RawDocumentData, site: string | null, now: string): DocumentRow[] {
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
      author: name(v.authorId), approver: v.approverId ? name(v.approverId) : '—', submittedOn: v.submittedOn, approvedOn: v.approvedOn,
      file: fileOf.get(String(v.id)) ?? null,
      action: action ? linked(action) : null,
    };
  };

  const rows: DocumentRow[] = docs.filter((d) => inSite(site, d.siteId)).map((d) => {
    const vs = versions.filter((v) => v.documentId === d.id).sort((a, b) => compareVersions(b.version, a.version)).map(versionView);
    const current = vs.find((v) => v.status === 'approuve') ?? null;
    const pending = vs.find((v) => v.status === 'brouillon' || v.status === 'en_revue') ?? null;
    const status: DocStatus = current ? 'vigueur' : pending?.status === 'en_revue' ? 'revue' : pending ? 'brouillon' : 'obsolete';
    const nextReviewOn = current?.approvedOn ? addMonths(current.approvedOn, d.reviewMonths) : null;
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
      dueSoon: reviewDays != null && reviewDays >= 0 && reviewDays <= DOC_SOON_DAYS,
      reviewActions: actions
        .filter((a) => a.documentId === d.id || versionLinks.has(`${a.id}|${d.id}`))
        .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
        .map(linked).filter((a) => a.open),
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
  const [site, keep, people, docs, versions, files, actions, sites] = await Promise.all([
    currentSiteId(),
    siteFilter(scope),
    loadPeople(),
    db.select().from(t.documents),
    db.select().from(t.documentVersions).orderBy(asc(t.documentVersions.id)),
    db.select({ id: t.attachments.id, entityId: t.attachments.entityId, fileName: t.attachments.fileName, size: t.attachments.size })
      .from(t.attachments).where(eq(t.attachments.entityType, 'document_version')).orderBy(asc(t.attachments.createdAt)),
    db.select().from(t.actions).where(ne(t.actions.status, 'abandonnee')),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  // Retraits tracés (motif obligatoire) : l'entrée « archive » la plus récente de chaque document.
  const logs = await loadChangeLogs('document', docs.map((d) => d.id));
  const retirements = new Map([...logs].flatMap(([id, entries]) => {
    const e = entries.find((x) => x.action === 'archive');
    return e ? [[id, { on: dayOf(e.at), by: e.who, reason: e.reason }] as const] : [];
  }));
  const rows = buildDocumentRows({ people, docs: docs.filter((d) => keep(d.siteId)), versions, files, actions, sites, retirements }, null, now);
  // Documents rattachés à un autre site : la fiche ouverte par ?doc= (après création ou changement de site) l'explique.
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const elsewhere: Record<string, string> = Object.fromEntries(docs
    .filter((d) => d.siteId && !inSite(site, d.siteId))
    .map((d) => [d.id, siteLabel.get(d.siteId!) ?? d.siteId!]));
  // Documents ayant une version en vigueur (tous sites) : seuls signalés « ailleurs » en consultation seule.
  const inForceIds = new Set(versions.filter((v) => v.status === 'approuve').map((v) => v.documentId));
  const approvedIds = new Set(versions.filter((v) => v.approvedOn).map((v) => v.documentId));
  return { rows, allIds: docs.map((d) => d.id), elsewhere, inForceIds, approvedIds, now };
});

/**
 * Vue en consultation seule (rôles sans droit de rédaction) : documents en vigueur uniquement, réduits à leur version
 * approuvée. Ni brouillons, ni révisions en cours, ni versions archivées, ni actions liées (ISO 9001 §7.5.3 : seule la
 * version approuvée est diffusée).
 */
const readerView = (r: DocumentRow): DocumentRow => {
  const current = { ...r.current!, action: null };
  return { ...r, pending: null, versions: [current], current, reviewActions: [], overdue: false, dueSoon: false };
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
    const unavailable: Record<string, UnavailableDoc> = Object.fromEntries(base.allIds
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
      key: 'retard', label: 'Révisions en retard', value: overdue.length, sub: soon.length ? `+ ${soon.length} sous ${DOC_SOON_DAYS} j` : '', subTone: 'warn',
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
export type DocumentsData = Awaited<ReturnType<typeof loadDocuments>>;
type KpiTile = { key: 'vigueur' | 'revue' | 'retard' | 'brouillon'; label: string; value: number; sub: string; subTone: Tone; note: string };

/**
 * Échéances documentaires, sur tous les sites du périmètre (TDB-05, siteId du document ; null = tous les sites) :
 * - revues périodiques dépassées ou à moins de 15 j (propriétaire du document) ;
 * - versions en revue à approuver (approbateurs : animateur QHSE et direction).
 * Rôle en consultation seule : visibleTodo ne lui laisse que ses propres échéances (propriétaire du document).
 */
export const loadDocumentSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [{ rows, now }, { role }] = await Promise.all([loadDocumentBase('perimeter'), getSession()]);
  const href = (id: string) => `/documents?doc=${encodeURIComponent(id)}`;
  const reviews: TodoItem[] = rows
    .filter((r) => r.nextReviewOn && (r.overdue || r.dueSoon))
    .map((r) => ({
      date: r.overdue ? now : r.nextReviewOn!,
      kind: 'Revue documentaire',
      tone: r.overdue ? 'danger' : 'warn',
      overdue: r.overdue,
      title: r.overdue ? `${r.id} · ${r.title} — revue dépassée depuis le ${fmtDayMonth(r.nextReviewOn!)}` : `${r.id} · revue périodique « ${r.title} »`,
      who: r.owner,
      ownerIds: [r.ownerId],
      siteId: r.siteId,
      href: href(r.id),
    } satisfies TodoItem));
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
  return { todo: [...reviews, ...approvals].sort((a, b) => a.date.localeCompare(b.date)) };
});
