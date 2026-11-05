import 'server-only';
import { cache } from 'react';
import { isNotNull } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { readDocumentRevisions, readDocumentTypes, readDocumentValidations, readDocumentsByRef, readRegisterDocuments, type CodexDocType, type CodexDocument } from '@/lib/foreign/codex';
import { unavailableMessage } from '@/lib/foreign/labels';
import {
  CONF_LEVELS, QHSE_DEPARTMENTS, codexDocumentHref, confReadable, docStatus, documentHref, inRegisterScope, isInForce,
  isWithdrawn, processLabel, retentionText, reviewState, revisionStatus,
} from '@/lib/rules/documents';
import { config } from '@/lib/config';
import { fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import { canApprove, isClosedActionStatus, type Role, type TodoItem, type Tone } from '../domain';
import { actionView, lcfirst, loadActionRows, loadPeople, loadSiteRows, type ActionRow } from '../queries';
import { loadQhseLeads } from './leads';
import { currentSiteId, getSession, inSite, siteFilter, type SiteScope } from '../session';
import { loadLinkedEvents, type LinkedEvent } from './linked-events';

// ─── Documents lus dans Codex (lot 4 de M-02, D10, décision CV-05 du 05/11/2026) ─────────────────────────────────────
// Registre en consultation : documents des départements QHSE de Codex sans rattachement (C-06, QHSE_DEPARTMENTS), filtrés
// sur le site (pub_documents.site = identifiant de site de Vigie ; null = toute l'entreprise), le périmètre de la personne
// et la confidentialité (confReadable). Révisions, circuit en cours, actions et événements rattachés ; lien vers Codex
// (VIGIE_CODEX_URL). Aucune écriture : création, révisions, circuits, revues et retraits se font dans Codex.

/** Action du plan rattachée à un document ou à une révision (`open` = ni Vérifiée ni Abandonnée). */
export type LinkedAction = { id: string; label: string; statusLabel: string; tone: Tone; dueOn: string; late: boolean; open: boolean };

export type RevisionView = {
  letter: string; status: string; statusLabel: string; tone: Tone; createdAt: string | null; approvedAt: string | null; inForceAt: string | null;
  supersededAt: string | null; author: string | null; comment: string | null; fileName: string | null; changeRef: string | null;
  /** Action du plan rattachée à la révision (document_actions). */
  action: LinkedAction | null;
};

export type CircuitView = {
  workflowId: string; revision: string | null; due: string | null; overdue: boolean; submittedOn: string | null;
  steps: { idx: number; label: string; assignee: string; doneOn: string | null; current: boolean }[];
};

export type DocumentRow = {
  id: string;
  aliases: string[];
  title: string;
  typeCode: string;
  typeLabel: string;
  subtype: string | null;
  department: string | null;
  process: string | null;
  processLabel: string;
  owner: string;
  /** Propriétaire rapproché d'une personne de Vigie par son matricule (pilote d'une action de revue). */
  ownerId: string | null;
  siteId: string | null;
  siteLabel: string;
  conf: string | null;
  confLabel: string;
  origin: string | null;
  sourceOrg: string | null;
  status: string;
  statusLabel: string;
  statusTone: Tone;
  inForce: boolean;
  withdrawn: boolean;
  revInForce: string | null;
  revWorking: string | null;
  issuedAt: string | null;
  withdrawnOn: string | null;
  legalHold: boolean;
  distribution: string;
  reviewMonths: number | null;
  nextReviewOn: string | null;
  reviewDays: number | null;
  overdue: boolean;
  dueSoon: boolean;
  /** Conservation par type (registre de Codex). */
  retention: string | null;
  retentionBasis: string | null;
  /** Révisions, la plus récente d'abord. */
  revisions: RevisionView[];
  /** Circuit de validation en cours (Codex). */
  circuit: CircuitView | null;
  openActions: LinkedAction[];
  closedActions: LinkedAction[];
  events: LinkedEvent[];
  /** Fiche du document dans Codex ; null sans VIGIE_CODEX_URL. */
  codexHref: string | null;
  /** Détail proposé pour une action de revue périodique. */
  actionTitle: string;
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
export const matchesSearch = (d: Pick<DocumentRow, 'id' | 'title' | 'aliases'>, q: string) => !q || fold(`${d.id} ${d.aliases.join(' ')} ${d.title}`).includes(fold(q));

/** Personnes de Vigie par matricule (rapprochement des propriétaires et valideurs de Codex). */
async function peopleByMatricule(db: DbOrTx) {
  const rows = await db.select({ id: t.people.id, matricule: t.people.matricule, leftOn: t.people.leftOn }).from(t.people).where(isNotNull(t.people.matricule));
  return new Map(rows.map((p) => [p.matricule!, p]));
}

const linkedAction = (a: ActionRow, people: Awaited<ReturnType<typeof loadPeople>>, now: string): LinkedAction => {
  const v = actionView(a, people, now);
  return { id: a.id, label: v.label, statusLabel: v.statusLabel, tone: v.tone, dueOn: a.dueOn, late: v.late, open: !isClosedActionStatus(a.status) };
};

/**
 * Lectures du registre : documents du périmètre QHSE lisibles par le rôle, du site sélectionné (scope 'site') ou de tout
 * le périmètre (scope 'perimeter' : échéances). `source` : état de la lecture de Codex (bandeau « source indisponible »).
 */
const loadDocumentBase = cache(async (scope: SiteScope = 'site') => {
  const db = await getDb();
  const now = today();
  const [{ role }, keep, perimeter, site, read, sites, matricules] = await Promise.all([
    getSession(), siteFilter(scope), siteFilter('perimeter'), currentSiteId(), readRegisterDocuments(db, QHSE_DEPARTMENTS), loadSiteRows(), peopleByMatricule(db),
  ]);
  const qhse = canApprove(role);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  if (!read.ok) {
    return {
      source: { ok: false as const, message: unavailableMessage('documents') }, rows: [] as DocumentRow[], elsewhere: {} as Record<string, string>,
      aliasOf: {} as Record<string, string>, inPerimeter: [] as CodexDocument[], now, matricules, stepMatricules: new Map<string, string>(),
    };
  }
  const readable = read.rows.filter((d) => inRegisterScope(d) && confReadable(d.conf, qhse));
  const inPerimeter = readable.filter((d) => perimeter(d.site));
  const kept = inPerimeter.filter((d) => keep(d.site));
  const ids = kept.map((d) => d.id);
  const [revisions, validations, types, people, actions, links, events] = await Promise.all([
    readDocumentRevisions(db, ids), readDocumentValidations(db, ids), readDocumentTypes(db), loadPeople(),
    loadActionRows().then((rows) => rows.filter((a) => a.status !== 'abandonnee')),
    db.select().from(t.documentActions),
    loadLinkedEvents('document', ids),
  ]);
  const typeOf = new Map((types.ok ? types.rows : []).map((x) => [x.code, x] as [string, CodexDocType]));
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const rows = kept.map((d) => buildRow(d, {
    now, typeOf, siteLabel, matricules, people,
    revisions: revisions.ok ? revisions.rows.filter((r) => r.docId === d.id) : [],
    steps: validations.ok ? validations.rows.filter((v) => v.docId === d.id) : [],
    actions: actions.filter((a) => a.documentId === d.id || links.some((l) => l.codexId === d.id && l.actionId === a.id)),
    revisionAction: (letter) => {
      const l = links.find((x) => x.codexId === d.id && x.revision === letter);
      const a = l ? actionById.get(l.actionId) : undefined;
      return a ? linkedAction(a, people, now) : null;
    },
    events: events.get(d.id) ?? [],
  }));
  // Documents d'un autre site du périmètre : la fiche ouverte par ?doc= l'explique (hors périmètre : rien n'est révélé).
  const elsewhere: Record<string, string> = Object.fromEntries(inPerimeter
    .filter((d) => d.site && !inSite(site, d.site))
    .map((d) => [d.id, siteLabel.get(d.site!) ?? d.site!]));
  // Personne de l'étape en cours de chaque circuit ouvert (matricule, jamais envoyé au navigateur) : destinataire de l'échéance.
  const stepMatricules = new Map((validations.ok ? validations.rows : [])
    .filter((v) => !v.outcome && v.idx === v.currentStep && v.assigneeMatricule)
    .map((v) => [`${v.docId}|${v.workflowId}`, v.assigneeMatricule!]));
  const aliasOf: Record<string, string> = Object.fromEntries(inPerimeter.flatMap((d) => d.aliases.map((a) => [a, d.id])));
  return {
    source: { ok: true as const, message: null },
    rows: rows.sort((a, b) => Number(a.withdrawn) - Number(b.withdrawn) || a.typeLabel.localeCompare(b.typeLabel, 'fr') || a.id.localeCompare(b.id, 'fr', { numeric: true })),
    elsewhere, aliasOf, inPerimeter, now, matricules, stepMatricules,
  };
});

type RowContext = {
  now: string; typeOf: Map<string, CodexDocType>; siteLabel: Map<string, string>; matricules: Map<string, { id: string }>;
  people: Awaited<ReturnType<typeof loadPeople>>;
  revisions: Awaited<ReturnType<typeof readDocumentRevisions>> extends infer R ? R extends { ok: true; rows: infer X } ? X : never : never;
  steps: Awaited<ReturnType<typeof readDocumentValidations>> extends infer R ? R extends { ok: true; rows: infer X } ? X : never : never;
  actions: ActionRow[];
  revisionAction(letter: string): LinkedAction | null;
  events: LinkedEvent[];
};

function buildRow(d: CodexDocument, c: RowContext): DocumentRow {
  const type = d.typeCode ? c.typeOf.get(d.typeCode) : undefined;
  const st = docStatus(d.status);
  const inForce = isInForce(d);
  const withdrawn = isWithdrawn(d);
  const review = inForce ? reviewState(d.reviewDueAt, c.now) : { reviewDays: null, overdue: false, dueSoon: false };
  const owner = d.ownerMatricule ? c.matricules.get(d.ownerMatricule) : undefined;
  const open = c.steps.filter((s) => !s.outcome);
  const first = open[0];
  const circuit: CircuitView | null = first ? {
    workflowId: first.workflowId, revision: first.revision, due: first.due, overdue: !!first.due && first.due < c.now, submittedOn: first.createdAt,
    steps: open.filter((s) => s.workflowId === first.workflowId).map((s) => ({
      idx: s.idx, label: s.stepLabel ?? `Étape ${s.idx + 1}`, assignee: s.assigneeName ?? '—', doneOn: s.doneOn, current: s.idx === first.currentStep,
    })),
  } : null;
  const actions = [...c.actions].sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true })).map((a) => linkedAction(a, c.people, c.now));
  return {
    id: d.id, aliases: d.aliases, title: d.title, typeCode: d.typeCode ?? '', typeLabel: type?.label ?? d.typeCode ?? '—', subtype: d.subtype,
    department: d.department, process: d.processCode, processLabel: processLabel(d.processCode),
    owner: d.ownerName ?? '—', ownerId: owner?.id ?? null,
    siteId: d.site, siteLabel: d.site ? c.siteLabel.get(d.site) ?? d.site : 'Tous les sites',
    conf: d.conf, confLabel: CONF_LEVELS[d.conf ?? ''] ?? d.conf ?? '—', origin: d.origin, sourceOrg: d.sourceOrg,
    status: d.status ?? '', statusLabel: st.label, statusTone: st.tone, inForce, withdrawn,
    revInForce: d.revInForce, revWorking: d.revWorking, issuedAt: d.issuedAt, withdrawnOn: d.archivedAt ?? d.obsoleteAt, legalHold: d.legalHold,
    distribution: d.distribution ?? '', reviewMonths: d.reviewMonths,
    nextReviewOn: inForce ? d.reviewDueAt : null, ...review,
    retention: retentionText(type), retentionBasis: type?.retentionBasis || null,
    revisions: [...c.revisions].reverse().map((r) => {
      const s = revisionStatus(r.status);
      return {
        letter: r.letter, status: r.status, statusLabel: s.label, tone: s.tone, createdAt: r.createdAt, approvedAt: r.approvedAt, inForceAt: r.inForceAt,
        supersededAt: r.supersededAt, author: r.lastVersionAuthor, comment: r.comment, fileName: r.fileName, changeRef: r.changeRef, action: c.revisionAction(r.letter),
      };
    }),
    circuit,
    openActions: actions.filter((a) => a.open),
    closedActions: actions.filter((a) => !a.open),
    events: c.events,
    codexHref: codexDocumentHref(config().codexUrl, d.id),
    actionTitle: `Revue périodique de ${d.id} — ${lcfirst(d.title)}`,
  };
}

