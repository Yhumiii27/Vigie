import 'server-only';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { entryRef } from '../components/environment/model';
import * as t from '../db/schema';
import type { DbOrTx } from '../db/types';

// ─── Sources d'origine des actions Prévention, Documents et Environnement (ACT-01) ─────────────────────────────────
//
// Une action d'origine Prévention, Documents ou Environnement porte sa source dans une colonne dédiée (plan de
// prévention, permis, document maîtrisé, filière ou enlèvement du registre des déchets), comme eventId et reviewId : une
// au plus, posée à la création (lien explicite de l'écran appelant) ou par la reprise des références textuelles des
// actions anciennes (resolveOriginRef, backfillActionLinks), conservée sur une action abandonnée, jamais remplacée ensuite
// (origine verrouillée). Les écrans retrouvent leurs actions par ces colonnes, plus par la référence textuelle
// (originRef), qui reste affichée telle qu'elle a été saisie. Plans de prévention et permis : liens repris seulement
// (aucune action QSE n'est plus créée depuis la Prévention, réponses du service QHSE du 15/10/2026).
//
// Module sans dépendance au serveur Next (session, cookies) : utilisé par le registre des rattachements
// (src/lib/action-links.ts), par la mise à niveau d'une base de démonstration (src/db/seed.ts) et par le script de reprise
// (commande reprise-liens de scripts/vigie-db.ts : npm run db:reprise-liens, vigie-db reprise-liens dans l'image).

/** Colonnes de l'action qui portent sa source d'origine. */
export const ORIGIN_COLUMNS = ['preventionPlanId', 'permitId', 'documentId', 'wasteStreamId', 'wasteEntryId'] as const;
export type OriginColumn = (typeof ORIGIN_COLUMNS)[number];

/**
 * Anciennes origines (avant 0005 : actions.legacy_origin, libellés LEGACY_ORIGIN_LABELS de src/lib/domain.ts) dont
 * l'action est rattachée à une fiche source par ces colonnes.
 */
export const ORIGINS_WITH_SOURCE = ['prevention', 'docs', 'env'] as const;

/** Par colonne : type de lien du registre (`<kind>:<id>`, src/lib/action-links.ts), origine de l'action, libellé. */
export const ORIGIN_LINKS: Record<OriginColumn, { kind: string; origin: (typeof ORIGINS_WITH_SOURCE)[number]; label: string }> = {
  preventionPlanId: { kind: 'preventionplan', origin: 'prevention', label: 'plan de prévention' },
  permitId: { kind: 'permit', origin: 'prevention', label: 'permis' },
  documentId: { kind: 'document', origin: 'docs', label: 'document' },
  wasteStreamId: { kind: 'wastestream', origin: 'env', label: 'filière de déchets' },
  wasteEntryId: { kind: 'wasteentry', origin: 'env', label: 'enlèvement du registre des déchets' },
};

/** Lien du registre vers la source `target` de la colonne `column` (ex. « preventionplan:PP-2026-012 »). */
export const originLink = (column: OriginColumn, target: string | number) => `${ORIGIN_LINKS[column].kind}:${target}`;

