import 'server-only';
import { cache } from 'react';
import { and, asc, desc, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fileIcon, fmtSize } from '../attachments';
import { addDays, addMonths, fmtDate, fmtDayMonth, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  CONTROL_HORIZON_DAYS, PREVENTION_REQUIREMENT_DOMAIN, REQUIREMENT_EVAL, REQUIREMENT_NEEDS_ACTION, REQUIREMENT_REVIEW_MONTHS, TODO_HORIZON_DAYS,
  type TodoItem, type Tone,
} from '../domain';
import { actionView, concernedCount, concernedProjects, controlStatus, lcfirst, loadControls, loadPeople, requirementDue } from '../queries';
import { canReadAction } from '../action-rules';
import { currentSiteId, getSession, inPerimeter, inSite } from '../session';
import { attachmentUrl } from '../uploads';
import { loadPreventionCompliance } from './prevention';
import { loadDuerpStatus, type DuerpStatus } from './risks';

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

type FileRow = { id: string; fileName: string; mimeType: string; size: number };
const fileView = (f: FileRow) => ({ id: f.id, name: f.fileName, url: attachmentUrl(f.id), size: fmtSize(f.size), icon: fileIcon(f.mimeType) });
export type FileChip = ReturnType<typeof fileView>;

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
  const [session, people, reqs, allControls, sites, projects, site, duerp, prevention] = await Promise.all([
    getSession(),
    loadPeople(),
    db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id)),
    db.select().from(t.controls).orderBy(asc(t.controls.sort), asc(t.controls.id)),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    db.select().from(t.keystoneProjects).orderBy(asc(t.keystoneProjects.deliveryOn)),
    currentSiteId(),
    loadDuerpStatus(),
    loadPreventionCompliance(),
  ]);
  // Exigence DUERP (linkedTo = 'duerp') : échéance et état repris de la version en vigueur (/risques) ;
  // plans de prévention (R. 4512-6) : interventions sans plan signé sur le site sélectionné (/prevention).
  const indicatorOf = (r: (typeof reqs)[number]): RequirementIndicator | null =>
    r.linkedTo === 'duerp' ? duerpIndicator(duerp, TODO_HORIZON_DAYS)
      : r.domain === PREVENTION_REQUIREMENT_DOMAIN ? { ...prevention, gap: prevention.gapCount > 0 }
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
  ];
  const files = fileKeys.length
    ? await db.select().from(t.attachments)
      .where(and(inArray(t.attachments.entityType, ['control_record', 'requirement_evaluation']), inArray(t.attachments.entityId, [...new Set(fileKeys.map(([, id]) => id))])))
      .orderBy(asc(t.attachments.createdAt))
    : [];
  const filesOf = (type: string, id: number) => files.filter((f) => f.entityType === type && f.entityId === String(id)).map(fileView);
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

  const requirements = reqs.map((r) => {
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
    const reviewOn = r.lastEvaluatedOn && r.evaluation !== 'a_evaluer' ? addMonths(r.lastEvaluatedOn, REQUIREMENT_REVIEW_MONTHS) : null;
    const duerpDue = r.linkedTo === 'duerp' && duerp.nextUpdateOn ? `${fmtDate(duerp.nextUpdateOn)} · mise à jour annuelle du DUERP` : null;
    return {
      ...r,
      archived,
      archivedLabel: traceLabel('Archivée', r.archivedAt, name(r.archivedById), r.archiveReason),
      due: duerpDue ?? (due.control
        ? `${fmtDate(due.on!)} · prochain contrôle (${lcfirst(due.control.controlType)}, ${lcfirst(equipShort(due.control.equipment))})`
        : [r.dueOn && fmtDate(r.dueOn), r.dueNote].filter(Boolean).join(' · ')),
      /** Échéance tirée du prochain contrôle rattaché (VEI-03) : la date saisie n'est plus proposée. */
      dueFromControl: !!due.control,
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
      nextReview: reviewOn && !archived ? {
        on: reviewOn,
        label: `Réévaluation avant le ${fmtDate(reviewOn)}`,
        tone: (reviewOn < now ? 'danger' : reviewOn <= horizon ? 'warn' : 'neutral') as Tone,
      } : null,
      evaluations: evaluations.filter((e) => e.requirementId === r.id).map((e) => {
        const v = evalOf(e.evaluation);
        return { id: e.id, date: fmtDate(e.evaluatedOn), evaluation: e.evaluation, label: v.label, tone: v.tone, note: e.note, by: name(e.evaluatedById), files: filesOf('requirement_evaluation', e.id) };
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
      recordedBy: name(r.recordedById),
      cancelled: !!r.cancelledAt,
      cancelLabel: traceLabel('Annulé', r.cancelledAt, name(r.cancelledById), r.cancelReason),
      /** Enregistrement qui fixe l'état du contrôle (le plus récent non annulé, à la date du dernier contrôle). */
      latest: false,
      files: filesOf('control_record', r.id),
    };
  }
  records.forEach((r) => recordsByControl.set(r.controlId, [...(recordsByControl.get(r.controlId) ?? []), recordView(r)]));

  return {
    requirements,
    controls: controls.map((c) => {
      const s = controlState.get(c.id)!;
      const archived = !!c.archivedAt;
      const filter: ControlFilter = archived ? 'archives' : s.days < 0 ? 'depasses' : s.days <= CONTROL_HORIZON_DAYS ? 'sous-30-j' : 'planifies';
      const recs = recordsByControl.get(c.id) ?? [];
      const head = recs.find((r) => !r.cancelled);
      if (head && head.performedOn === c.lastOn) head.latest = true;
      return {
        ...c,
        archived,
        archivedLabel: traceLabel('Archivé', c.archivedAt, name(c.archivedById), c.archiveReason),
        period: `${c.periodMonths} mois`,
        last: fmtDate(c.lastOn),
        next: fmtDate(c.nextOn),
        status: archived ? 'Équipement réformé' : s.label,
        tone: archived ? 'neutral' as Tone : s.tone,
        days: s.days,
        filter,
        responsible: name(c.responsibleId),
        siteLabel: c.siteId ? siteLabel.get(c.siteId) ?? c.siteId : 'Tous les sites',
        requirement: c.requirementId ? reqBrief.get(c.requirementId) ?? null : null,
        action: actionOf(c.actionId),
        records: recs,
      };
    }),
  };
}

export type WatchData = Awaited<ReturnType<typeof loadWatch>>;
export type RequirementView = WatchData['requirements'][number];
export type ControlView = WatchData['controls'][number];
export type ControlRecordView = ControlView['records'][number];

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
  const todo: TodoItem[] = [];

  const ctrlHorizon = addDays(now, CONTROL_HORIZON_DAYS);
  controls.forEach((c) => {
    const s = controlStatus(c, now);
    const who = [c.organization, c.responsibleId ? people.get(c.responsibleId)?.name : ''].filter(Boolean).join(' · ');
    const title = `${c.controlType} · ${lcfirst(equipShort(c.equipment))}`;
    const base = { kind: 'Contrôle', who, href: `/veille?onglet=controles&controle=${c.id}`, ownerIds: c.responsibleId ? [c.responsibleId] : undefined, siteId: c.siteId };
    if (s.days < 0) todo.push({ ...base, date: now, dueOn: c.nextOn, tone: 'danger', overdue: true, title: `${title} — dépassé depuis le ${fmtDayMonth(c.nextOn)}` });
    else if (c.nextOn <= ctrlHorizon) todo.push({ ...base, date: c.nextOn, dueOn: c.nextOn, tone: 'warn', title });
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
      // Exigence de veille : commune à tous les sites.
      siteId: null,
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
      const reviewOn = addMonths(r.lastEvaluatedOn, REQUIREMENT_REVIEW_MONTHS);
      if (reviewOn <= horizon) {
        const late = reviewOn < now;
        todo.push({
          ...base, date: late ? now : reviewOn, dueOn: reviewOn, tone: 'warn', overdue: late || undefined, count: 0,
          title: `${r.text} — réévaluation annuelle${late ? ` en retard depuis le ${fmtDayMonth(reviewOn)}` : ''}`,
        });
      }
    }
  });

  const badge = controls.filter((c) => controlStatus(c, now).days <= CONTROL_HORIZON_DAYS).length
    + controls.filter((c) => c.reserves && !c.actionId).length
    + reqs.filter((r) => r.evaluation === 'a_evaluer' || (NEEDS_ACTION.has(r.evaluation) && !r.actionId)).length;
  return { badge, todo };
});