/**
 * Consultation seule (rôles sans droit de rédaction) : documents en vigueur, réduits à leur révision en vigueur ; ni
 * révisions en cours, ni circuit, ni actions ou événements liés (ISO 9001 §7.5.3 : seule la version approuvée est diffusée).
 */
const readerView = (r: DocumentRow): DocumentRow => ({
  ...r, revisions: r.revisions.filter((x) => x.status === 'in_force').map((x) => ({ ...x, action: null })), circuit: null,
  openActions: [], closedActions: [], events: [], overdue: false, dueSoon: false, revWorking: null,
});

/** Document demandé par lien (?doc=) mais absent de la consultation : jamais en vigueur, ou retiré. */
export type UnavailableDoc = 'draft' | 'retired';

type KpiTile = { key: 'vigueur' | 'validation' | 'retard' | 'brouillon'; label: string; value: number; sub: string; subTone: Tone; note: string };

/** Écran « Documents » : registre lu dans Codex, indicateurs. `readOnly` : consultation des documents en vigueur. */
export async function loadDocuments({ readOnly = false }: { readOnly?: boolean } = {}) {
  const base = await loadDocumentBase();
  const { now, source, elsewhere, aliasOf } = base;
  if (readOnly) {
    const rows = base.rows.filter((r) => r.inForce).map(readerView);
    const shown = new Set(rows.map((r) => r.id));
    const unavailable: Record<string, UnavailableDoc> = Object.fromEntries(base.inPerimeter
      .filter((d) => !isInForce(d))
      .map((d) => [d.id, isWithdrawn(d) ? 'retired' : 'draft']));
    return {
      source, rows, now, aliasOf, unavailable, overdueCount: 0,
      kpis: [{ key: 'vigueur', label: 'Documents en vigueur', value: rows.length, sub: '', subTone: 'neutral', note: 'Révision en vigueur dans Codex' }] as KpiTile[],
      elsewhere: Object.fromEntries(Object.entries(elsewhere).filter(([id]) => base.inPerimeter.some((d) => d.id === id && isInForce(d)) && !shown.has(id))),
    };
  }
  const { rows } = base;
  const inForce = rows.filter((r) => r.inForce);
  const overdue = rows.filter((r) => r.overdue).sort((a, b) => (a.reviewDays ?? 0) - (b.reviewDays ?? 0));
  const soon = rows.filter((r) => r.dueSoon);
  const validating = rows.filter((r) => r.circuit);
  const drafts = rows.filter((r) => r.revisions.some((x) => x.status === 'draft'));
  const oldest = overdue[0];
  const kpis: KpiTile[] = [
    { key: 'vigueur', label: 'Documents en vigueur', value: inForce.length, sub: `sur ${rows.length}`, subTone: 'neutral', note: 'Révision en vigueur dans Codex' },
    { key: 'validation', label: 'En circuit de validation', value: validating.length, sub: validating.some((r) => r.circuit?.overdue) ? 'échéance dépassée' : '', subTone: 'warn', note: 'Circuits de validation de Codex' },
    {
      key: 'retard', label: 'Revues en retard', value: overdue.length, sub: soon.length ? `+ ${soon.length} sous 15 j` : '', subTone: 'warn',
      note: oldest ? `Plus ancienne : ${oldest.id} · +${-(oldest.reviewDays ?? 0)} j` : 'Aucune revue périodique dépassée',
    },
    { key: 'brouillon', label: 'Révisions en rédaction', value: drafts.length, sub: '', subTone: 'neutral', note: 'Brouillons ouverts dans Codex' },
  ];
  return { source, rows, now, aliasOf, elsewhere, unavailable: {} as Record<string, UnavailableDoc>, kpis, overdueCount: overdue.length };
}