/** « Coactivité JJ/MM/AAAA » (référence d'une action reprise, issue d'une situation de coactivité sans plan de prévention). */
const COACTIVITY_REF = /^Coactivité (\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/;

/**
 * Lien de la référence d'origine « Coactivité JJ/MM/AAAA » d'une action reprise (ACT-12) : carte du site de l'action à
 * cette date (/prevention/carte?site=…&date=AAAA-MM-JJ), au lieu de l'écran Prévention ; null pour toute autre référence ou
 * une date qui n'existe pas. Sans site (action « Tous les sites » reprise) : la carte du site sélectionné à cette date.
 */
export function coactivityOriginHref(originRef: string, siteId: string | null): string | null {
  const m = COACTIVITY_REF.exec(originRef.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return `/prevention/carte?${siteId ? `site=${encodeURIComponent(siteId)}&` : ''}date=${iso}`;
}

// ─── Résolution d'une référence d'origine (règle pure) ──────────────────────

/** Fiches sources connues : identifiants des plans, permis, documents et filières ; enlèvements (annulés compris). */
export type OriginCatalog = {
  plans: ReadonlySet<string>;
  permits: ReadonlySet<string>;
  documents: ReadonlySet<string>;
  streams: ReadonlySet<string>;
  entries: readonly { id: number; streamId: string; removedOn: string }[];
};

/** Source trouvée (`note` : précision pour le rapport de reprise), ou motif de l'absence de source. */
export type OriginResolution =
  | { column: OriginColumn; target: string | number; note?: string }
  | { column: null; reason: string };

/** « FD-11 · 19/08/2026 » ou « FD-11 · 19/08/2026 · n° 42 » (entryRef, src/components/environment/model.ts). */
const ENTRY_REF = /^(\S+) · (\d{2})\/(\d{2})\/(\d{4})(?: · n° (\d+))?$/;
/** Premier mot d'une référence (« PP-2026-012 · relance » → « PP-2026-012 »). */
const firstToken = (ref: string) => ref.split(/[\s·,]+/)[0] ?? '';

/**
 * Source d'une action d'après son origine et sa référence textuelle, selon la règle qu'appliquaient les écrans avant les
 * liens réels (rien de ce qu'ils affichaient n'est perdu) :
 * - Prévention : plan ou permis de cette référence, à défaut de son premier mot ;
 * - Documents : document de cette référence, à défaut de son premier mot ;
 * - Environnement : filière (« FD-04 ») ; enlèvement (« FD-11 · 19/08/2026 », le premier inscrit ce jour-là comme sur le
 *   registre ; « … · n° 42 » : l'enlèvement n° 42, même si sa date ou sa filière a changé depuis) ; à défaut la filière
 *   du premier mot. « Registre des déchets 2026 » et « Coactivité … » n'ont pas de fiche source.
 * null : origine sans fiche source (événement, audit, risque, veille, revue, habilitations).
 */
export function resolveOriginRef(origin: string, originRef: string, c: OriginCatalog): OriginResolution | null {
  const ref = originRef.trim();
  const first = firstToken(ref);
  switch (origin) {
    case 'prevention':
      for (const id of [ref, first]) {
        if (c.plans.has(id)) return { column: 'preventionPlanId', target: id };
        if (c.permits.has(id)) return { column: 'permitId', target: id };
      }
      return { column: null, reason: /^Coactivité(\s|$)/.test(ref) ? 'Coactivité sans plan de prévention : aucune fiche source.' : 'Aucun plan de prévention ni permis de cette référence.' };
    case 'docs':
      for (const id of [ref, first]) if (c.documents.has(id)) return { column: 'documentId', target: id };
      return { column: null, reason: 'Aucun document maîtrisé de cette référence.' };
    case 'env': {
      if (c.streams.has(ref)) return { column: 'wasteStreamId', target: ref };
      const m = ENTRY_REF.exec(ref);
      if (m) {
        const [, streamId, dd, mm, yyyy, n] = m;
        const day = `${dd}/${mm}/${yyyy}`;
        if (n) {
          const entry = c.entries.find((e) => e.id === Number(n));
          if (entry) {
            const moved = entry.streamId !== streamId || entry.removedOn !== `${yyyy}-${mm}-${dd}`;
            return { column: 'wasteEntryId', target: entry.id, note: moved ? `Enlèvement n° ${n} modifié depuis (${entryRef(entry.streamId, entry.removedOn)}).` : undefined };
          }
        } else {
          const sameDay = c.entries.filter((e) => e.streamId === streamId && e.removedOn === `${yyyy}-${mm}-${dd}`).sort((a, b) => a.id - b.id);
          if (sameDay.length) {
            return {
              column: 'wasteEntryId', target: sameDay[0].id,
              note: sameDay.length > 1 ? `${sameDay.length} enlèvements ${streamId} le ${day} : rattachée au premier inscrit (n° ${sameDay[0].id}), comme sur le registre.` : undefined,
            };
          }
        }
        if (c.streams.has(streamId)) {
          return { column: 'wasteStreamId', target: streamId, note: `Aucun enlèvement ${n ? `n° ${n}` : `${streamId} le ${day}`} : rattachée à la filière ${streamId}.` };
        }
      }
      if (c.streams.has(first)) return { column: 'wasteStreamId', target: first };
      return { column: null, reason: /^Registre des déchets \d{4}$/.test(ref) ? 'Registre annuel des déchets : aucune fiche source.' : 'Aucune filière ni enlèvement de cette référence.' };
    }
    default:
      return null;
  }
}

/** Identifiants candidats d'une référence (catalogue réduit à une création). */
function candidates(originRef: string) {
  const ref = originRef.trim();
  const m = ENTRY_REF.exec(ref);
  return { ids: [...new Set([ref, firstToken(ref), ...(m ? [m[1]] : [])])].filter(Boolean), entryIds: m?.[5] ? [Number(m[5])] : [] };
}

/** Fiches sources de la base : toutes (reprise), ou seulement celles que la référence `originRef` peut désigner (création). */
export async function loadOriginCatalog(db: DbOrTx, originRef?: string): Promise<OriginCatalog> {
  const only = originRef === undefined ? null : candidates(originRef);
  const ids = only?.ids ?? [];
  if (only && !ids.length) return { plans: new Set(), permits: new Set(), documents: new Set(), streams: new Set(), entries: [] };
  const set = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  // Requêtes successives : une transaction ou un client PostgreSQL unique (script de reprise) n'en exécute qu'une à la fois.
  const plans = set(await db.select({ id: t.preventionPlans.id }).from(t.preventionPlans).where(only ? inArray(t.preventionPlans.id, ids) : undefined));
  const permits = set(await db.select({ id: t.permits.id }).from(t.permits).where(only ? inArray(t.permits.id, ids) : undefined));
  const documents = set(await db.select({ id: t.documents.id }).from(t.documents).where(only ? inArray(t.documents.id, ids) : undefined));
  const streams = set(await db.select({ id: t.wasteStreams.id }).from(t.wasteStreams).where(only ? inArray(t.wasteStreams.id, ids) : undefined));
  const entries = await db.select({ id: t.wasteEntries.id, streamId: t.wasteEntries.streamId, removedOn: t.wasteEntries.removedOn }).from(t.wasteEntries)
    .where(only ? (only.entryIds.length ? or(inArray(t.wasteEntries.streamId, ids), inArray(t.wasteEntries.id, only.entryIds)) : inArray(t.wasteEntries.streamId, ids)) : undefined);
  return { plans, permits, documents, streams, entries };
}

// ─── Reprise des références d'origine textuelles ────────────────────────────

/** Rapport de la reprise : liens posés (ou à poser en essai), références sans fiche source (`origin` : legacy_origin). */
export type ActionLinksBackfillReport = {
  applied: boolean;
  /** Actions d'origine Prévention, Documents ou Environnement examinées. */
  examined: number;
  /** Actions déjà rattachées à leur source (jamais modifiées). */
  alreadyLinked: number;
  /** `target` : identifiant de la source ; `label` : sa désignation (« plan de prévention PP-2026-012 »). */
  linked: { actionId: string; column: OriginColumn; target: string; label: string; note?: string }[];
  /** Référence conservée telle quelle, sans lien (motif). */
  unresolved: { actionId: string; origin: string; originRef: string; reason: string }[];
};

/**
 * Reprise des références d'origine textuelles des actions existantes (bases antérieures à la migration 0004) : pose la
 * colonne de la source trouvée par resolveOriginRef, une entrée « Origine rattachée » au journal de l'action (auteur
 * vide : reprise automatique), dans une transaction. Idempotente : une action déjà rattachée à une source n'est jamais
 * modifiée (aucun lien remplacé), une relance ne pose que les liens restants. `apply: false` : essai, rapport sans écriture.
 *
 * Depuis la migration 0005, l'origine lue est l'ancienne origine conservée par la reprise (actions.legacy_origin, D9) :
 * une action créée après 0005 (legacy_origin vide) n'est jamais examinée — elle porte sa source dès la création.
 */
export async function backfillActionLinks(db: DbOrTx, opts: { apply: boolean }): Promise<ActionLinksBackfillReport> {
  const actions = await db.select().from(t.actions).where(inArray(t.actions.legacyOrigin, [...ORIGINS_WITH_SOURCE]));
  const catalog = await loadOriginCatalog(db);
  const entries = new Map(catalog.entries.map((e) => [e.id, e]));
  const report: ActionLinksBackfillReport = { applied: opts.apply, examined: actions.length, alreadyLinked: 0, linked: [], unresolved: [] };
  for (const a of [...actions].sort((x, y) => x.id.localeCompare(y.id, 'fr', { numeric: true }))) {
    if (ORIGIN_COLUMNS.some((c) => a[c] != null)) {
      report.alreadyLinked++;
      continue;
    }
    const origin = a.legacyOrigin!; // filtré par la requête (inArray)
    const found = resolveOriginRef(origin, a.originRef, catalog);
    if (!found) continue;
    if (found.column === null) {
      report.unresolved.push({ actionId: a.id, origin, originRef: a.originRef, reason: found.reason });
      continue;
    }
    const entry = found.column === 'wasteEntryId' ? entries.get(Number(found.target)) : undefined;
    const shown = entry ? entryRef(entry.streamId, entry.removedOn, entry.id) : String(found.target);
    report.linked.push({ actionId: a.id, column: found.column, target: String(found.target), label: `${ORIGIN_LINKS[found.column].label} ${shown}`, note: found.note });
  }
  if (!opts.apply || !report.linked.length) return report;

  const applied: ActionLinksBackfillReport['linked'] = [];
  await db.transaction(async (tx) => {
    for (const l of report.linked) {
      const value = l.column === 'wasteEntryId' ? Number(l.target) : l.target;
      // Garde : aucune source posée entre-temps (serveur ouvert pendant la reprise).
      const done = await tx.update(t.actions).set({ [l.column]: value } as Partial<typeof t.actions.$inferInsert>)
        .where(and(eq(t.actions.id, l.actionId), ...ORIGIN_COLUMNS.map((c) => isNull(t.actions[c]))))
        .returning({ id: t.actions.id });
      if (!done.length) continue;
      applied.push(l);
      // Même entrée que logChange (src/server/changelog.ts), sans personne connectée : auteur vide = reprise automatique.
      await tx.insert(t.changeLog).values({
        entityType: 'action', entityId: l.actionId, action: 'link', byId: null,
        summary: `Origine rattachée : ${l.label} (reprise de la référence d'origine)`,
        details: [{ field: 'Origine', from: null, to: l.label }],
      });
    }
  });
  report.alreadyLinked += report.linked.length - applied.length;
  report.linked = applied;
  return report;
}

/** Rapport lisible (npm run db:reprise-liens, outil d'exploitation). */
export function formatBackfillReport(r: ActionLinksBackfillReport): string[] {
  const n = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;
  const lines = [
    r.applied ? 'Reprise des liens d’origine des actions (ACT-01) : liens enregistrés.' : 'Reprise des liens d’origine des actions (ACT-01) : essai, aucune écriture (--appliquer pour enregistrer).',
    `  ${n(r.examined, 'action Prévention, Documents ou Environnement examinée', 'actions Prévention, Documents ou Environnement examinées')}, ${n(r.alreadyLinked, 'déjà rattachée', 'déjà rattachées')} (inchangées).`,
  ];
  lines.push(r.linked.length ? `  ${r.applied ? 'Rattachées' : 'À rattacher'} (${r.linked.length}) :` : `  ${r.applied ? 'Aucun lien posé' : 'Aucun lien à poser'}.`);
  r.linked.forEach((l) => lines.push(`    ${l.actionId} → ${l.label}${l.note ? ` — ${l.note}` : ''}`));
  if (r.unresolved.length) {
    lines.push(`  Sans fiche source, référence conservée telle quelle (${r.unresolved.length}) :`);
    r.unresolved.forEach((u) => lines.push(`    ${u.actionId} « ${u.originRef} » : ${u.reason}`));
  }
  return lines;
}
