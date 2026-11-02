import 'server-only';
import { eq } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { STUDY_BLOCKING_ARG, applyActionLink, applyCreationLink, linkLogEntity } from '@/lib/action-links';
import { actionHref, actionLabel } from '@/lib/action-rules';
import { fmtDate } from '@/lib/dates';
import {
  ACTION_DOMAINS, ACTION_PRIORITIES, ACTION_RISK_LEVELS, ACTION_SOURCES, ACTION_TEXT_MAX, DOMAIN_KEYS, PRIORITY_KEYS, VERIFY_METHODS,
  type ActionDomain, type ActionPriority, type FollowReason, type SourceKey, type VerifyMethod,
} from '@/lib/domain';
import { fmtDecimal, type formReader } from '@/lib/forms';
import { requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import type { ActionRow } from '@/lib/queries';
import { checkUploadBatch } from '@/lib/uploads';
import { logChange, type ChangeDetail } from './changelog';
import { actionConfieeTitle, notify } from './notify';
import { nextActionNumber } from './action-core';

// Création d'une action du plan d'actions QSE (ACT-20, ACT-23, ACT-30, ACT-35), dans la transaction de l'appelant :
// saveAction (src/server/plan.ts) et les actions de suite de verifyAction (src/server/plan-ui.ts) ; réutilisable par
// l'import Power Apps (ACT-39). Pas de 'use server' : ce module n'expose aucune action appelable depuis le navigateur ; il
// ne lit jamais la session (auteur passé explicitement : appelable dans une transaction PGlite). Les droits, le site et
// la validation sont contrôlés par l'appelant, avant la transaction (ordre des server actions de CLAUDE.md).
// Aussi : libellés et mise en forme des champs d'une action pour le journal (création, modification), lecture commune
// des champs d'une nouvelle action (formulaire du plan, sections « Nouvelle action » de la vérification).

/** Valeurs d'une nouvelle action (déjà validées). */
export type NewActionInput = {
  source: SourceKey | null; // null : action de suite d'une action reprise dont la source est « à compléter »
  originRef: string;
  pilotId: string;
  priority: ActionPriority;
  dueOn: string;
  domain: ActionDomain;
  problem: string;
  detail: string;
  verifyDueOn: string;
  riskLevel: number | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  siteId: string;
  followsActionId?: string | null;
  followReason?: FollowReason | null;
  /** Liens à poser (registre src/lib/action-links.ts), dans l'ordre. */
  links?: readonly string[];
  /** Création depuis un écran ou le plan : un lien refusé annule toute la création (ActionLinkError) ; sinon il est sauté. */
  strictLinks?: boolean;
};

/** Lien refusé à la création stricte : la transaction est annulée, le message va au champ « Élément lié ». */
export class ActionLinkError extends Error {
  constructor(message: string, readonly link: string) {
    super(message);
    this.name = 'ActionLinkError';
  }
}

// ─── Journal : libellés et mise en forme des champs ─────────────────────────

/** Champs suivis par le journal d'une action (création : valeurs posées ; modification : champs changés). */
export const ACTION_FIELD_LABELS = {
  pilotId: 'Responsable', priority: 'Priorité', dueOn: 'Date cible', source: 'Source', originRef: "Référence d'origine", domain: 'Domaine',
  problem: 'Description du problème', detail: "Détail de l'action", verifyDueOn: 'Vérification planifiée', riskLevel: 'Niveau de risque',
  estimatedCost: 'Coût estimé', actualCost: 'Coût réel', siteId: 'Site', doneOn: 'Date effective', verifyMethod: 'Nature de la vérification',
  efficacyNote: 'Constat de vérification', hours: 'Pointage',
} as const;
export type ActionField = keyof typeof ACTION_FIELD_LABELS;
/** Textes longs : journalisés sans leur contenu (l'historique part au navigateur ; pattern de src/server/events.ts). */
const LONG_FIELDS: readonly ActionField[] = ['problem', 'detail', 'efficacyNote'];

/** Noms affichés des personnes et des sites, pour le journal. */
export type NameBook = { person: (id: string | null | undefined) => string | null; site: (id: string | null | undefined) => string | null };
export async function nameBook(db: DbOrTx): Promise<NameBook> {
  const [people, sites] = await Promise.all([
    db.select({ id: t.people.id, name: t.people.name }).from(t.people),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
  ]);
  const p = new Map(people.map((x) => [x.id, x.name]));
  const s = new Map(sites.map((x) => [x.id, x.label.split(' — ')[0]]));
  return { person: (id) => (id ? p.get(id) ?? id : null), site: (id) => (id ? s.get(id) ?? id : null) };
}

/** Valeur affichée d'un champ (journal). */
export function fmtActionField(k: ActionField, v: unknown, names: NameBook): string | null {
  if (v == null || v === '') return null;
  switch (k) {
    case 'pilotId': return names.person(String(v));
    case 'siteId': return names.site(String(v));
    case 'priority': return ACTION_PRIORITIES[v as ActionPriority]?.label ?? String(v);
    case 'domain': return ACTION_DOMAINS[v as ActionDomain] ?? String(v);
    case 'source': return ACTION_SOURCES[v as SourceKey]?.label ?? String(v);
    case 'verifyMethod': return VERIFY_METHODS[v as VerifyMethod] ?? String(v);
    case 'riskLevel': return ACTION_RISK_LEVELS[Number(v)] ?? String(v);
    case 'dueOn': case 'verifyDueOn': case 'doneOn': return fmtDate(String(v));
    case 'estimatedCost': case 'actualCost': return `${fmtDecimal(Number(v))} €`;
    case 'hours': return `${fmtDecimal(Number(v))} h`;
    default: return String(v);
  }
}

/** Détail du journal entre deux états (création : `before` vide) ; textes longs sans leur contenu. */
export function actionFieldDetails(before: Partial<Record<ActionField, unknown>>, after: Partial<Record<ActionField, unknown>>, names: NameBook): ChangeDetail[] {
  return (Object.keys(ACTION_FIELD_LABELS) as ActionField[]).flatMap((k) => {
    if (!(k in after)) return [];
    const field = ACTION_FIELD_LABELS[k];
    if (LONG_FIELDS.includes(k)) {
      const b = String(before[k] ?? ''), a = String(after[k] ?? '');
      if (b === a) return [];
      return [{ field, from: b ? '(texte précédent)' : null, to: a ? (b ? '(texte modifié)' : '(texte saisi)') : null }];
    }
    const from = fmtActionField(k, before[k], names), to = fmtActionField(k, after[k], names);
    return from === to ? [] : [{ field, from, to }];
  });
}

// ─── Création ───────────────────────────────────────────────────────────────

/**
 * Crée une action dans la transaction `tx` : numéro « A-n » (nextActionNumber, compteur sous verrou), date d'ouverture =
 * `ctx.today`, date cible initiale = date cible, avancement « À faire » ; journal « Action créée » avec le détail de chaque
 * champ posé ; liens `input.links` posés dans l'ordre (applyActionLink, puis applyCreationLink : document d'une version) —
 * un lien refusé lève ActionLinkError (`strictLinks`) ou est sauté (actions de suite : `skippedLinks`) ; entrée « Action
 * A-n créée et rattachée » au journal des sources qui en ont un (logAs) ; notification « Action confiée » au responsable
 * (ACT-30, dans la cloche seulement), sauf `notify: false` ou responsable = auteur.
 */
export async function createActionRecord(tx: DbOrTx, input: NewActionInput, ctx: { byId: string; byName: string; today: string; notify?: boolean; summary?: string }): Promise<{ id: string; skippedLinks: string[]; links: string[] }> {
  const id = await nextActionNumber(tx);
  const values = {
    source: input.source, originRef: input.originRef, pilotId: input.pilotId, priority: input.priority, dueOn: input.dueOn, domain: input.domain,
    problem: input.problem, detail: input.detail, verifyDueOn: input.verifyDueOn, riskLevel: input.riskLevel,
    estimatedCost: input.estimatedCost ?? null, actualCost: input.actualCost ?? null, siteId: input.siteId,
  };
  await tx.insert(t.actions).values({
    id, ...values, openedOn: ctx.today, initialDueOn: input.dueOn, status: 'a_faire',
    followsActionId: input.followsActionId ?? null, followReason: input.followReason ?? null,
  });
  const skippedLinks: string[] = [];
  const links: string[] = [];
  for (const link of input.links ?? []) {
    const error = await applyActionLink(tx, link, id);
    if (error) {
      if (input.strictLinks) throw new ActionLinkError(error, link);
      skippedLinks.push(link);
      continue;
    }
    await applyCreationLink(tx, link, id);
    links.push(link);
  }
  // Journal de l'action d'abord (champs posés, dont la référence d'origine : le libellé des éléments liés n'y est pas
  // recopié, l'historique part au navigateur et la fiche réduit les sources de certains lecteurs, flux C), puis celui des
  // sources qui en ont un (logAs). Liens posés avant le journal : une création stricte refusée n'écrit rien.
  const names = await nameBook(tx);
  // VG-02 : recommandation d'une étude de sécurité des procédés marquée réserve bloquante (`safetystudy:<étude>:bloquante`).
  const blocking = links.some((l) => l.startsWith('safetystudy:') && l.endsWith(`:${STUDY_BLOCKING_ARG}`));
  await logChange(tx, {
    entityType: 'action', entityId: id, action: 'create', byId: ctx.byId,
    summary: ctx.summary ?? 'Action créée',
    details: [...actionFieldDetails({}, values, names), ...(blocking ? [{ field: 'Réserve bloquante', from: null, to: 'oui' }] : [])],
  });
  for (const link of links) {
    const source = linkLogEntity(link);
    const reserve = link.startsWith('safetystudy:') && link.endsWith(`:${STUDY_BLOCKING_ARG}`) ? ' (réserve bloquante)' : '';
    if (source) await logChange(tx, { ...source, action: 'link', summary: `Action ${id} créée et rattachée${reserve}`, byId: ctx.byId });
  }
  if (ctx.notify !== false) {
    await notify(tx, {
      personId: input.pilotId, type: 'action_confiee', entityType: 'action', entityId: id, byId: ctx.byId,
      title: actionConfieeTitle(id, ctx.byName, actionLabel(input.detail)), href: actionHref(id),
    });
  }
  return { id, skippedLinks, links };
}

/** Notification « Action confiée » au nouveau responsable d'une action réattribuée (§ 22.15, D6). */
export async function notifyReassigned(tx: DbOrTx, a: Pick<ActionRow, 'id' | 'detail'>, pilotId: string, by: { id: string; name: string }) {
  await notify(tx, {
    personId: pilotId, type: 'action_confiee', entityType: 'action', entityId: a.id, byId: by.id,
    title: actionConfieeTitle(a.id, by.name, actionLabel(a.detail)), href: actionHref(a.id),
  });
}

// ─── Lecture des champs d'une nouvelle action ───────────────────────────────

/** Bornes des montants (ACT-26) : heures 99 999,99 h, coûts 9 999 999 999,99 €. */
export const HOURS_MAX = 99_999.99;
export const COST_MAX = 9_999_999_999.99;

/**
 * Champs communs d'une nouvelle action lus du formulaire (`prefix` : '' pour le formulaire du plan, 'ne_' / 'nr_' pour
 * les sections « Nouvelle action » de la vérification) : problème, détail (4 000 caractères), responsable, priorité,
 * domaine, dates cible et de vérification, niveau de risque, site (jamais « Tous les sites »).
 */
export function readNewActionFields(f: ReturnType<typeof formReader>, prefix = '', opts: { problemRequired?: boolean } = {}) {
  const n = (name: string) => `${prefix}${name}`;
  const siteId = f.str(n('siteId'), { required: true });
  if (siteId === 'all') f.fail(n('siteId'), 'Choisissez un site : une action porte un seul site.');
  return {
    problem: f.str(n('problem'), { required: opts.problemRequired ?? true, max: ACTION_TEXT_MAX }),
    detail: f.str(n('detail'), { required: true, max: ACTION_TEXT_MAX }),
    pilotId: f.str(n('pilotId'), { required: true }),
    priority: f.oneOf(n('priority'), PRIORITY_KEYS, { required: true }),
    domain: f.oneOf(n('domain'), DOMAIN_KEYS, { required: true }),
    dueOn: f.date(n('dueOn'), { required: true }),
    verifyDueOn: f.date(n('verifyDueOn'), { required: true }),
    riskLevel: f.int(n('riskLevel'), { min: 0, max: 4 }),
    siteId,
  };
}

/** Responsable choisi : personne connue et présente à l'effectif (date du jour) ; message d'erreur sinon. */
export async function pilotProblem(db: DbOrTx, pilotId: string, now: string): Promise<string | null> {
  const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, pilotId));
  if (!p) return 'Personne inconnue.';
  if (hasLeft(p, now)) return "Personne sortie de l'effectif : choisissez un responsable présent.";
  return null;
}

/** Site d'une nouvelle action (ou d'un transfert) : site actif du périmètre (requireInSite { create: true }), jamais « Tous les sites ». */
export async function newSiteProblem(siteId: string): Promise<string | null> {
  if (!siteId || siteId === 'all') return 'Choisissez un site : une action porte un seul site.';
  return requireInSite(siteId, { create: true });
}

// ─── Commentaires et preuves ────────────────────────────────────────────────

/** Contrôle d'écriture du responsable (ses actions, tous sites, D19) ou du QHSE (site sélectionné) ; message ou null. */
export async function ownOrInSite(a: Pick<ActionRow, 'siteId'>, responsible: boolean): Promise<string | null> {
  return responsible ? null : requireInSite(a.siteId);
}

/** Contrôle des fichiers d'un envoi (nombre, volume, contenu, limites de la personne : checkUploadBatch) ; message ou null. */
export const filesProblem = (files: File[], by: string): Promise<string | null> => checkUploadBatch(files, by);
