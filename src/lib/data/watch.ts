import 'server-only';
import { cache } from 'react';
import { and, asc, desc, inArray, isNotNull, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toAttachmentItem } from '../attachments';
import { appliesToSite } from '../watch-rules';
import { addDays, addMonths, fmtDate, fmtDayMonth, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  CONTROL_HORIZON_DAYS, CONTROL_RESULTS, REQUIREMENT_EVAL, REQUIREMENT_NEEDS_ACTION, REQUIREMENT_REVIEW_MONTHS, TODO_HORIZON_DAYS,
  SAFETY_NOTICE_KINDS, isBlockingControlResult, requirementReviewMonths, type ControlResult, type SafetyNoticeKind, type TodoItem, type Tone,
} from '../domain';
import { actionView, certificationStatus, concernedCount, concernedProjects, controlStatus, lcfirst, loadControls, loadPeople, loadSiteRows, requirementDue } from '../queries';
import { canReadAction } from '../action-rules';
import { currentSiteId, getSession, inPerimeter, inSite, siteFilter } from '../session';
import { loadQhseLeads } from './leads';
import { loadLinkedEvents } from './linked-events';
import { loadPreventionCompliance } from './prevention-signals';
import { loadDuerpStatus, type DuerpStatus } from './risks';
import { loadWasteIndicators } from './environment';

// ─── Veille et contrôles ────────────────────────────────────────────────────

/** Filtres de l'onglet « Contrôles périodiques » (paramètre `statut`) ; « Archivés » = équipements réformés. */
export type ControlFilter = 'depasses' | 'sous-30-j' | 'planifies' | 'archives';
export const CONTROL_FILTERS: { key: ControlFilter; label: string }[] = [
  { key: 'depasses', label: 'Dépassés' },
  { key: 'sous-30-j', label: 'Sous 30 j' },
  { key: 'planifies', label: 'Planifiés' },
  { key: 'archives', label: 'Archivés' },
];

/** Évaluations qui appellent une action dans le plan d'actions unique. */
const NEEDS_ACTION = new Set<string>(REQUIREMENT_NEEDS_ACTION);

const equipShort = (e: string) => e.split(' — ')[0];

/** Jour (AAAA-MM-JJ, heure de Paris) d'un horodatage d'archivage ou d'annulation. */
const dayOf = parisDay;

/** « Archivée le 30/06/2026 par Claire Lefèvre · motif » (archivage, annulation). */
const traceLabel = (verb: string, at: Date | null, by: string, reason: string | null) =>
  at ? [`${verb} le ${fmtDate(dayOf(at))}${by ? ` par ${by}` : ''}`, reason].filter(Boolean).join(' · ') : null;


// ─── Indicateurs calculés par d'autres écrans ───────────────────────────────

/**
 * État calculé d'une exigence rattachée à un autre écran (DUERP, plans de prévention), affiché à côté de
 * l'évaluation du pilote, qui reste manuelle. `gap` : l'indicateur appelle l'évaluation « Écart ».
 */
export type RequirementIndicator = { label: string; tone: Tone; href: string; gap: boolean };

function duerpIndicator(d: DuerpStatus, horizonDays: number): RequirementIndicator {
  if (!d.version || !d.nextUpdateOn) return { label: 'Aucune version du DUERP en vigueur', tone: 'danger', href: d.href, gap: true };
  if (d.overdue) return { label: `DUERP ${d.version} · mise à jour annuelle dépassée depuis le ${fmtDate(d.nextUpdateOn)}`, tone: 'danger', href: d.href, gap: true };
  const soon = d.daysToUpdate != null && d.daysToUpdate <= horizonDays;
  return { label: `DUERP ${d.version} en vigueur · mise à jour avant le ${fmtDate(d.nextUpdateOn)}`, tone: soon ? 'warn' : 'ok', href: d.href, gap: false };
}

/**
 * VEI-12 : état calculé de chaque certification (statut du certificat : engagement, validité, suspension, prochain audit
 * au programme — certificationStatus, comme l'écran Audits), pour l'exigence rattachée à l'indicateur « certification ».
 * Certificat suspendu ou expiré : écart.
 */
