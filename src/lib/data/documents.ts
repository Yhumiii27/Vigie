import 'server-only';
import { cache } from 'react';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  DOC_STATUS, DOC_TYPES, DOC_TYPE_KEYS, compareVersions, processLabel, versionStatus,
  type DocStatus, type DocType, type VersionStatus,
} from '@/components/documents/meta';
import { addDays, addMonths, daysBetween, fmtDayMonth, today } from '../dates';
import { canSee, columnOf, type TodoItem, type Tone } from '../domain';
import { actionColumn, lcfirst, loadActions, loadPeople, type ActionRow } from '../queries';
import { currentSiteId, getSession, inSite } from '../session';

// ─── Documents maîtrisés (ISO 9001 §7.5) ────────────────────────────────────
// Le statut d'un document, sa version en vigueur et sa prochaine revue sont déduits des versions.

export const DOC_SOON_DAYS = 15;

export type LinkedAction = { id: string; title: string; statusLabel: string; tone: Tone; dueOn: string; late: boolean; open: boolean };

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
  /** Actions ouvertes du plan d'actions rattachées au document (origine « Documents »). */
  reviewActions: LinkedAction[];
  /** Intitulé proposé pour une action de revue. */
  actionTitle: string;
};

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
export const matchesSearch = (d: Pick<DocumentRow, 'id' | 'title'>, q: string) => !q || fold(`${d.id} ${d.title}`).includes(fold(q));

const typeRank = (type: string) => {
  const i = DOC_TYPE_KEYS.indexOf(type as DocType);
  return i < 0 ? DOC_TYPE_KEYS.length : i;
};

type RawDocumentData = {
  people: Map<string, { name: string }>;
  docs: (typeof t.documents.$inferSelect)[];
  versions: (typeof t.documentVersions.$inferSelect)[];
  files: { id: string; entityId: string; fileName: string; size: number }[];
  actions: ActionRow[];
  sites: { id: string; label: string }[];
};

/** Construit les lignes du registre à partir des tables (règles de statut, version en vigueur, prochaine revue). */
export function buildDocumentRows({ people, docs, versions, files, actions, sites }: RawDocumentData, site: string | null, now: string): DocumentRow[] {
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '—' : '—');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const fileOf = new Map(files.map((f) => [f.entityId, { id: f.id, name: f.fileName, size: f.size }])); // le dernier dépôt l'emporte

  const linked = (a: ActionRow): LinkedAction => {
    const col = actionColumn(a, now);
    const c = columnOf(col);
    return { id: a.id, title: a.title, statusLabel: c.status, tone: c.tone, dueOn: a.dueOn, late: col === 'late', open: col !== 'done' };
  };
  const actionById = new Map(actions.map((a) => [a.id, a]));

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
      current,
      pending,
      versions: vs,
      nextReviewOn,
      reviewDays,
      overdue: reviewDays != null && reviewDays < 0,
      dueSoon: reviewDays != null && reviewDays >= 0 && reviewDays <= DOC_SOON_DAYS,
      reviewActions: actions
        .filter((a) => a.origin === 'docs' && (a.originRef === d.id || a.originRef.startsWith(`${d.id} `)))
        .map(linked).filter((a) => a.open),
      actionTitle: `Revue périodique de ${d.id} — ${lcfirst(d.title)}`,
    };
  });

  return rows.sort((a, b) => Number(a.status === 'obsolete') - Number(b.status === 'obsolete')
    || typeRank(a.type) - typeRank(b.type) || a.id.localeCompare(b.id, 'fr', { numeric: true }));
}

