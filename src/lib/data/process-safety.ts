import 'server-only';
import { cache } from 'react';
import { asc, isNotNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { actionLabel, canReadAction, isLate } from '../action-rules';
import { fmtDate, parisDay } from '../dates';
import { AVANCEMENT, canApprove, isAvancement, isClosedActionStatus, isEmployee, type Tone, type TodoItem } from '../domain';
import { hasLeft } from '../people';
import { loadPeople, loadSiteRows } from '../queries';
import {
  STUDY_CONCLUSIONS, STUDY_MILESTONES, STUDY_STATUS, STUDY_TYPES, recommendationCounts, studyClearsMilestone, studyHref, studyStatus,
  type RecommendationCounts, type StoredStudyStatus, type StudyConclusion, type StudyMilestone, type StudyStatus, type StudyType,
} from '../rules/process-safety';
import { getSession, siteFilter } from '../session';
import { loadQhseLeads } from './leads';
import { entityVersions } from '@/server/versions';

// Études de sécurité des procédés (VG-01 à VG-05) : vue « Études de sécurité des procédés » de l'écran « Évaluation des
// risques » (?vue=etudes, fiche ?etude=<référence>) — lecteurs de l'écran sauf le Salarié (vue masquée, lien profond :
// MissingNotice) ; saisie : animateur QHSE et direction. Recommandations = actions QSE rattachées (actions.safety_study_id),
// décrites seulement quand la personne peut lire l'action (canReadAction), sinon numéro seul. Décomptes, retard et
// franchissement du jalon calculés (src/lib/rules/process-safety.ts), jamais stockés.

export type RecommendationView = {
  id: string;
  /** Libellé, responsable, échéance et avancement : seulement si la personne peut lire l'action (canReadAction). */
  readable: boolean;
  label: string; pilot: string; dueOn: string; status: string; statusLabel: string; statusTone: Tone;
  late: boolean; closed: boolean; blocking: boolean;
};

export type StudyView = {
  id: string; siteId: string; siteLabel: string; capexCode: string | null; projectCode: string | null;
  milestone: StudyMilestone; milestoneLabel: string; type: StudyType; typeLabel: string;
  status: StudyStatus; statusLabel: string; statusTone: Tone; storedStatus: StoredStudyStatus;
  sessionOn: string; validatedOn: string | null; conclusion: StudyConclusion | null; conclusionLabel: string | null;
  facilitatorId: string | null; facilitatorExternal: string | null; facilitator: string; reportRef: string | null; scope: string;
  createdOn: string;
  counts: RecommendationCounts;
  /** Règle d'Arche : étude validée, non défavorable, sans réserve bloquante ouverte (jalon franchi). */
  clears: boolean;
  /** Séance passée d'une étude encore planifiée (échéance etude-securite). */
  sessionOverdue: boolean;
  recommendations: RecommendationView[];
  cancelled: { on: string; by: string; reason: string } | null;
};

const readStudies = cache(async () => {
  const db = await getDb();
  const [studies, actions, people, sites] = await Promise.all([
    db.select().from(t.processSafetyStudies).orderBy(asc(t.processSafetyStudies.sessionOn), asc(t.processSafetyStudies.id)),
    db.select({
      id: t.actions.id, studyId: t.actions.safetyStudyId, blocking: t.actions.safetyStudyBlocking, status: t.actions.status, dueOn: t.actions.dueOn,
      detail: t.actions.detail, pilotId: t.actions.pilotId, siteId: t.actions.siteId,
    }).from(t.actions).where(isNotNull(t.actions.safetyStudyId)).orderBy(asc(t.actions.openedOn), asc(t.actions.id)),
    loadPeople(),
    loadSiteRows(),
  ]);
  const now = today();
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  const rows = studies.map((s) => {
    const recs = actions.filter((a) => a.studyId === s.id);
    const counts = recommendationCounts(recs, now);
    const status = studyStatus({ status: s.status as StoredStudyStatus, cancelled: !!s.cancelledAt });
    const conclusion = (s.conclusion as StudyConclusion | null) ?? null;
    return {
      row: s, recs,
      view: {
        id: s.id, siteId: s.siteId, siteLabel: siteLabel.get(s.siteId) ?? s.siteId, capexCode: s.capexCode, projectCode: s.keystoneProjectCode,
        milestone: s.milestone as StudyMilestone, milestoneLabel: STUDY_MILESTONES[s.milestone as StudyMilestone]?.label ?? s.milestone,
        type: s.type as StudyType, typeLabel: STUDY_TYPES[s.type as StudyType]?.label ?? s.type,
        status, statusLabel: STUDY_STATUS[status].label, statusTone: STUDY_STATUS[status].tone, storedStatus: s.status as StoredStudyStatus,
        sessionOn: s.sessionOn, validatedOn: s.validatedOn, conclusion, conclusionLabel: conclusion ? STUDY_CONCLUSIONS[conclusion].label : null,
        facilitatorId: s.facilitatorId, facilitatorExternal: s.facilitatorExternal, facilitator: name(s.facilitatorId) || s.facilitatorExternal || '',
        reportRef: s.reportRef, scope: s.scope, createdOn: parisDay(s.createdAt), counts,
        clears: studyClearsMilestone({ status, conclusion }, counts.blocking),
        sessionOverdue: status === 'planifiee' && s.sessionOn < now,
        recommendations: [] as RecommendationView[],
        cancelled: s.cancelledAt ? { on: parisDay(s.cancelledAt), by: name(s.cancelledById), reason: s.cancelReason ?? '' } : null,
      } satisfies StudyView,
    };
  });
  return { now, rows, people };
});

/**
 * Études du site sélectionné (« Tous les sites » : périmètre), en cours puis annulées, avec leurs recommandations ;
 * `versions` : version de chaque fiche pour les formulaires (QUA-12). Salarié : rien (vue fermée).
 */
export async function loadProcessSafetyStudies() {
  const [session, { now, rows, people }, keep, db] = await Promise.all([getSession(), readStudies(), siteFilter('site'), getDb()]);
  if (isEmployee(session.role)) return { now, studies: [] as StudyView[], cancelled: [] as StudyView[], versions: {} as Record<string, string> };
  const views: StudyView[] = rows.filter((r) => keep(r.row.siteId)).map(({ view, recs }) => ({
    ...view,
    recommendations: recs.map((a) => {
      const readable = canReadAction(session.role, session.user.id, a, session.allowedSiteIds);
      const status = isAvancement(a.status) ? AVANCEMENT[a.status] : null;
      const late = isLate(a, now);
      return {
        id: a.id, readable, blocking: a.blocking, closed: isClosedActionStatus(a.status), late,
        label: readable ? actionLabel(a.detail) : '', pilot: readable ? people.get(a.pilotId)?.name ?? '' : '',
        dueOn: readable ? a.dueOn : '', status: readable ? a.status : '',
        statusLabel: readable ? (late ? 'En retard' : status?.label ?? a.status) : '', statusTone: readable ? (late ? 'danger' : status?.tone ?? 'neutral') : 'neutral',
      };
    }),
  }));
  const versions = Object.fromEntries(await entityVersions(db, 'process_safety_study', views.map((v) => v.id)));
  return { now, studies: views.filter((v) => !v.cancelled), cancelled: views.filter((v) => !!v.cancelled), versions };
}

/**
 * Échéance des études (VG-01), sur tout le périmètre (TDB-05) : séance passée d'une étude encore planifiée (l'étude tenue
 * est à enregistrer, ou la séance à replanifier). Destinataire : l'animateur s'il est de l'effectif et présent, sinon le
 * responsable QHSE du site. Saisie réservée au QHSE et à la direction : les autres rôles ne reçoivent que leurs propres
 * échéances (animateur), jamais le Salarié (vue fermée). Clé `etude-securite|<id>` (todoKey y ajoute la date).
 */
export const loadProcessSafetySignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const [session, { rows, now, people }, keep, leads] = await Promise.all([getSession(), readStudies(), siteFilter('perimeter'), loadQhseLeads()]);
  if (isEmployee(session.role)) return { todo: [] };
  const todo: TodoItem[] = rows
    .filter(({ view }) => view.sessionOverdue && keep(view.siteId))
    .map(({ view }) => {
      const p = view.facilitatorId ? people.get(view.facilitatorId) : undefined;
      const to = p && !hasLeft(p, now) ? { who: p.name, ownerIds: [p.id] } : leads.forSite(view.siteId);
      return {
        date: now, dueOn: view.sessionOn, kind: 'Étude de sécurité', tone: 'danger', overdue: true,
        title: `${view.id} · ${view.typeLabel} ${view.capexCode ?? view.projectCode ?? ''} — séance du ${fmtDate(view.sessionOn)} passée : enregistrez l'étude tenue ou replanifiez-la`,
        key: `etude-securite|${view.id}`, who: to.who, ownerIds: to.ownerIds, siteId: view.siteId, href: studyHref(view.id),
      } satisfies TodoItem;
    })
    .filter((x) => canApprove(session.role) || x.ownerIds.includes(session.user.id));
  return { todo };
});