const loadCertificationIndicators = cache(async (now: string): Promise<Map<string, RequirementIndicator>> => {
  const db = await getDb();
  const [certs, items] = await Promise.all([
    db.select().from(t.certifications),
    db.select({ certificationId: t.auditPlanItems.certificationId, done: t.auditPlanItems.done, plannedOn: t.auditPlanItems.plannedOn, year: t.auditPlanItems.year, month: t.auditPlanItems.month })
      .from(t.auditPlanItems).where(and(isNotNull(t.auditPlanItems.certificationId), isNull(t.auditPlanItems.cancelledAt))),
  ]);
  return new Map(certs.map((c) => {
    // Prochain audit au programme (élément non réalisé), comme l'écran Audits ; sans date : fin du mois prévu.
    const next = items.filter((p) => p.certificationId === c.id && !p.done)
      .map((p) => p.plannedOn ?? `${p.year}-${String(p.month).padStart(2, '0')}-31`).sort()[0] ?? null;
    const state = certificationStatus(c, next, now);
    return [c.id, { label: `${c.standard} · ${state.label}`, tone: state.tone, href: `/audits?referentiel=${encodeURIComponent(c.id)}`, gap: state.tone === 'danger' }];
  }));
});

// ─── Projets Keystone concernés (veille, tableau de bord) ───────────────────

type ProjectRow = typeof t.keystoneProjects.$inferSelect;
type ProjectReq = { dueOn: string | null; affectsProjects: boolean; keystoneProjects: number | null };

/**
 * Projets Keystone concernés par une exigence : calculés (livraison après la date d'application) pour une exigence
 * marquée `affectsProjects` ; le nombre saisi (`keystoneProjects`) reste une surcharge. count = null : non applicable.
 */
export function projectsOf(r: ProjectReq, all: ProjectRow[]) {
  const list = concernedProjects(r, all).map((p) => ({ id: p.id, client: p.client, title: p.title, delivery: fmtDate(p.deliveryOn!) }));
  return { count: concernedCount(r, all), manual: r.keystoneProjects != null, computed: r.affectsProjects && !!r.dueOn ? list.length : null, list };
}

/** Projets Keystone concernés par une exigence (lecture de keystone_projects), pour le tableau de bord. */
export async function requirementProjects(r: ProjectReq) {
  const db = await getDb();
  return projectsOf(r, await db.select().from(t.keystoneProjects));
}

/**
 * Exigences réglementaires (toute l'entreprise, archivées comprises) et contrôles périodiques du site sélectionné
 * (archivés compris), avec actions liées, historique des évaluations et des contrôles réalisés, journal des modifications.
 */
