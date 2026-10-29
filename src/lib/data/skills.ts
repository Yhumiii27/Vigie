import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { lapseFor, missingPrerequisites, period, type Lapse } from '@/components/skills/rules';
import { toAttachmentItem, type AttachmentItem } from '../attachments';
import { addDays, fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import { TODO_HORIZON_DAYS, TRAINING_EFFECTIVENESS, isClosedActionStatus, isEmployee, type SkillState, type TodoItem, type Tone, type TrainingEffectiveness } from '../domain';
import { hasLeft } from '../people';
import { canReadAction } from '../action-rules';
import { actionView, lcfirst, loadPeople, skillState, type Person } from '../queries';
import { loadQhseLeads } from './leads';
import { getSession, siteFilter, type SiteScope } from '../session';

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

/** Formation enregistrée (historique d'une case : jamais écrasée ; annulée avec un motif si saisie par erreur). */
export type QualificationEntry = {
  id: number;
  obtainedOn: string;
  expiresOn: string | null;
  provider: string | null;
  /** Catégories ou niveaux obtenus (HAB-10). */
  scope: string | null;
  /** Instant de saisie (ISO). */
  recordedAt: string;
  recordedBy: string;
  cancelled: { at: string; by: string; reason: string } | null;
  /** Attestations jointes. */
  files: AttachmentItem[];
  /** HAB-13 : évaluation à froid de l'efficacité (null : non évaluée). */
  effectiveness: { key: TrainingEffectiveness; label: string; tone: Tone; on: string; note: string | null; by: string } | null;
};

export type SkillCell = {
  title: TrainingTitle;
  state: SkillState;
  expiresOn: string | null;
  required: boolean;
  /** Formation en cours (dernière non annulée) : obtention, échéance et organisme ci-dessous en sont tirés. */
  qualificationId: number | null;
  obtainedOn: string | null;
  provider: string | null;
  /** Catégories ou niveaux de la formation en cours (HAB-10). */
  scope: string | null;
  /** Prérequis non satisfaits (HAB-10, libellés : aucun n'est valide) : état « p » quand le titre est par ailleurs valide. */
  missingPrerequisites: string[];
  /** Attestations de la formation en cours. */
  files: AttachmentItem[];
  /** Toutes les formations de la case, annulées comprises, de la plus récente à la plus ancienne. */
  history: QualificationEntry[];
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
 * Formations conservées hors matrice, en consultation seule : salarié sorti (tous titres) ou titre archivé (tous salariés du site).
 * Une entrée par salarié et par titre ayant au moins une formation enregistrée, annulées comprises.
 */
export type ArchivedRecord = { person: Person; title: TrainingTitle; entries: QualificationEntry[] };

/** Le salarié est sorti de l'effectif à la date `now` (archivé : plus dans la matrice, les signaux ni les listes). */
export { hasLeft };

/**
 * Matrice du site sélectionné (scope 'site') ou de tout le périmètre (scope 'perimeter' : échéances, TDB-05), sans filtre
 * de rôle (signaux, revue de direction) : titres actifs en colonnes, salariés présents en lignes, historique des
 * formations et attestations par case.
 */
export const loadSkillData = cache(async (scope: SiteScope = 'site') => {
  const db = await getDb();
  const now = today();
  const [people, allTitles, reqs, quals, assignments, keep, session] = await Promise.all([
    loadPeople(),
    db.select().from(t.trainingTitles).orderBy(asc(t.trainingTitles.sort)),
    db.select().from(t.qualificationRequirements),
    db.select().from(t.qualifications).orderBy(desc(t.qualifications.obtainedOn), desc(t.qualifications.id)),
    db.select().from(t.keystoneAssignments).orderBy(asc(t.keystoneAssignments.startOn)),
    siteFilter(scope),
    getSession(),
  ]);
  // Titres archivés : hors matrice, formulaires et échéances ; listés dans « Titres suivis » (restauration).
  const titles = allTitles.filter((ti) => !ti.archivedAt);
  const archivedTitles = allTitles.filter((ti) => ti.archivedAt);

  const qualIds = quals.map((q) => String(q.id));
  const [renewalActions, files] = await Promise.all([
    db.select().from(t.actions).where(and(isNotNull(t.actions.qualificationPersonId), isNotNull(t.actions.qualificationTitleId)))
      .orderBy(desc(t.actions.openedOn), desc(t.actions.id)),
    qualIds.length
      ? db.select().from(t.attachments).where(and(eq(t.attachments.entityType, 'qualification'), inArray(t.attachments.entityId, qualIds))).orderBy(asc(t.attachments.createdAt))
      : [],
  ]);
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

  const name = (id: string | null) => (id ? people.get(id)?.name ?? '—' : '—');
  const filesOf = new Map<string, AttachmentItem[]>();
  files.forEach((f) => {
    const list = filesOf.get(f.entityId) ?? [];
    list.push(toAttachmentItem(f, f.uploadedBy ? people.get(f.uploadedBy)?.name : undefined));
    filesOf.set(f.entityId, list);
  });

  const req = new Map(reqs.map((r) => [`${r.personId}:${r.titleId}`, r]));
  // Historique des formations par case, du plus récent au plus ancien (obtainedOn desc, puis id desc).
  const history = new Map<string, QualificationEntry[]>();
  quals.forEach((q) => {
    const key = `${q.personId}:${q.titleId}`;
    const list = history.get(key) ?? [];
    list.push({
      id: q.id, obtainedOn: q.obtainedOn, expiresOn: q.expiresOn, provider: q.provider, scope: q.scope,
      recordedAt: q.recordedAt.toISOString(), recordedBy: name(q.recordedById),
      cancelled: q.cancelledAt ? { at: q.cancelledAt.toISOString(), by: name(q.cancelledById), reason: q.cancelReason ?? '' } : null,
      files: filesOf.get(String(q.id)) ?? [],
      effectiveness: q.effectiveness && q.effectivenessOn && q.effectiveness in TRAINING_EFFECTIVENESS
        ? { key: q.effectiveness as TrainingEffectiveness, ...TRAINING_EFFECTIVENESS[q.effectiveness as TrainingEffectiveness], on: q.effectivenessOn, note: q.effectivenessNote, by: name(q.effectivenessById) }
        : null,
    });
    history.set(key, list);
  });

  const visible = [...people.values()].filter((p) => keep(p.siteId));
  // Sortis de l'effectif : archivés, hors matrice et signaux (filtre « Sortis » de l'encadrement).
  const active = visible.filter((p) => !hasLeft(p, now));
  const departed = visible.filter((p) => hasLeft(p, now)).sort((a, b) => b.leftOn!.localeCompare(a.leftOn!));

  const activeTitleIds = new Set(titles.map((ti) => ti.id));
  const titleLabel = new Map(allTitles.map((ti) => [ti.id, ti.label]));
  const rows: SkillRow[] = active.filter((p) => p.inSkillsMatrix).map((p) => {
    const upcoming = assignments.filter((a) => a.personId === p.id && a.endOn >= now);
    // Formation en cours de chaque titre de la personne (dernière non annulée), requis ou non : base des prérequis (HAB-10).
    const held = new Map(titles.map((ti) => [ti.id, (history.get(`${p.id}:${ti.id}`) ?? []).find((e) => !e.cancelled)]));
    return {
      person: p,
      assignments: upcoming,
      leavingOn: p.leftOn,
      cells: titles.map((ti) => {
        const key = `${p.id}:${ti.id}`;
        const r = req.get(key);
        const entries = history.get(key) ?? [];
        // La qualification en cours est la dernière formation non annulée.
        const q = entries.find((e) => !e.cancelled);
        const base = skillState(!!r, q?.expiresOn, !!q, now);
        // Titre valide (ou expirant) dont un prérequis n'est pas valide : inopérant (HAB-10, R. 4323-56).
        const gaps = q ? missingPrerequisites(ti.prerequisiteIds ?? [], held, activeTitleIds, now) : [];
        const state: SkillState = (base === 'v' || base === 's') && gaps.length ? 'p' : base;
        const expiresOn = q?.expiresOn ?? null;
        return {
          title: ti,
          state,
          expiresOn,
          required: !!r,
          qualificationId: q?.id ?? null,
          obtainedOn: q?.obtainedOn ?? null,
          provider: q?.provider ?? null,
          scope: q?.scope ?? null,
          missingPrerequisites: gaps.map((id) => titleLabel.get(id) ?? id),
          files: q?.files ?? [],
          history: entries,
          // Recyclage ouvert : seulement tant que le titre est requis (comme avant HAB-04) ; les recyclages clos restent listés.
          renewal: r ? renewals.get(key)?.open ?? null : null,
          pastRenewals: renewals.get(key)?.past ?? [],
        };
      }),
    };
  });

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

  // Historique conservé des salariés sortis et des titres archivés (filtre « Sortis », titres archivés).
  const archive: ArchivedRecord[] = visible.flatMap((p) => allTitles.flatMap((ti) => {
    if (!hasLeft(p, now) && !ti.archivedAt) return [];
    const entries = history.get(`${p.id}:${ti.id}`) ?? [];
    return entries.length ? [{ person: p, title: ti, entries }] : [];
  }));

  return { titles, archivedTitles, rows, alerts, lapses, others, departed, archive };
});

/**
 * Matrice telle que la session la voit : le rôle Salarié ne voit que sa propre ligne, ses échéances et ses
 * affectations (données personnelles, Cursus propriétaire) ; ni le personnel non suivi, ni les sortis. Sa ligne ne dépend
 * pas du site sélectionné (HAB-14) : elle est prise sur tout son périmètre, puis réduite à lui.
 */
export const loadSkillMatrix = cache(async () => {
  const session = await getSession();
  if (!isEmployee(session.role)) return { ...(await loadSkillData()), self: false };
  const data = await loadSkillData('perimeter');
  const mine = <T extends { person: Person }>(list: T[]) => list.filter((x) => x.person.id === session.user.id);
  return { ...data, rows: mine(data.rows), alerts: mine(data.alerts), lapses: mine(data.lapses), archive: mine(data.archive), others: [], departed: [], self: true };
});


// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances habilitation, une au plus par case requise (titre requis, salarié présent, titre actif) :
 * - expiré ou jamais suivi : danger, daté du jour ;
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
  skills.rows.forEach((row) => {
    const p = row.person;
    const lead = leads.forSite(p.siteId);
    const who = [p.name, lead.who].filter(Boolean).join(' · ');
    row.cells.forEach((c) => {
      if (c.state === 'n' || c.renewal?.planned) return;
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
        // HAB-10 : titre inopérant tant qu'un prérequis (CACES…) n'est pas valide.
        todo.push({ ...base, date: now, tone: 'danger', overdue: true, title: `${name} : aucun prérequis valide (${c.missingPrerequisites.join(' ou ')})${suffix}` });
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