// ─── Résolution d'un document cité par une fiche de Vigie ────────────────────

/** Document cité par une fiche (événement, action, mesure de maîtrise), résolu quel que soit le périmètre du registre. */
export type DocumentRef = {
  id: string; title: string; site: string | null; inForce: boolean; withdrawn: boolean; reviewDueAt: string | null;
  /** Lisible par le rôle (confidentialité) : sinon seul l'identifiant est montré. */
  readable: boolean;
  /** Dans le registre de Vigie (périmètre QHSE) : lien vers /documents, sinon vers Codex seulement. */
  inRegister: boolean;
  href: string | null;
};

/**
 * Documents désignés par identifiant ou ancien identifiant (alias) : `byRef` (identifiant ou alias → document) ;
 * `ok: false` quand Codex est indisponible (l'identifiant seul est alors affiché).
 */
export async function resolveDocuments(refs: readonly (string | null | undefined)[], opts: { db?: DbOrTx; role?: Role } = {}) {
  const list = [...new Set(refs.filter((r): r is string => !!r))];
  const db = opts.db ?? await getDb();
  const role = opts.role ?? (await getSession()).role;
  const byRef = new Map<string, DocumentRef>();
  if (!list.length) return { ok: true as const, byRef };
  const read = await readDocumentsByRef(db, list);
  if (!read.ok) return { ok: false as const, byRef, message: unavailableMessage('documents') };
  const base = config().codexUrl;
  for (const d of read.rows) {
    const inRegister = inRegisterScope(d);
    const ref: DocumentRef = {
      id: d.id, title: d.title, site: d.site, inForce: isInForce(d), withdrawn: isWithdrawn(d), reviewDueAt: d.reviewDueAt,
      readable: confReadable(d.conf, canApprove(role)), inRegister, href: inRegister ? documentHref(d.id) : codexDocumentHref(base, d.id),
    };
    for (const k of [d.id, ...d.aliases]) if (list.includes(k) && !byRef.has(k)) byRef.set(k, ref);
  }
  return { ok: true as const, byRef };
}