export async function loadWatch() {
  const db = await getDb();
  const now = today();
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const [session, people, reqs, allControls, sites, projects, site, duerp, prevention, waste, certs] = await Promise.all([
    getSession(),
    loadPeople(),
    db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id)),
    db.select().from(t.controls).orderBy(asc(t.controls.sort), asc(t.controls.id)),
    loadSiteRows(),
    db.select().from(t.keystoneProjects).orderBy(asc(t.keystoneProjects.deliveryOn)),
    currentSiteId(),
    loadDuerpStatus(),
    loadPreventionCompliance(),
    loadWasteIndicators(),
    loadCertificationIndicators(now),
  ]);
  // Indicateur rattaché explicitement (linkedTo, VEI-07) — DUERP : échéance et état repris de la version en vigueur
  // (/risques) ; plans de prévention (R. 4512-6) : interventions sans plan signé (/prevention) ; VEI-12 : registre des
  // déchets (mentions) et bordereaux (BSD manquants), tout le périmètre (/environnement) ; certification choisie (/audits).
  const indicatorOf = (r: (typeof reqs)[number]): RequirementIndicator | null =>
    r.linkedTo === 'duerp' ? duerpIndicator(duerp, TODO_HORIZON_DAYS)
      : r.linkedTo === 'prevention' ? { ...prevention, gap: prevention.gapCount > 0 }
        : r.linkedTo === 'waste_bsd' ? waste.bsd
          : r.linkedTo === 'waste_register' ? waste.register
            : r.linkedTo === 'certification' && r.certificationId ? certs.get(r.certificationId) ?? null
              : null;
  const controls = allControls.filter((c) => inSite(site, c.siteId));
  // VEI-06 : une exigence vaut pour toute l'entreprise — ses contrôles rattachés sont lus sur tout le périmètre de la
  // personne, quel que soit le site sélectionné (l'onglet « Contrôles périodiques » reste filtré par site).
  const perimeterControls = allControls.filter((c) => inPerimeter(session.allowedSiteIds, c.siteId));
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));

  // Les actions liées sont lues sans filtre de site : la veille vaut pour toute l'entreprise.
  const actionIds = [...new Set([...reqs, ...controls].map((r) => r.actionId).filter((id): id is string => !!id))];
  const controlIds = controls.map((c) => c.id);
  const reqIds = reqs.map((r) => r.id);
  // Journaux des exigences et des contrôles : chargés à l'ouverture de leur fiche (QUA-11, LazyChangeLog).
  const [actions, records, evaluations] = await Promise.all([
    actionIds.length ? db.select().from(t.actions).where(inArray(t.actions.id, actionIds)) : Promise.resolve([]),
    controlIds.length
      ? db.select().from(t.controlRecords).where(inArray(t.controlRecords.controlId, controlIds)).orderBy(desc(t.controlRecords.performedOn), desc(t.controlRecords.id))
      : Promise.resolve([]),
    reqIds.length
      ? db.select().from(t.requirementEvaluations).where(inArray(t.requirementEvaluations.requirementId, reqIds))
        .orderBy(desc(t.requirementEvaluations.evaluatedOn), desc(t.requirementEvaluations.id))
      : Promise.resolve([]),
  ]);
  const fileKeys = [
    ...records.map((r) => ['control_record', String(r.id)] as const),
    ...evaluations.map((e) => ['requirement_evaluation', String(e.id)] as const),
    // VEI-10 : textes joints aux exigences.
    ...reqs.map((r) => ['requirement', String(r.id)] as const),
  ];
  const files = fileKeys.length
    ? await db.select().from(t.attachments)
      .where(and(inArray(t.attachments.entityType, ['control_record', 'requirement_evaluation', 'requirement']), inArray(t.attachments.entityId, [...new Set(fileKeys.map(([, id]) => id))])))
      .orderBy(asc(t.attachments.createdAt))
    : [];
  // Pièces jointes (VEI-08 : complétées ou retirées après la saisie, src/server/entity-files.ts), avec l'auteur de l'envoi.
  const filesOf = (type: string, id: number) => files.filter((f) => f.entityType === type && f.entityId === String(id))
    .map((f) => toAttachmentItem(f, f.uploadedBy ? people.get(f.uploadedBy)?.name : undefined));
  // Action liée : libellé court (actionLabel), avancement affiché (« En retard » le cas échéant), date cible — seulement
  // pour une action que la personne peut lire (canReadAction : plan de son périmètre, ou ses propres actions) ; une
  // exigence vaut pour toute l'entreprise, son action peut appartenir à un site hors du périmètre : numéro seul.
  const readable = actions.filter((a) => canReadAction(session.role, session.user.id, a, session.allowedSiteIds));
  const actionById = new Map(readable.map((a) => [a.id, actionView(a, people, now)]));
  const actionOf = (id: string | null) => {
    const a = id ? actionById.get(id) : undefined;
    return a ? { id: a.id, label: a.label, statusLabel: a.statusLabel, tone: a.tone, due: fmtDate(a.dueOn), late: a.late } : null;
  };

  // Contrôles actifs du site, avec statut calculé (base des contrôles rattachés aux exigences).
  const controlState = new Map(perimeterControls.map((c) => [c.id, controlStatus(c, now)]));
  const evalOf = (e: string) => REQUIREMENT_EVAL[e] ?? { label: e, tone: 'neutral' as Tone };

  // VEI-10 : exigences applicables au site sélectionné (« Tous les sites » : toutes) ; sites concernés affichés.
  const requirements = reqs.filter((r) => appliesToSite(r.siteIds, site)).map((r) => {
    const ev = evalOf(r.evaluation);
    const archived = !!r.archivedAt;
    const linked = perimeterControls.filter((c) => c.requirementId === r.id && !c.archivedAt).map((c) => {
      const s = controlState.get(c.id)!;
      return {
        id: c.id, equipment: c.equipment, controlType: c.controlType, status: s.label, tone: s.tone, next: fmtDate(c.nextOn), overdue: s.days < 0,
        siteId: c.siteId, siteLabel: c.siteId ? siteLabel.get(c.siteId) ?? c.siteId : 'Tous les sites',
      };
    });
    // VEI-03 : exigence suivie par des contrôles : échéance du prochain contrôle rattaché (calculée).
    const due = requirementDue(r, perimeterControls);
    const late = linked.find((c) => c.overdue);
    const indicator = archived ? null : indicatorOf(r);
    // VEI-18 : périodicité de réévaluation propre à l'exigence (12 mois par défaut).
    const reviewOn = r.lastEvaluatedOn && r.evaluation !== 'a_evaluer' ? addMonths(r.lastEvaluatedOn, requirementReviewMonths(r)) : null;
    const duerpDue = r.linkedTo === 'duerp' && duerp.nextUpdateOn ? `${fmtDate(duerp.nextUpdateOn)} · mise à jour annuelle du DUERP` : null;
    return {
      ...r,
      archived,
      siteLabels: r.siteIds?.length ? r.siteIds.map((x) => (siteLabel.get(x) ?? x).split(' — ')[0]) : [],
      textFiles: filesOf('requirement', r.id),
      archivedLabel: traceLabel('Archivée', r.archivedAt, name(r.archivedById), r.archiveReason),
      due: duerpDue ?? (due.control
        ? `${fmtDate(due.on!)} · prochain contrôle (${lcfirst(due.control.controlType)}, ${lcfirst(equipShort(due.control.equipment))})`
        : [r.dueOn && fmtDate(r.dueOn), r.dueNote].filter(Boolean).join(' · ')),
      /** Échéance tirée du prochain contrôle rattaché (VEI-03) : la date saisie n'est plus proposée. */
      dueFromControl: !!due.control,
      /** VEI-13 : date de l'échéance affichée (tri « par échéance ») ; null sans échéance. */
      dueSort: (r.linkedTo === 'duerp' && duerp.nextUpdateOn) || (due.control ? due.on : null) || r.dueOn || null,
      indicator,
      evalLabel: r.evaluationNote ? `${ev.label} · ${r.evaluationNote}` : ev.label,
      tone: ev.tone,
      pilot: name(r.pilotId),
      lastEvaluated: r.lastEvaluatedOn ? fmtDate(r.lastEvaluatedOn) : null,
      needsAction: !archived && NEEDS_ACTION.has(r.evaluation) && !r.actionId,
      action: actionOf(r.actionId),
      projects: projectsOf(r, projects),
      controls: linked,
      // Suggestion calculée, jamais stockée : l'évaluation reste un jugement du pilote.
      suggestGap: !archived && (!!late || !!indicator?.gap) && r.evaluation !== 'ecart',
      suggestReason: late ? 'Contrôle rattaché dépassé' : indicator?.gap ? 'Indicateur calculé en écart' : null,
      suggestNote: (late ? `${late.controlType} ${lcfirst(equipShort(late.equipment))} dépassée` : indicator?.gap ? indicator.label : '').slice(0, 160) || null,
      reviewEvery: requirementReviewMonths(r),
      nextReview: reviewOn && !archived ? {
        on: reviewOn,
        label: `Réévaluation avant le ${fmtDate(reviewOn)}`,
        tone: (reviewOn < now ? 'danger' : reviewOn <= horizon ? 'warn' : 'neutral') as Tone,
      } : null,
      evaluations: evaluations.filter((e) => e.requirementId === r.id).map((e) => {
        const v = evalOf(e.evaluation);
        // VEI-16 : évaluation annulée (saisie par erreur) gardée à l'historique, barrée, avec son motif.
        const cancelled = e.cancelledAt ? { on: fmtDate(parisDay(e.cancelledAt)), by: name(e.cancelledById), reason: e.cancelReason ?? '' } : null;
        return { id: e.id, date: fmtDate(e.evaluatedOn), evaluation: e.evaluation, label: v.label, tone: v.tone, note: e.note, by: name(e.evaluatedById), files: filesOf('requirement_evaluation', e.id), cancelled };
      }),
    };
  });
  const reqBrief = new Map(reqs.map((r) => [r.id, { id: r.id, text: r.text, archived: !!r.archivedAt }]));

  const recordsByControl = new Map<number, ReturnType<typeof recordView>[]>();
  function recordView(r: (typeof records)[number]) {
    return {
      id: r.id,
      performedOn: r.performedOn,
      date: fmtDate(r.performedOn),
      organization: r.organization,
      reserves: r.reserves,
      notes: r.notes,
      /** VEI-11 : résultat du contrôle (null pour une saisie antérieure). */
      result: r.result && r.result in CONTROL_RESULTS ? { key: r.result as ControlResult, ...CONTROL_RESULTS[r.result as ControlResult] } : null,
      recordedBy: name(r.recordedById),
      /** VEI-14 : non-conformité ouverte par un étalonnage hors tolérance. */
      eventId: r.eventId,
      cancelled: !!r.cancelledAt,
      cancelLabel: traceLabel('Annulé', r.cancelledAt, name(r.cancelledById), r.cancelReason),
      /** Enregistrement qui fixe l'état du contrôle (le plus récent non annulé, à la date du dernier contrôle). */
      latest: false,
      files: filesOf('control_record', r.id),
    };
  }
  records.forEach((r) => recordsByControl.set(r.controlId, [...(recordsByControl.get(r.controlId) ?? []), recordView(r)]));
  // EVT-14 : événements rattachés aux équipements (périmètre, jamais une maladie professionnelle hors rôles habilités).
  const linkedEvents = await loadLinkedEvents('control', controls.map((c) => c.id));

  return {
    requirements,
    // VEI-12 : certifications proposées pour l'indicateur « certification » d'une exigence.
    certifications: [...certs.keys()].map((id) => [id, certs.get(id)!.label.split(' · ')[0]] as const),
    controls: controls.map((c) => {
      const s = controlState.get(c.id)!;
      const archived = !!c.archivedAt;
      const filter: ControlFilter = archived ? 'archives' : s.days < 0 ? 'depasses' : s.days <= CONTROL_HORIZON_DAYS ? 'sous-30-j' : 'planifies';
      const recs = recordsByControl.get(c.id) ?? [];
      const head = recs.find((r) => !r.cancelled);
      if (head && head.performedOn === c.lastOn) head.latest = true;
      // VEI-11 : dernier contrôle défavorable ou mise à l'arrêt : équipement signalé jusqu'à un nouveau contrôle favorable.
      const blocked = !archived && head?.latest && head.result && isBlockingControlResult(head.result.key) ? head.result : null;
      return {
        ...c,
        archived,
        archivedLabel: traceLabel('Archivé', c.archivedAt, name(c.archivedById), c.archiveReason),
        period: `${c.periodMonths} mois`,
        last: fmtDate(c.lastOn),
        next: fmtDate(c.nextOn),
        status: archived ? 'Équipement réformé' : blocked ? `${blocked.label} · ${s.label.toLowerCase()}` : s.label,
        tone: archived ? 'neutral' as Tone : blocked ? 'danger' as Tone : s.tone,
        lastResult: head?.latest ? head.result : null,
        days: s.days,
        filter,
        responsible: name(c.responsibleId),
        siteLabel: c.siteId ? siteLabel.get(c.siteId) ?? c.siteId : 'Tous les sites',
        requirement: c.requirementId ? reqBrief.get(c.requirementId) ?? null : null,
        action: actionOf(c.actionId),
        records: recs,
        events: linkedEvents.get(String(c.id)) ?? [],
      };
    }),
  };
}

