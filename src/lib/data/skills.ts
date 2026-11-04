import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { heldTitleState, lapseFor, period, type Lapse } from '@/lib/rules/skills';
import { toAttachmentItem, type AttachmentItem } from '../attachments';
import { addDays, fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import { TODO_HORIZON_DAYS, isClosedActionStatus, isEmployee, type SkillState, type TodoItem, type Tone } from '../domain';
import { hasLeft } from '../people';
import { canReadAction } from '../action-rules';
import { actionView, lcfirst, loadPeople, type Person } from '../queries';
import { caseKey, loadHeldTitles } from './held-titles';
import { loadCursusTitles } from '../foreign/cursus';
import { unavailableMessage } from '../foreign/labels';
import type { Option } from './options';
import { loadQhseLeads } from './leads';
import { getSession, siteFilter, type SiteScope } from '../session';
import { entityVersions } from '@/server/versions';

// ─── Habilitations ──────────────────────────────────────────────────────────

export type TrainingTitle = typeof t.trainingTitles.$inferSelect;
export type KeystoneAssignment = typeof t.keystoneAssignments.$inferSelect;

/**
 * Action de recyclage reprise, portée par l'action (actions.qualification_person_id / qualification_title_id, HAB-04) :
 * `renewal` tant qu'elle n'est pas close (Vérifiée ou Abandonnée), puis dans `pastRenewals`. Consultation seule : depuis les réponses du service QHSE du 15/10/2026, aucun
 * recyclage ni formation ne donne lieu à une action QSE (le service RH les gère) ; seules les actions d'une base reprise
 * restent rattachées, et le service QHSE les clôt ou les abandonne dans le plan d'actions.
 */
export type RenewalInfo = {
  id: string;
  /** Libellé court de l'action (actionLabel du détail). */
  label: string;
  dueOn: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  pilot: string;
  /** Ni close ni Terminée (À faire → 80 %, Reportée, y compris en retard) : le recyclage est encore à réaliser. */
  planned: boolean;
  /**
   * Action lisible par la session (canReadAction : plan de son périmètre, ou sa propre action). Sinon numéro seul :
   * ni libellé, ni avancement, ni date cible, ni responsable, et pas de lien vers une fiche qui serait refusée (par
   * exemple le Salarié pour l'action de recyclage reprise d'un autre responsable ; décision de l'Integration, 15/10/2026).
   */
  readable: boolean;
};

export type SkillCell = {
  title: TrainingTitle;
  state: SkillState;
  /** Dernier jour où le titre est utilisable (échéance bornée par Cursus) ; échéance du titre s'il est suspendu. */
  expiresOn: string | null;
  required: boolean;
  /** Titre détenu d'après Cursus (cursus.pub_titres_detenus, jointure par matricule) : référence Cursus, sinon null. */
  cursusRef: string | null;
  obtainedOn: string | null;
  /** Échéance du titre publiée par Cursus (expire_le) ; null : sans échéance. */
  titleExpiresOn: string | null;
  /** Organisme de formation, ou signataire de la délivrance d'une habilitation. */
  provider: string | null;
  /** Prochaine session prévue dans Cursus (recyclage planifié par le service RH). */
  sessionOn: string | null;
  /** Prérequis manquant d'après Cursus (état « suspendu »). */
  prerequisiteMissing: boolean;
  /** Suspension ou retrait de l'habilitation dans Cursus (motif non publié). */
  measure: { kind: 'suspension' | 'retrait'; on: string | null } | null;
  /** Attestations jointes dans Vigie avant la bascule vers Cursus (migration 0025), en consultation seule. */
  files: AttachmentItem[];
  /** Action de recyclage reprise encore ouverte (consultation seule, voir RenewalInfo). */
  renewal: RenewalInfo | null;
  /** Actions de recyclage reprises closes (Vérifiées ou Abandonnées) de la case, la plus récente d'abord (HAB-04). */
  pastRenewals: RenewalInfo[];
};

export type SkillRow = {
  person: Person; cells: SkillCell[]; assignments: KeystoneAssignment[];
  /** Sortie de l'effectif déjà déclarée, à une date future (« Sortie le … »). */
  leavingOn: string | null;
};

export type SkillAlert = {
  person: Person;
  title: string;
  titleId: string;
  /**
   * État du titre pendant l'affectation : x (expiré, ou expirant avant la fin de l'affectation) ou r (jamais suivi).
   * Dans `alerts`, identique à l'état actuel (x ou r) ; dans `lapses`, un titre encore valide peut valoir x (voir `lapse`).
   */
  state: SkillState;
  /** État du titre aujourd'hui (matrice). */
  currentState: SkillState;
  lapse: Lapse;
  expiresOn: string | null;
  assignment: KeystoneAssignment;
  renewal: RenewalInfo | null;
  /** Titres requis du salarié (pour la fenêtre « Voir l'affectation »). */
  required: SkillCell[];
};

/**
 * Titres conservés hors matrice, en consultation seule : salarié sorti (tous titres) ou titre qui n'est plus suivi (tous
 * salariés du site). Une entrée par salarié et par titre détenu d'après Cursus ou portant des attestations reprises.
 */
export type ArchivedRecord = { person: Person; title: TrainingTitle; obtainedOn: string | null; expiresOn: string | null; provider: string | null; files: AttachmentItem[] };

/** Le salarié est sorti de l'effectif à la date `now` (archivé : plus dans la matrice, les signaux ni les listes). */
export { hasLeft };

/**
 * Matrice du site sélectionné (scope 'site') ou de tout le périmètre (scope 'perimeter' : échéances, TDB-05), sans filtre
 * de rôle (signaux, revue de direction) : titres suivis en colonnes, salariés présents en lignes ; état de chaque case
 * d'après les titres détenus publiés par Cursus (D09, `heldTitleState`). Cursus indisponible (`source.ok` faux) : cases
 * requises d'état « u » (donnée indisponible), aucune alerte ni échéance calculée (bandeau de l'écran).
 */
export const loadSkillData = cache(async (scope: SiteScope = 'site') => {
  const db = await getDb();
  const now = today();
  const [people, allTitles, reqs, held, assignments, keep, session, files] = await Promise.all([
    loadPeople(),
    db.select().from(t.trainingTitles).orderBy(asc(t.trainingTitles.sort)),
    db.select().from(t.qualificationRequirements),
    loadHeldTitles(),
    db.select().from(t.keystoneAssignments).orderBy(asc(t.keystoneAssignments.startOn)),
    siteFilter(scope),
    getSession(),
    // Attestations jointes avant la bascule vers Cursus (migration 0025 : rattachées à la case « personne|titre »).
    db.select().from(t.attachments).where(eq(t.attachments.entityType, 'qualification')).orderBy(asc(t.attachments.createdAt)),
  ]);
  const source = { ok: held.ok, message: held.message };
  // Titres qui ne sont plus suivis : hors matrice et échéances ; listés dans « Titres suivis » (suivre à nouveau).
  const titles = allTitles.filter((ti) => !ti.archivedAt);
  const archivedTitles = allTitles.filter((ti) => ti.archivedAt);

  const renewalActions = await db.select().from(t.actions).where(and(isNotNull(t.actions.qualificationPersonId), isNotNull(t.actions.qualificationTitleId)))
    .orderBy(desc(t.actions.openedOn), desc(t.actions.id));
  // Actions de recyclage reprises par case (« personne:titre »), la plus récente d'abord : ouverte et closes (HAB-04).
  const renewals = new Map<string, { open: RenewalInfo | null; past: RenewalInfo[] }>();
  renewalActions.forEach((a) => {
    const key = `${a.qualificationPersonId}:${a.qualificationTitleId}`;
    const slot = renewals.get(key) ?? { open: null, past: [] };
    renewals.set(key, slot);
    const closed = isClosedActionStatus(a.status);
    const planned = !closed && a.status !== 'terminee';
    let info: RenewalInfo;
    if (!canReadAction(session.role, session.user.id, a, session.allowedSiteIds)) {
      info = { id: a.id, label: '', dueOn: '', status: '', statusLabel: 'Action QSE reprise', tone: 'neutral', pilot: '', planned, readable: false };
    } else {
      const v = actionView(a, people, now);
      info = { id: a.id, label: v.label, dueOn: a.dueOn, status: a.status, statusLabel: v.statusLabel, tone: v.tone, pilot: v.pilot, planned, readable: true };
    }
    if (closed) slot.past.push(info);
    else slot.open ??= info;
  });

  const filesOf = new Map<string, AttachmentItem[]>();
  files.forEach((f) => {
    const list = filesOf.get(f.entityId) ?? [];
    list.push(toAttachmentItem(f, f.uploadedBy ? people.get(f.uploadedBy)?.name : undefined));
    filesOf.set(f.entityId, list);
  });

  const req = new Map(reqs.map((r) => [caseKey(r.personId, r.titleId), r]));
  const visible = [...people.values()].filter((p) => keep(p.siteId));
  // Sortis de l'effectif : archivés, hors matrice et signaux (filtre « Sortis » de l'encadrement).
  const active = visible.filter((p) => !hasLeft(p, now));
  const departed = visible.filter((p) => hasLeft(p, now)).sort((a, b) => b.leftOn!.localeCompare(a.leftOn!));

  const rows: SkillRow[] = active.filter((p) => p.inSkillsMatrix).map((p) => ({
    person: p,
    assignments: assignments.filter((a) => a.personId === p.id && a.endOn >= now),
    leavingOn: p.leftOn,
    cells: titles.map((ti): SkillCell => {
      const key = caseKey(p.id, ti.id);
      const r = req.get(key);
      const h = held.byCase.get(key);
      const { state, expiresOn } = held.ok ? heldTitleState(!!r, h, now) : { state: r ? 'u' as const : 'n' as const, expiresOn: null };
      return {
        title: ti,
        state,
        expiresOn,
        required: !!r,
        cursusRef: h?.ref ?? null,
        obtainedOn: h?.obtainedOn ?? null,
        titleExpiresOn: h?.expiresOn ?? null,
        provider: h ? h.provider ?? h.issuedBy : null,
        sessionOn: h?.sessionOn ?? null,
        prerequisiteMissing: !!h?.prerequisiteMissing,
        measure: h?.measure ? { kind: h.measure, on: h.measureOn } : null,
        files: filesOf.get(key) ?? [],
        // Recyclage ouvert : seulement tant que le titre est requis (comme avant HAB-04) ; les recyclages clos restent listés.
        renewal: r ? renewals.get(`${p.id}:${ti.id}`)?.open ?? null : null,
        pastRenewals: renewals.get(`${p.id}:${ti.id}`)?.past ?? [],
      };
    }),
  }));

  // Salarié affecté à une activité Keystone à venir alors qu'un titre requis manque, est expiré
  // ou expire avant la fin de l'affectation : un bandeau par affectation et par titre (écran Habilitations).
  const lapses: SkillAlert[] = rows
    .flatMap((row) => row.assignments.flatMap((a) => row.cells.flatMap((c): SkillAlert[] => {
      const lapse = lapseFor(c.state, c.expiresOn, a, now);
      if (!lapse) return [];
      return [{
        person: row.person, title: c.title.label, titleId: c.title.id, state: lapse === 'missing' ? 'r' : 'x', currentState: c.state, lapse,
        expiresOn: c.expiresOn, assignment: a, renewal: c.renewal, required: row.cells.filter((x) => x.required),
      }];
    })))
    .sort((x, y) => x.assignment.startOn.localeCompare(y.assignment.startOn));

  // Sens historique, lu par le tableau de bord et la revue de direction : titre requis
  // jamais suivi ou déjà expiré aujourd'hui (state = état actuel, r ou x) et affectation Keystone à venir.
  const alerts = lapses.filter((al) => al.lapse === 'missing' || al.lapse === 'expired');

  // Personnel du site non suivi dans la matrice (encadrement, fonctions support).
  const others = active.filter((p) => !p.inSkillsMatrix);

  // Titres conservés des salariés sortis et des titres qui ne sont plus suivis (filtre « Sortis », « Titres suivis »).
  const archive: ArchivedRecord[] = visible.flatMap((p) => allTitles.flatMap((ti) => {
    if (!hasLeft(p, now) && !ti.archivedAt) return [];
    const key = caseKey(p.id, ti.id);
    const h = held.byCase.get(key);
    const f = filesOf.get(key) ?? [];
    return h || f.length ? [{ person: p, title: ti, obtainedOn: h?.obtainedOn ?? null, expiresOn: h?.expiresOn ?? null, provider: h ? h.provider ?? h.issuedBy : null, files: f }] : [];
  }));

  return { titles, archivedTitles, rows, alerts, lapses, others, departed, archive, source };
});

/**
 * Matrice telle que la session la voit : le rôle Salarié ne voit que sa propre ligne, ses échéances et ses
 * affectations (données personnelles, Cursus propriétaire) ; ni le personnel non suivi, ni les sortis. Sa ligne ne dépend
 * pas du site sélectionné (HAB-14) : elle est prise sur tout son périmètre, puis réduite à lui.
 */
export const loadSkillMatrix = cache(async () => {
  const session = await getSession();
  if (!isEmployee(session.role)) {
    const data = await loadSkillData();
    return { ...data, versions: await skillVersions(data), self: false };
  }
  const data = await loadSkillData('perimeter');
  const mine = <T extends { person: Person }>(list: T[]) => list.filter((x) => x.person.id === session.user.id);
  return { ...data, rows: mine(data.rows), alerts: mine(data.alerts), lapses: mine(data.lapses), archive: mine(data.archive), others: [], departed: [], versions: NO_VERSIONS, self: true };
});

/**
 * Choix « Suivre un titre » (D08) : titres du catalogue de Cursus que Vigie ne suit pas encore (titres qui ne sont plus
 * suivis exclus : « Suivre à nouveau »), par intitulé ; catalogue indisponible : aucun choix et le message de la source.
 */
export async function loadTitleChoices(): Promise<{ choices: Option[]; message: string | null }> {
  const db = await getDb();
  const [catalog, followed] = await Promise.all([loadCursusTitles(), db.select({ id: t.trainingTitles.id }).from(t.trainingTitles)]);
  if (!catalog.ok) return { choices: [], message: unavailableMessage('titles') };
  const taken = new Set(followed.map((x) => x.id));
  return {
    choices: catalog.rows.filter((x) => !taken.has(x.id)).sort((a, b) => a.label.localeCompare(b.label, 'fr'))
      .map((x) => [x.id, `${x.label} (${x.id}${x.validityMonths ? `, ${x.validityMonths} mois` : ', sans échéance'})`] as Option),
    message: null,
  };
}

/** Versions des fiches à leur ouverture (QUA-12) : salarié, titre suivi. */
export type SkillVersions = { person: Record<string, string>; title: Record<string, string> };
const NO_VERSIONS: SkillVersions = { person: {}, title: {} };

async function skillVersions(data: Awaited<ReturnType<typeof loadSkillData>>): Promise<SkillVersions> {
  const db = await getDb();
  const people = [...data.rows.map((r) => r.person.id), ...data.others.map((p) => p.id)];
  const [person, title] = await Promise.all([
    entityVersions(db, 'person', people),
    entityVersions(db, 'training_title', data.titles.map((ti) => ti.id)),
  ]);
  return { person: Object.fromEntries(person), title: Object.fromEntries(title) };
}


// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances habilitation, une au plus par case requise (titre requis, salarié présent, titre actif) :
 * - expiré, jamais suivi ou suspendu dans Cursus : danger, daté du jour ;
 * - expirant sous 60 jours (état s) : à l'échéance du titre, ou à la veille d'une affectation qu'il ne couvre pas, sous 15 jours ;
 * - valide mais expirant avant la fin d'une affectation Keystone : à la veille de l'affectation, sous 15 jours.
 * Une action de recyclage reprise encore à réaliser (ni close ni Terminée, voir RenewalInfo) suffit : elle porte sa propre
 * échéance. Une action Terminée ne suffit pas (formation annulée depuis, par exemple) : le signal la mentionne. Aucune
 * nouvelle action de recyclage (hors actions QSE, réponses du service QHSE du 15/10/2026).
 * Destinataires : le responsable QHSE du site du salarié (animateurs QHSE si le poste est vacant) et le salarié concerné ; lien profond vers la case. Tous les sites du périmètre (TDB-05) : site du salarié.
 */
export const loadSkillSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const now = today();
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const [skills, session, leads] = await Promise.all([loadSkillData('perimeter'), getSession(), loadQhseLeads()]);
  const inWindow = (d: string | null): d is string => !!d && d >= now && d <= horizon;
  // Veille d'une affectation, au plus tôt aujourd'hui (affectation en cours ou débutant aujourd'hui).
  const eveOf = (startOn: string) => { const d = addDays(startOn, -1); return d < now ? now : d; };
  const todo: TodoItem[] = [];
  // Titres détenus de Cursus indisponibles : aucune échéance par case (jamais de fausse alerte « jamais suivi ») ; un seul
  // signal commun, au service QHSE, dit que les alertes d'habilitation ne sont pas calculées.
  if (!skills.source.ok) {
    const lead = leads.forSite(null);
    todo.push({
      kind: 'Habilitation', key: 'habilitations-cursus-indisponible', who: lead.who, href: '/habilitations', ownerIds: lead.ownerIds, siteId: null,
      date: now, tone: 'warn', title: 'Titres détenus de Cursus indisponibles : alertes et échéances d’habilitation non calculées',
    });
  }
  skills.rows.forEach((row) => {
    const p = row.person;
    const lead = leads.forSite(p.siteId);
    const who = [p.name, lead.who].filter(Boolean).join(' · ');
    row.cells.forEach((c) => {
      if (c.state === 'n' || c.state === 'u' || c.renewal?.planned) return;
      const ti = c.title;
      const base = { kind: 'Habilitation', who, href: `/habilitations?salarie=${p.id}&titre=${ti.id}`, ownerIds: [...new Set([...lead.ownerIds, p.id])], siteId: p.siteId };
      const name = `${p.name} · ${lcfirst(ti.label)}`;
      // Première affectation à venir que le titre ne couvre pas : l'échéance suit cette affectation, pas la première.
      const a = row.assignments.find((x) => lapseFor(c.state, c.expiresOn, x, now) !== null);
      const eve = a ? eveOf(a.startOn) : null;
      const project = a ? a.project.split(' · ')[0] : '';
      const action = c.renewal ? ` · action ${c.renewal.id}${c.renewal.readable ? ` (${lcfirst(c.renewal.statusLabel)})` : ''}` : '';
      const suffix = `${a ? `, affecté à ${project} ${period(a.startOn, a.endOn)}` : ''}${action}`;
      if (c.state === 'x') {
        todo.push({ ...base, date: now, dueOn: c.expiresOn!, tone: 'danger', overdue: true, title: `${name} expiré depuis le ${fmtDayMonth(c.expiresOn!)}${suffix}` });
      } else if (c.state === 'r') {
        todo.push({ ...base, date: now, tone: 'danger', overdue: true, title: `${name} jamais suivi${suffix}` });
      } else if (c.state === 'p') {
        // Titre inutilisable d'après Cursus : prérequis manquant (CACES d'une autorisation de conduite…), suspension ou retrait.
        const why = c.measure ? `${c.measure.kind === 'retrait' ? 'retiré' : 'suspendu'}${c.measure.on ? ` depuis le ${fmtDayMonth(c.measure.on)}` : ''}` : 'suspendu, prérequis manquant';
        todo.push({ ...base, date: now, tone: 'danger', overdue: true, title: `${name} ${why} (Cursus)${suffix}` });
      } else if (c.state === 's') {
        // Recyclage à la veille d'une affectation seulement si le titre ne la couvre pas ; sinon l'échéance du titre.
        const date = [c.expiresOn, eve].filter(inWindow).sort()[0];
        if (date) todo.push({ ...base, date, dueOn: c.expiresOn!, tone: 'warn', title: `${name} expire le ${fmtDayMonth(c.expiresOn!)}${suffix}` });
      } else if (a && inWindow(eve)) {
        todo.push({ ...base, date: eve, dueOn: c.expiresOn!, tone: 'warn', title: `${name} expire le ${fmtDayMonth(c.expiresOn!)}, avant la fin de l'affectation ${project}${action}` });
      }
    });
  });
  const badge = isEmployee(session.role) ? todo.filter((x) => x.ownerIds?.includes(session.user.id)).length : todo.length;
  return { badge, todo };
});