/** Libellé d'un document cité : « identifiant · titre » s'il est lisible, l'identifiant seul sinon. */
export const documentRefLabel = (ref: string, d: DocumentRef | undefined) => (d?.readable ? `${d.id} · ${d.title}` : d?.id ?? ref);

/** Documents en vigueur du registre lisibles par le rôle (listes de choix des rattachements : événements, mesures, actions). */
export const loadDocumentChoices = cache(async (scope: SiteScope = 'perimeter') => {
  const base = await loadDocumentBase(scope);
  return {
    source: base.source,
    rows: base.rows.filter((r) => r.inForce || (!r.withdrawn && !!r.revWorking)).map((r) => ({ id: r.id, aliases: r.aliases, title: r.title, siteId: r.siteId, inForce: r.inForce, revWorking: r.revWorking, revisions: r.revisions })),
  };
});

// ─── Échéances documentaires (DOC-14) ───────────────────────────────────────

/**
 * Échéances documentaires sur tout le périmètre (TDB-05 ; site du document, null = toute l'entreprise) :
 * - revue périodique dépassée ou à moins de 15 j (review_due_at de Codex) : au propriétaire rapproché par son matricule,
 *   sinon au responsable QHSE du site ; l'intitulé dit la révision ouverte ou l'action de revue en cours (hors clé) ;
 * - circuit de validation en cours : à la personne de l'étape en cours rapprochée par son matricule, sinon au propriétaire,
 *   sinon au responsable QHSE du site ; dépassé après l'échéance du circuit ;
 * - Codex indisponible : une seule échéance commune au service QHSE (aucune absence silencieuse).
 */