export type WatchData = Awaited<ReturnType<typeof loadWatch>>;
export type RequirementView = WatchData['requirements'][number];
export type ControlView = WatchData['controls'][number];

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances de la veille :
 * - contrôles périodiques actifs des sites du périmètre (TDB-05) dépassés ou sous CONTROL_HORIZON_DAYS, et réserves en
 *   cours sans action de levée (VEI-02) ;
 * - exigences actives (toute l'entreprise), au plus une échéance chacune, par priorité : écart ou analyse sans action,
 *   conformité à évaluer, date d'application dépassée ou proche sans conformité, réévaluation annuelle due.
 * Badge (count) : contrôles sous 30 j + réserves sans action + exigences à évaluer ou en écart sans action ; les autres échéances d'exigence
 * apparaissent dans « À traiter » sans compter dans le badge (count = 0).
 */
export const loadWatchSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const now = today();
  const db = await getDb();
  // Liens toujours renseignés : loadVisibleTodo écarte les échéances des rôles sans accès à la veille.
  const [controls, people, reqs] = await Promise.all([
    loadControls('perimeter'),
    loadPeople(),
    db.select().from(t.requirements).where(isNull(t.requirements.archivedAt)).orderBy(asc(t.requirements.sort), asc(t.requirements.id)),
  ]);
  // VEI-11 : résultat du dernier contrôle réalisé (le plus récent non annulé à la date du dernier contrôle).
  const records = controls.length
    ? await db.select({ controlId: t.controlRecords.controlId, performedOn: t.controlRecords.performedOn, result: t.controlRecords.result }).from(t.controlRecords)
      .where(and(inArray(t.controlRecords.controlId, controls.map((c) => c.id)), isNull(t.controlRecords.cancelledAt)))
      .orderBy(desc(t.controlRecords.performedOn), desc(t.controlRecords.id))
    : [];
  const todo: TodoItem[] = [];

  const ctrlHorizon = addDays(now, CONTROL_HORIZON_DAYS);
  controls.forEach((c) => {
    const s = controlStatus(c, now);
    const who = [c.organization, c.responsibleId ? people.get(c.responsibleId)?.name : ''].filter(Boolean).join(' · ');
    const title = `${c.controlType} · ${lcfirst(equipShort(c.equipment))}`;
    const base = { kind: 'Contrôle', who, href: `/veille?onglet=controles&controle=${c.id}`, ownerIds: c.responsibleId ? [c.responsibleId] : undefined, siteId: c.siteId };
    if (s.days < 0) todo.push({ ...base, date: now, dueOn: c.nextOn, tone: 'danger', overdue: true, title: `${title} — dépassé depuis le ${fmtDayMonth(c.nextOn)}` });
    else if (c.nextOn <= ctrlHorizon) todo.push({ ...base, date: c.nextOn, dueOn: c.nextOn, tone: 'warn', title });
    // VEI-11 : dernier contrôle défavorable ou mise à l'arrêt, tant qu'un nouveau contrôle favorable n'est pas enregistré.
    const lastRecord = records.find((r) => r.controlId === c.id);
    const result = lastRecord?.result ?? null;
    if (lastRecord && lastRecord.performedOn === c.lastOn && isBlockingControlResult(result)) {
      todo.push({
        ...base, date: now, dueOn: c.lastOn, tone: 'danger', overdue: true, key: `controle-resultat|${c.id}|${c.lastOn}`,
        title: `${title} — ${CONTROL_RESULTS[result as ControlResult].label.toLowerCase()} le ${fmtDayMonth(c.lastOn)} : nouveau contrôle favorable attendu`,
      });
    }
    // Réserves sans action de levée : même urgence qu'un écart sans action (VEI-02).
    if (c.reserves && !c.actionId) {
      todo.push({ ...base, date: now, tone: 'danger', overdue: true, title: `${title} — réserves « ${c.reserves} » sans action de levée` });
    }
  });

  const horizon = addDays(now, TODO_HORIZON_DAYS);
  // VEI-03 : exigence suivie par des contrôles (rattachés, actifs, sur le périmètre) : son échéance est celle du prochain
  // contrôle, déjà signalée par le contrôle lui-même ; la date d'application saisie (figée) ne déclenche plus d'échéance.
  const followed = new Set(controls.filter((c) => c.requirementId != null && !c.archivedAt).map((c) => c.requirementId!));
  reqs.forEach((r) => {
    const base = {
      kind: 'Veille', who: r.pilotId ? people.get(r.pilotId)?.name ?? '' : '',
      href: `/veille?exigence=${r.id}`, ownerIds: r.pilotId ? [r.pilotId] : undefined,
      // Exigence de veille : commune à tous les sites, ou propre au seul site où elle s'applique (VEI-10).
      siteId: r.siteIds?.length === 1 ? r.siteIds[0] : null,
    };
    const compliant = r.evaluation === 'conforme';
    // Exigence DUERP : l'échéance de mise à jour est celle de la version en vigueur, signalée par l'écran Risques.
    const dated = r.linkedTo !== 'duerp' && !followed.has(r.id);
    if (NEEDS_ACTION.has(r.evaluation) && !r.actionId) {
      todo.push({ ...base, date: now, tone: 'danger', overdue: true, title: `${r.text} — ${r.evaluation === 'analyse' ? "analyse d'écart sans action" : 'écart sans action'}` });
    } else if (r.evaluation === 'a_evaluer') {
      todo.push({ ...base, date: now, tone: 'warn', title: `${r.text} — conformité à évaluer` });
    } else if (dated && r.dueOn && r.dueOn < now && !compliant) {
      todo.push({ ...base, date: now, dueOn: r.dueOn, tone: 'danger', overdue: true, count: 0, title: `${r.text} — date d'application dépassée depuis le ${fmtDayMonth(r.dueOn)}` });
    } else if (dated && r.dueOn && r.dueOn <= horizon && !compliant) {
      todo.push({ ...base, date: r.dueOn, dueOn: r.dueOn, tone: 'warn', count: 0, title: `${r.text} — applicable le ${fmtDayMonth(r.dueOn)}` });
    } else if (r.lastEvaluatedOn) {
      // VEI-18 : périodicité propre à l'exigence ; « annuelle » pour 12 mois (intitulé et clé inchangés par défaut).
      const months = requirementReviewMonths(r);
      const reviewOn = addMonths(r.lastEvaluatedOn, months);
      if (reviewOn <= horizon) {
        const late = reviewOn < now;
        todo.push({
          ...base, date: late ? now : reviewOn, dueOn: reviewOn, tone: 'warn', overdue: late || undefined, count: 0,
          title: `${r.text} — ${months === REQUIREMENT_REVIEW_MONTHS ? 'réévaluation annuelle' : `réévaluation (tous les ${months} mois)`}${late ? ` en retard depuis le ${fmtDayMonth(reviewOn)}` : ''}`,
        });
      }
    }
  });

  // VEI-15 : observations et mises en demeure du registre de sécurité sans réponse, sur les sites du périmètre, au
  // responsable QHSE du site ; délai fixé : échéance (badge) sous l'horizon ou dépassée ; sans délai : à traiter (count 0).
  const [notices, keep, leads] = await Promise.all([
    db.select().from(t.safetyNotices).where(and(isNull(t.safetyNotices.cancelledAt), isNull(t.safetyNotices.answeredOn))),
    siteFilter('perimeter'), loadQhseLeads(),
  ]);
  let noticeBadge = 0;
  notices.filter((n) => keep(n.siteId)).forEach((n) => {
    const to = leads.forSite(n.siteId);
    const label = SAFETY_NOTICE_KINDS[n.kind as SafetyNoticeKind]?.label ?? 'Observation';
    const base = {
      kind: 'Registre de sécurité', who: [n.authority, to.who].filter(Boolean).join(' · '), ownerIds: to.ownerIds, siteId: n.siteId,
      href: `/veille?onglet=registre&observation=${n.id}`, key: `registre-securite|${n.id}`,
    };
    const what = `${label} (${n.authority}) du ${fmtDayMonth(n.receivedOn)}`;
    if (n.dueOn && n.dueOn < now) {
      noticeBadge += 1;
      todo.push({ ...base, date: now, dueOn: n.dueOn, tone: 'danger', overdue: true, title: `${what} — réponse en retard depuis le ${fmtDayMonth(n.dueOn)}` });
    } else if (n.dueOn && n.dueOn <= horizon) {
      noticeBadge += 1;
      todo.push({ ...base, date: n.dueOn, dueOn: n.dueOn, tone: n.kind === 'mise_en_demeure' ? 'danger' : 'warn', title: `${what} — réponse attendue avant le ${fmtDayMonth(n.dueOn)}` });
    } else if (!n.dueOn) {
      todo.push({ ...base, date: now, tone: 'warn', count: 0, title: `${what} — réponse à apporter` });
    }
  });

  const badge = controls.filter((c) => controlStatus(c, now).days <= CONTROL_HORIZON_DAYS).length
    + controls.filter((c) => c.reserves && !c.actionId).length
    + reqs.filter((r) => r.evaluation === 'a_evaluer' || (NEEDS_ACTION.has(r.evaluation) && !r.actionId)).length
    + noticeBadge;
  return { badge, todo };
});