/** Documents du site sélectionné (les documents sans site valent pour toute l'entreprise). */
const loadDocumentBase = cache(async () => {
  const db = await getDb();
  const now = today();
  const [site, people, docs, versions, files, actions, sites] = await Promise.all([
    currentSiteId(),
    loadPeople(),
    db.select().from(t.documents),
    db.select().from(t.documentVersions).orderBy(asc(t.documentVersions.id)),
    db.select({ id: t.attachments.id, entityId: t.attachments.entityId, fileName: t.attachments.fileName, size: t.attachments.size })
      .from(t.attachments).where(eq(t.attachments.entityType, 'document_version')).orderBy(asc(t.attachments.createdAt)),
    db.select().from(t.actions),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  const rows = buildDocumentRows({ people, docs, versions, files, actions, sites }, site, now);
  // Documents rattachés à un autre site : la fiche ouverte par ?doc= (après création ou changement de site) l'explique.
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const elsewhere: Record<string, string> = Object.fromEntries(docs
    .filter((d) => d.siteId && !inSite(site, d.siteId))
    .map((d) => [d.id, siteLabel.get(d.siteId!) ?? d.siteId!]));
  return { rows, allIds: docs.map((d) => d.id), elsewhere, now };
});

/** Écran « Documents maîtrisés » : registre, indicateurs et listes de choix. */
export async function loadDocuments() {
  const [{ rows, allIds, elsewhere, now }, actions] = await Promise.all([loadDocumentBase(), loadActions()]);
  const inForce = rows.filter((r) => r.current);
  const overdue = rows.filter((r) => r.overdue).sort((a, b) => (a.reviewDays ?? 0) - (b.reviewDays ?? 0));
  const soon = rows.filter((r) => r.dueSoon);
  const inReview = rows.flatMap((r) => r.versions.filter((v) => v.status === 'en_revue'));
  const drafts = rows.flatMap((r) => r.versions.filter((v) => v.status === 'brouillon'));
  const oldest = overdue[0];

  const kpis: { key: 'vigueur' | 'revue' | 'retard' | 'brouillon'; label: string; value: number; sub: string; subTone: Tone; note: string }[] = [
    { key: 'vigueur', label: 'Documents en vigueur', value: inForce.length, sub: `sur ${rows.length}`, subTone: 'neutral', note: 'Dernière version approuvée et diffusée' },
    { key: 'revue', label: 'En revue · à approuver', value: inReview.length, sub: inReview.length ? 'en attente' : '', subTone: 'warn', note: 'Approbation : animateur QHSE ou direction' },
    {
      key: 'retard', label: 'Révisions en retard', value: overdue.length, sub: soon.length ? `+ ${soon.length} sous ${DOC_SOON_DAYS} j` : '', subTone: 'warn',
      note: oldest ? `Plus ancienne : ${oldest.id} · +${-(oldest.reviewDays ?? 0)} j` : 'Aucune revue périodique dépassée',
    },
    { key: 'brouillon', label: 'Brouillons', value: drafts.length, sub: '', subTone: 'neutral', note: 'Créations et révisions en rédaction' },
  ];

  const actionOptions = actions
    .filter((a) => actionColumn(a, now) !== 'done')
    .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((a) => [a.id, `${a.id} · ${a.title}`] as const);

  return { rows, allIds, elsewhere, now, kpis, overdueCount: overdue.length, actionOptions, suggestedDueOn: addDays(now, 30) };
}
export type DocumentsData = Awaited<ReturnType<typeof loadDocuments>>;

/** Badge de navigation (versions à approuver + revues dépassées) et échéances de revue à 15 jours. */
export async function loadDocumentSignals(): Promise<{ badge: number; todo: TodoItem[] }> {
  const [{ rows, now }, { role }] = await Promise.all([loadDocumentBase(), getSession()]);
  // Pas de lien vers un écran fermé au rôle (guard('docs') le renverrait à son accueil).
  const linkable = canSee(role, 'docs');
  const inReview = rows.reduce((n, r) => n + r.versions.filter((v) => v.status === 'en_revue').length, 0);
  const todo: TodoItem[] = rows
    .filter((r) => r.nextReviewOn && (r.overdue || r.dueSoon))
    .map((r) => ({
      date: r.overdue ? now : r.nextReviewOn!,
      kind: 'Revue documentaire',
      tone: r.overdue ? 'danger' : 'warn',
      title: r.overdue ? `${r.id} · ${r.title} — revue dépassée depuis le ${fmtDayMonth(r.nextReviewOn!)}` : `${r.id} · revue périodique « ${r.title} »`,
      who: r.owner,
      href: linkable ? `/documents?doc=${encodeURIComponent(r.id)}` : undefined,
    } satisfies TodoItem))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { badge: inReview + rows.filter((r) => r.overdue).length, todo };
}