export const loadDocumentSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [{ rows, now, source, matricules, stepMatricules }, leads] = await Promise.all([loadDocumentBase('perimeter'), loadQhseLeads()]);
  if (!source.ok) {
    const lead = leads.forSite(null);
    return {
      todo: [{
        kind: 'Revue documentaire', key: 'documents-codex-indisponible', who: lead.who, ownerIds: lead.ownerIds, href: '/documents', siteId: null,
        date: now, tone: 'warn', title: 'Documents de Codex indisponibles : revues et circuits de validation non suivis',
      }],
    };
  }
  const todo: TodoItem[] = [];
  for (const r of rows) {
    const lead = leads.forSite(r.siteId);
    const ownerTo = r.ownerId ? { ownerIds: [r.ownerId], who: r.owner } : { ownerIds: lead.ownerIds, who: lead.who };
    if (r.nextReviewOn && (r.overdue || r.dueSoon)) {
      const title = r.overdue ? `${r.id} · ${r.title} — revue dépassée depuis le ${fmtDayMonth(r.nextReviewOn)}` : `${r.id} · revue périodique « ${r.title} »`;
      const progress = r.circuit ? ` · révision ${r.circuit.revision ?? ''} en validation` : r.revWorking ? ` · révision ${r.revWorking} en rédaction`
        : r.openActions.length ? ` · action ${r.openActions[0].id} en cours` : '';
      todo.push({
        date: r.overdue ? now : r.nextReviewOn, dueOn: r.nextReviewOn, kind: 'Revue documentaire', tone: r.overdue ? 'danger' : 'warn', overdue: r.overdue,
        title: `${title}${progress}`, key: `revue-documentaire|${r.id}`, ...ownerTo, siteId: r.siteId, href: documentHref(r.id),
      });
    }
    if (r.circuit) {
      const step = r.circuit.steps.find((s) => s.current);
      const matricule = stepMatricules.get(`${r.id}|${r.circuit.workflowId}`);
      const person = matricule ? matricules.get(matricule) : undefined;
      const to = person && !person.leftOn ? { ownerIds: [person.id], who: step!.assignee } : ownerTo;
      const due = r.circuit.due ?? r.circuit.submittedOn ?? now;
      todo.push({
        date: r.circuit.overdue ? now : due, dueOn: due, kind: 'Validation documentaire', tone: r.circuit.overdue ? 'danger' : 'warn', overdue: r.circuit.overdue,
        title: `${r.id} · révision ${r.circuit.revision ?? ''} à valider dans Codex${step ? ` (${lcfirst(step.label)})` : ''}`,
        key: `validation-documentaire|${r.id}|${r.circuit.revision ?? ''}`, ...to, siteId: r.siteId, href: documentHref(r.id),
      });
    }
  }
  return { todo: todo.sort((a, b) => a.date.localeCompare(b.date)) };
});