// ─── Registre de sécurité (VEI-15) ──────────────────────────────────────────

/** Observation ou mise en demeure du registre de sécurité, telle qu'affichée (onglet « Registre de sécurité », impression). */
export type SafetyNoticeView = {
  id: number; siteId: string; siteLabel: string; kind: SafetyNoticeKind; kindLabel: string; tone: Tone;
  receivedOn: string; authority: string; reference: string | null; text: string; dueOn: string | null;
  controlId: number | null; control: string | null;
  answeredOn: string | null; answer: string | null; answeredBy: string;
  /** Réponse attendue (non répondue, non annulée) : en retard après le délai. */
  state: { label: string; tone: Tone };
  cancelled: { on: string; by: string; reason: string } | null;
};

const noticeState = (n: { answeredOn: string | null; dueOn: string | null; cancelledAt: Date | null }, now: string): { label: string; tone: Tone } =>
  n.cancelledAt ? { label: 'Annulée', tone: 'neutral' }
    : n.answeredOn ? { label: `Réponse apportée le ${fmtDate(n.answeredOn)}`, tone: 'ok' }
      : n.dueOn && n.dueOn < now ? { label: `Réponse en retard depuis le ${fmtDate(n.dueOn)}`, tone: 'danger' }
        : n.dueOn ? { label: `Réponse attendue avant le ${fmtDate(n.dueOn)}`, tone: 'warn' }
          : { label: 'Réponse à apporter', tone: 'warn' };

/**
 * Observations et mises en demeure du registre de sécurité (L. 4711-1) du site sélectionné (« Tous les sites » :
 * périmètre), annulées comprises (barrées), la plus récente d'abord ; équipements proposés (contrôles en service du site).
 */
export const loadSafetyNotices = cache(async (): Promise<{ notices: SafetyNoticeView[]; controlOptions: (readonly [string, string, string | null])[] }> => {
  const db = await getDb();
  const now = today();
  const [rows, people, sites, keep, controls] = await Promise.all([
    db.select().from(t.safetyNotices).orderBy(desc(t.safetyNotices.receivedOn), desc(t.safetyNotices.id)),
    loadPeople(), loadSiteRows(), siteFilter('site'), loadControls(),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const allControls = rows.some((r) => r.controlId)
    ? new Map((await db.select({ id: t.controls.id, equipment: t.controls.equipment }).from(t.controls)).map((c) => [c.id, c.equipment]))
    : new Map<number, string>();
  return {
    notices: rows.filter((r) => keep(r.siteId)).map((r) => ({
      id: r.id, siteId: r.siteId, siteLabel: siteLabel.get(r.siteId) ?? r.siteId,
      kind: r.kind as SafetyNoticeKind, kindLabel: SAFETY_NOTICE_KINDS[r.kind as SafetyNoticeKind]?.label ?? r.kind, tone: SAFETY_NOTICE_KINDS[r.kind as SafetyNoticeKind]?.tone ?? 'neutral',
      receivedOn: r.receivedOn, authority: r.authority, reference: r.reference, text: r.text, dueOn: r.dueOn,
      controlId: r.controlId, control: r.controlId ? allControls.get(r.controlId) ?? null : null,
      answeredOn: r.answeredOn, answer: r.answer, answeredBy: name(r.answeredById),
      state: noticeState(r, now),
      cancelled: r.cancelledAt ? { on: fmtDate(parisDay(r.cancelledAt)), by: name(r.cancelledById), reason: r.cancelReason ?? '' } : null,
    })),
    // [identifiant, équipement, site] : la liste du formulaire garde les contrôles du site choisi (ou communs).
    controlOptions: controls.map((c) => [String(c.id), `${c.equipment} · ${c.controlType}`, c.siteId] as const),
  };
});

/**
 * Registre de sécurité imprimable par site (L. 4711-1 : attestations, consignes, résultats et rapports des contrôles et
 * vérifications, observations et mises en demeure) : pour chaque site du choix (site sélectionné, sinon tous les sites du
 * périmètre), les vérifications périodiques réalisées (enregistrements non annulés des contrôles du site et des contrôles
 * communs, équipements réformés compris) et les observations et mises en demeure (non annulées). Consolidé à l'affichage,
 * jamais stocké.
 */
export async function loadSafetyRegisterPrint() {
  const db = await getDb();
  const now = today();
  const [{ notices }, sites, keep, controls, people] = await Promise.all([
    loadSafetyNotices(), loadSiteRows(), siteFilter('site'), db.select().from(t.controls).orderBy(asc(t.controls.sort), asc(t.controls.id)), loadPeople(),
  ]);
  const shown = controls.filter((c) => keep(c.siteId));
  const records = shown.length
    ? await db.select().from(t.controlRecords).where(and(inArray(t.controlRecords.controlId, shown.map((c) => c.id)), isNull(t.controlRecords.cancelledAt)))
      .orderBy(desc(t.controlRecords.performedOn), desc(t.controlRecords.id))
    : [];
  const registerSites = sites.filter((s) => keep(s.id) && (!s.archivedAt || notices.some((n) => n.siteId === s.id)));
  return {
    now,
    sites: registerSites.map((s) => {
      const mine = shown.filter((c) => !c.siteId || c.siteId === s.id);
      return {
        id: s.id, label: s.label, siret: s.siret, archived: !!s.archivedAt,
        controls: mine.map((c) => {
          const state = controlStatus(c, now);
          return {
            id: c.id, equipment: c.equipment, controlType: c.controlType, category: c.category, organization: c.organization, period: c.periodMonths,
            responsible: c.responsibleId ? people.get(c.responsibleId)?.name ?? '' : '', common: !c.siteId,
            next: c.nextOn, status: c.archivedAt ? 'Équipement réformé' : state.label, tone: (c.archivedAt ? 'neutral' : state.tone) as Tone,
            reserves: c.reserves,
            records: records.filter((r) => r.controlId === c.id).map((r) => ({
              id: r.id, performedOn: r.performedOn, organization: r.organization, reserves: r.reserves, notes: r.notes,
              result: r.result && r.result in CONTROL_RESULTS ? CONTROL_RESULTS[r.result as ControlResult].label : null, eventId: r.eventId,
            })),
          };
        }),
        notices: notices.filter((n) => n.siteId === s.id && !n.cancelled),
      };
    }),
  };
}
