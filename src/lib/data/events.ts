import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtQty, wasteEntryHref } from '@/components/environment/model';
import type { ChangeEntry } from '@/components/ChangeLog';
import { cpamBasis, cpamDeadline, ettDeadline, fmtDeadline, mpQuestionnaireDeadline, reservesDeadline } from '@/components/events/deadlines';
import {
  BENIGN_REGISTER_PATH, FIRST_AID_TITLE_FALLBACK, HEALTH_FILE_FIELD, HEALTH_LOG_FIELDS, advanceBlocker, analysisFilled, benignRegisterBlocker, cpamPending,
  declarationDuty, eventLockReason, injuryLabel, missingQualification, needsCpam, victimKindLabel, victimLabel, withoutHealth,
  type AttachmentItem, type DeclarationDuty,
} from '@/components/events/shared';
import { addDays, fmtDate, parisDay, toParisLocal } from '../dates';
import { today } from '@/lib/today';
import {
  ALL_SITES, AVANCEMENT, BENIGN_CAREGIVER_KINDS, EVENT_STEPS, EVENT_TRANSITIONS, EVENT_TYPES, METHODS, QUALIFY_DELAY_DAYS, STEP_CLOSED,
  canSeeHealth, isEmployee, type BenignCaregiverKind, type EventTransition, type EventType, type Role, type Tone, type TodoItem,
} from '../domain';
import { canCreateAction } from '../action-rules';
import { actionView, controlStatus, eventView, loadControls, loadEvents, loadPeople, loadSiteEvents, type Person } from '../queries';
import { loadChangeLog } from './changelog';
import { loadQhseLeads } from './leads';
import { currentSiteId, getSession, inPerimeter, inSite } from '../session';
import { attachmentUrl } from '../uploads';
import { logAccess } from '@/server/access-log';
import type { Option } from './options';

// ─── Signalements et événements ─────────────────────────────────────────────

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Jour calendaire (Europe/Paris) d'un horodatage, au format ISO « AAAA-MM-JJ ». */
const isoDay = parisDay;

type StepRow = typeof t.eventSteps.$inferSelect;

/**
 * Date d'entrée dans chaque étape (index = étape, [0] = déclaration) en rejouant l'historique :
 * un retour arrière ou une réouverture efface les dates des étapes quittées ; les étapes non atteintes restent null.
 */
function stepDatesOf(rows: readonly StepRow[], createdAt: Date, step: number): (string | null)[] {
  const dates: (string | null)[] = EVENT_STEPS.map(() => null);
  dates[0] = isoDay(createdAt);
  for (const r of rows) {
    if (r.kind === 'advance') dates[r.toStep] = isoDay(r.at);
    else if (r.kind === 'revert' || r.kind === 'reopen') for (let k = r.toStep + 1; k < dates.length; k++) dates[k] = null;
  }
  return dates.map((d, i) => (i <= step ? d : null));
}

async function loadSteps(eventIds: string[]) {
  if (!eventIds.length) return [];
  const db = await getDb();
  return db.select().from(t.eventSteps).where(inArray(t.eventSteps.eventId, eventIds)).orderBy(asc(t.eventSteps.at), asc(t.eventSteps.id));
}

/**
 * Pièces jointes d'un événement (photos du signalement, constats, rapports…), les plus anciennes d'abord, et pièces
 * médicales d'un AT (attachments.health, SEC-06) : jamais transmises à un rôle non habilité (`health` faux : medical vide).
 */
export async function loadEventAttachments(eventId: string, health: boolean): Promise<{ files: AttachmentItem[]; medical: AttachmentItem[] }> {
  const db = await getDb();
  const rows = await db.select().from(t.attachments)
    .where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, eventId)))
    .orderBy(asc(t.attachments.createdAt));
  const item = (r: (typeof rows)[number]): AttachmentItem => ({ id: r.id, name: r.fileName, mime: r.mimeType, size: r.size, url: attachmentUrl(r.id), isImage: r.mimeType.startsWith('image/') });
  return { files: rows.filter((r) => !r.health).map(item), medical: health ? rows.filter((r) => r.health).map(item) : [] };
}

// ─── Registre des accidents bénins (EVT-04) ─────────────────────────────────

/** Secouriste du travail de l'effectif : titre de secourisme valide à la date donnée (échéance du titre, null = sans échéance). */
export type FirstAider = { id: string; name: string; until: string | null };

/**
 * Secouristes du travail d'un site à une date (sans contrôle de session : appelé par les server actions) : personnes du
 * site (ou sans site) présentes à l'effectif ce jour-là, dont la dernière formation non annulée d'un titre de secourisme
 * (training_titles.first_aid ; à défaut, titre « SST » ou « sauveteur secouriste » d'après son libellé) obtenue au plus tard
 * ce jour-là est encore valide. Triés par nom.
 */
export async function loadFirstAiders(siteId: string, onIso: string): Promise<FirstAider[]> {
  const db = await getDb();
  const titles = await db.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, firstAid: t.trainingTitles.firstAid })
    .from(t.trainingTitles).where(isNull(t.trainingTitles.archivedAt));
  const flagged = titles.filter((x) => x.firstAid);
  const ids = (flagged.length ? flagged : titles.filter((x) => FIRST_AID_TITLE_FALLBACK.test(x.label))).map((x) => x.id);
  if (!ids.length) return [];
  const [people, quals] = await Promise.all([
    db.select({ id: t.people.id, name: t.people.name, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people),
    db.select({ id: t.qualifications.id, personId: t.qualifications.personId, titleId: t.qualifications.titleId, obtainedOn: t.qualifications.obtainedOn, expiresOn: t.qualifications.expiresOn })
      .from(t.qualifications).where(and(inArray(t.qualifications.titleId, ids), isNull(t.qualifications.cancelledAt))),
  ]);
  // Dernière formation de chaque (personne, titre) obtenue au plus tard à la date.
  const latest = new Map<string, (typeof quals)[number]>();
  for (const q of quals) {
    if (q.obtainedOn > onIso) continue;
    const key = `${q.personId}|${q.titleId}`;
    const cur = latest.get(key);
    if (!cur || q.obtainedOn > cur.obtainedOn || (q.obtainedOn === cur.obtainedOn && q.id > cur.id)) latest.set(key, q);
  }
  const until = new Map<string, string | null>();
  for (const q of latest.values()) {
    if (q.expiresOn && q.expiresOn < onIso) continue;
    const prev = until.get(q.personId);
    // Plusieurs titres valides : l'échéance la plus lointaine (sans échéance d'abord).
    if (!until.has(q.personId) || (prev !== null && (q.expiresOn === null || q.expiresOn > prev!))) until.set(q.personId, q.expiresOn);
  }
  return people
    .filter((p) => until.has(p.id) && (!p.siteId || p.siteId === siteId) && !(p.leftOn && p.leftOn <= onIso))
    .map((p) => ({ id: p.id, name: p.name, until: until.get(p.id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Choix « Secouriste de l'effectif » : « Nom · SST valide jusqu'au … ». */
export const firstAiderOption = (a: FirstAider): Option => [a.id, `${a.name} · SST valide ${a.until ? `jusqu'au ${fmtDate(a.until)}` : 'sans échéance'}`];

type BenignRow = typeof t.benignAccidents.$inferSelect;

/** Donneur de soins d'une inscription : secouriste de l'effectif (nom) ou professionnel de santé déclaré, avec sa qualité. */
const caregiverOf = (r: BenignRow, people: Map<string, Person>) => ({
  caregiver: r.caregiverId ? people.get(r.caregiverId)?.name ?? r.caregiverId : r.caregiverName ?? '—',
  qualification: BENIGN_CAREGIVER_KINDS[r.caregiverQualification as BenignCaregiverKind] ?? r.caregiverQualification,
});

/** Inscription au registre telle qu'affichée sur la fiche d'un AT (rôles habilités). */
export type BenignEntryView = {
  id: number; number: number; siteId: string; careGivenAt: string; care: string; caregiver: string; qualification: string;
  signedOn: string | null; escalatedAt: string | null; createdOn: string;
};

type BenignEntry = BenignEntryView & { escalatedOn: Date | null };
/** Inscription transmise à la page : sans l'instant de bascule (servi au calcul de l'échéance CPAM). */
const benignView = ({ escalatedOn, ...view }: BenignEntry): BenignEntryView => (void escalatedOn, view);

/** Inscription active (non annulée) d'un événement au registre des accidents bénins, ou null. */
export async function activeBenignEntry(eventId: string, people?: Map<string, Person>): Promise<BenignEntry | null> {
  const db = await getDb();
  const [[r], persons] = await Promise.all([
    db.select().from(t.benignAccidents).where(and(eq(t.benignAccidents.eventId, eventId), isNull(t.benignAccidents.cancelledAt))),
    people ?? loadPeople(),
  ]);
  if (!r) return null;
  return {
    id: r.id, number: r.number, siteId: r.siteId, careGivenAt: toParisLocal(r.careGivenAt), care: r.care, ...caregiverOf(r, persons),
    signedOn: r.signedOn, escalatedAt: r.escalatedAt ? toParisLocal(r.escalatedAt) : null, escalatedOn: r.escalatedAt, createdOn: isoDay(r.createdAt),
  };
}

/** Rattachement affiché sur la fiche (lien vers le module concerné). */
export type EventLink = { id: string; label: string; href: string; status?: { label: string; tone: Tone } };
export type EventLinks = Partial<Record<'control' | 'risk' | 'document' | 'plan' | 'permit', EventLink>>;

/** Rattachements d'un événement vers les contrôles, le DUERP, les documents et la prévention (lus sans filtre de site). */
async function loadLinks(e: typeof t.events.$inferSelect, now: string): Promise<EventLinks> {
  const db = await getDb();
  const [[control], [risk], [doc], [plan], [permit]] = await Promise.all([
    e.controlId != null ? db.select().from(t.controls).where(eq(t.controls.id, e.controlId)) : [],
    e.riskId != null
      ? db.select({ id: t.risks.id, hazard: t.risks.hazard, situation: t.risks.situation, unitId: t.risks.unitId, unit: t.workUnits.label, archivedAt: t.risks.archivedAt })
        .from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.risks.id, e.riskId))
      : [],
    e.documentId ? db.select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(eq(t.documents.id, e.documentId)) : [],
    e.preventionPlanId ? db.select({ id: t.preventionPlans.id, title: t.preventionPlans.title }).from(t.preventionPlans).where(eq(t.preventionPlans.id, e.preventionPlanId)) : [],
    e.permitId ? db.select({ id: t.permits.id, description: t.permits.description }).from(t.permits).where(eq(t.permits.id, e.permitId)) : [],
  ]);
  const links: EventLinks = {};
  if (control) {
    links.control = {
      id: String(control.id), label: `${control.controlType} · ${control.equipment}`,
      href: `/veille?onglet=controles&controle=${control.id}`,
      status: control.archivedAt ? { label: 'Équipement réformé', tone: 'neutral' } : controlStatus(control, now),
    };
  }
  if (risk) links.risk = { id: String(risk.id), label: clip(`${risk.archivedAt ? 'Archivé · ' : ''}${risk.unit} · ${risk.hazard} — ${risk.situation}`), href: `/risques?risque=${risk.id}` };
  if (doc) links.document = { id: doc.id, label: `${doc.id} · ${doc.title}`, href: `/documents?doc=${encodeURIComponent(doc.id)}` };
  if (plan) links.plan = { id: plan.id, label: clip(`${plan.id} · ${plan.title}`), href: `/prevention?plan=${encodeURIComponent(plan.id)}` };
  if (permit) links.permit = { id: permit.id, label: clip(`${permit.id} · ${permit.description}`), href: `/prevention?onglet=permis&permis=${encodeURIComponent(permit.id)}` };
  return links;
}

/**
 * Enlèvements du registre des déchets consécutifs à l'événement (champ « Événement lié » de l'enlèvement), annulés compris :
 * lien vers le registre de l'année, filtré sur la filière (vue « Annulés » pour un enlèvement annulé).
 */
async function loadWasteEntries(eventId: string): Promise<EventLink[]> {
  const db = await getDb();
  const rows = await db.select({
    id: t.wasteEntries.id, removedOn: t.wasteEntries.removedOn, quantity: t.wasteEntries.quantity, cancelledAt: t.wasteEntries.cancelledAt,
    streamId: t.wasteStreams.id, stream: t.wasteStreams.label, unit: t.wasteStreams.unit,
  }).from(t.wasteEntries).innerJoin(t.wasteStreams, eq(t.wasteEntries.streamId, t.wasteStreams.id))
    .where(eq(t.wasteEntries.eventId, eventId)).orderBy(asc(t.wasteEntries.removedOn), asc(t.wasteEntries.id));
  return rows.map((r) => ({
    id: String(r.id),
    label: `${fmtDate(r.removedOn)} · ${r.stream} · ${fmtQty(r.quantity, r.unit)}`,
    href: wasteEntryHref({ id: r.id, removedOn: r.removedOn, streamId: r.streamId, cancelled: !!r.cancelledAt }),
    status: r.cancelledAt ? { label: 'Annulé', tone: 'neutral' } : undefined,
  }));
}

/** Entrée de l'historique du workflow, sérialisable. */
export type EventHistoryEntry = { id: number; kind: EventTransition; label: string; icon: string; from: string; to: string; reason: string | null; by: string; at: string };

/**
 * Déclaration CPAM d'un AT (rôles habilités) : date de déclaration et réserves motivées, absence de déclaration motivée,
 * inscription au registre des accidents bénins, ou échéance du délai de 48 h (EVT-03) — de l'inscription au registre d'un
 * accident bénin, ou de l'information de l'ETT (24 h) pour un intérimaire ; aucune échéance pour une victime extérieure
 * (son employeur déclare). `canWaive` : obligation encore ouverte, que l'animateur QHSE ou la direction peuvent motiver
 * (EVT-02) ; `duty` : qui déclare selon la victime (declarationDuty).
 */
export type CpamState = {
  declaredOn: string | null; dueOn: string | null; tone: Tone; label: string;
  waiver: { reason: string; by: string; on: string } | null;
  reserves: { on: string | null; dueOn: string; tone: Tone; label: string } | null;
  canWaive: boolean;
  duty: DeclarationDuty;
} | null;

type EventRow = typeof t.events.$inferSelect;

const WAIVED_LABEL: Record<DeclarationDuty, string> = {
  cpam: "Non déclarée par l'entreprise",
  ett: "Déclaration par l'entreprise de travail temporaire",
  employer: "Déclaration par l'employeur de la victime",
};

function cpamState(e: EventRow, entry: { number: number; escalatedOn: Date | null } | null, site: { alsaceMoselle: boolean } | undefined, now: string, nameOf: (pid: string | null) => string): CpamState {
  if (e.type !== 'AT') return null;
  const opts = { alsaceMoselle: !!site?.alsaceMoselle };
  const duty = declarationDuty(e);
  const base = { declaredOn: null, dueOn: null, waiver: null, reserves: null, canWaive: cpamPending(e, !!entry), duty };
  if (e.injury === 'soins' && entry) return { ...base, tone: 'neutral', label: `Non requise · inscrit au registre des accidents bénins (n° ${entry.number})` };
  if (e.cpamWaivedAt) {
    return { ...base, tone: 'neutral', label: WAIVED_LABEL[duty], waiver: { reason: e.cpamWaiverReason ?? '', by: nameOf(e.cpamWaivedById), on: isoDay(e.cpamWaivedAt) } };
  }
  if (e.cpamDeclaredOn) {
    const dueOn = reservesDeadline(e.cpamDeclaredOn, opts);
    const reserves = e.reservesOn
      ? { on: e.reservesOn, dueOn, tone: 'ok' as Tone, label: `Réserves motivées adressées le ${fmtDate(e.reservesOn)}` }
      : now <= dueOn
        ? { on: null, dueOn, tone: 'neutral' as Tone, label: `Réserves motivées possibles jusqu'au ${fmtDate(dueOn)} (10 jours francs)` }
        : { on: null, dueOn, tone: 'neutral' as Tone, label: `Délai de réserves dépassé le ${fmtDate(dueOn)}` };
    return { ...base, declaredOn: e.cpamDeclaredOn, tone: 'ok', label: `Déclarée le ${fmtDate(e.cpamDeclaredOn)}`, reserves };
  }
  if (duty === 'employer') {
    return { ...base, tone: 'neutral', label: "Déclarée par l'employeur de la victime : à indiquer (motif) avant la clôture" };
  }
  const due = duty === 'ett' ? ettDeadline(cpamBasis(e)) : cpamDeadline(cpamBasis(e, entry?.escalatedOn), opts);
  const tone: Tone = due.date < now ? 'danger' : 'warn';
  if (duty === 'ett') {
    return { ...base, dueOn: due.date, tone, label: `ETT à informer ${fmtDeadline(due)} (copie CARSAT et inspection du travail) : elle déclare l'accident` };
  }
  if (e.injury === 'soins') return { ...base, dueOn: due.date, tone, label: `Accident bénin : à inscrire au registre ou à déclarer ${fmtDeadline(due)}` };
  return { ...base, dueOn: due.date, tone, label: `À déclarer ${fmtDeadline(due)}` };
}

/** Questionnaire employeur d'une maladie professionnelle (R. 461-9 CSS) : retourné, à retourner (30 jours francs) ou non reçu. */
export function mpQuestionnaireState(e: Pick<EventRow, 'mpQuestionnaireReceivedOn' | 'mpQuestionnaireReturnedOn'>, site: { alsaceMoselle: boolean } | undefined, now: string) {
  if (e.mpQuestionnaireReturnedOn) return { dueOn: null, tone: 'ok' as Tone, label: `Retourné le ${fmtDate(e.mpQuestionnaireReturnedOn)}` };
  if (!e.mpQuestionnaireReceivedOn) return { dueOn: null, tone: 'neutral' as Tone, label: 'Non reçu' };
  const dueOn = mpQuestionnaireDeadline(e.mpQuestionnaireReceivedOn, { alsaceMoselle: !!site?.alsaceMoselle });
  return { dueOn, tone: (dueOn < now ? 'danger' : 'warn') as Tone, label: `Reçu le ${fmtDate(e.mpQuestionnaireReceivedOn)} · à retourner au plus tard le ${fmtDate(dueOn)}` };
}

/**
 * Événements consultables sur /evenements (site sélectionné, classés sans suite compris), du plus récent au plus ancien :
 * le Salarié ne voit que ses propres signalements nominatifs (rapprochement par identifiant, jamais les anonymes).
 */
export const loadVisibleEvents = cache(async () => {
  const [events, { role, user }] = await Promise.all([loadSiteEvents(), getSession()]);
  return isEmployee(role) ? events.filter((e) => e.declarantId === user.id && !e.anonymous) : events;
});

/**
 * Fiche d'un événement consultable (loadVisibleEvents : site sélectionné, ses propres signalements pour le Salarié),
 * classés sans suite compris : vue, actions liées, contenus d'analyse, pièces jointes, historique du workflow,
 * rattachements et éventuel blocage du passage à l'étape suivante ; null si l'événement n'est pas consultable.
 * Données de santé (SEC-06) : retirées de la fiche (valeurs à null, `health: false`) pour un rôle non habilité.
 */
export async function loadEventDetail(id: string) {
  const db = await getDb();
  const now = today();
  const [people, events, { role, user }] = await Promise.all([loadPeople(), loadVisibleEvents(), getSession()]);
  const row = events.find((x) => x.id === id);
  if (!row) return null;
  const health = canSeeHealth(role);
  const at = row.type === 'AT';
  const mp = row.type === 'MP';
  // SEC-11 : fiche d'un accident du travail ou d'une maladie professionnelle ouverte avec ses données de santé — consultation tracée.
  if (health && (at || mp)) await logAccess({ kind: 'sante', entityType: 'event', entityId: row.id, personId: user.id });
  const e = health ? row : withoutHealth(row);
  // Les actions liées sont lues sans filtre de site : elles suivent l'événement.
  const [actions, analyses, files, steps, links, wasteEntries, entry, [site], firstAiders] = await Promise.all([
    db.select().from(t.actions).where(eq(t.actions.eventId, e.id)),
    db.select().from(t.eventAnalyses).where(eq(t.eventAnalyses.eventId, e.id)),
    loadEventAttachments(e.id, health),
    loadSteps([e.id]),
    loadLinks(e, now),
    loadWasteEntries(e.id),
    // Registre des accidents bénins : donnée de santé, lue pour les rôles habilités seulement.
    health && at ? activeBenignEntry(e.id, people) : null,
    db.select({ label: t.sites.label, alsaceMoselle: t.sites.alsaceMoselle }).from(t.sites).where(eq(t.sites.id, e.siteId)),
    health && at && row.injury === 'soins' ? loadFirstAiders(e.siteId, now) : [],
  ]);
  const content = Object.fromEntries(analyses.map((a) => [a.method, a.content])) as Record<string, unknown>;
  const methodLabel = METHODS.find(([k]) => k === e.analysisMethod)?.[1] ?? e.analysisMethod;
  const name = (pid: string | null) => (pid ? people.get(pid)?.name ?? pid : 'Vigie');
  const history: EventHistoryEntry[] = steps.map((r) => {
    const kind = (r.kind in EVENT_TRANSITIONS ? r.kind : 'advance') as EventTransition;
    return {
      id: r.id, kind, ...EVENT_TRANSITIONS[kind], from: EVENT_STEPS[r.fromStep] ?? '—', to: EVENT_STEPS[r.toStep] ?? '—',
      reason: r.reason, by: name(r.byId), at: r.at.toISOString(),
    };
  });
  const dismissStep = [...steps].reverse().find((r) => r.kind === 'dismiss');
  const missing = missingQualification(row);
  const lock = eventLockReason(e);
  // Blocage calculé sur la ligne complète : pour un rôle non habilité, la clôture d'un AT renvoie AT_CLOSE_RESTRICTED,
  // sans rien dire de la déclaration (SEC-06).
  const blocker = advanceBlocker(row.step, actions, {
    pilotId: row.pilotId, hasAnalysis: analysisFilled(row.analysisMethod, content[row.analysisMethod]), dismissed: !!row.dismissedAt, methodLabel, missing,
    canCreateActions: canCreateAction(role),
    accident: at ? { health, cpamPending: health && cpamPending(row, !!entry), benign: health && row.injury === 'soins', duty: declarationDuty(row) } : undefined,
  });
  // Registre des accidents bénins : premiers soins non déclarés, victime de l'effectif, mentions du registre saisies.
  const registerBlocker = at && health && !entry && !lock ? benignRegisterBlocker(row) : null;
  return {
    event: eventView(e, people, now),
    actions: actions.sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true })).map((a) => actionView(a, people, now)),
    analyses: content,
    attachments: files.files,
    /** Pièces médicales d'un AT (rôles habilités ; vide sinon). */
    medical: files.medical,
    blocker,
    lock,
    /** Données exigées à la qualification et non saisies (EVT-05). */
    missing,
    history,
    stepDates: stepDatesOf(steps, e.createdAt, e.step),
    links,
    wasteEntries,
    /**
     * Rubriques de la déclaration d'un AT (EVT-01), hors données de santé : victime, heure, horaire, connaissance par
     * l'employeur (départ du délai de 48 h ; à défaut, l'enregistrement dans Vigie), activité, circonstances, témoins, tiers.
     * Non transmises au Salarié (fiche déclarant).
     */
    accident: at && !isEmployee(role) ? {
      victim: victimLabel(row, (pid) => name(pid)), victimKind: victimKindLabel(row.victimKind), occurredTime: row.occurredTime, workSchedule: row.workSchedule,
      knownAt: { local: toParisLocal(row.knownAt ?? row.createdAt), isDefault: !row.knownAt },
      activity: row.activity, circumstances: row.circumstances, witnesses: row.witnesses, thirdParty: row.thirdParty,
    } : null,
    /**
     * Registre des accidents bénins (rôles habilités, AT) : inscription active, inscription possible, secouristes du site ;
     * `hint` : pourquoi un accident bénin non déclaré ne peut pas encore être inscrit (mentions manquantes, intérimaire,
     * victime extérieure), null sinon.
     */
    register: health && at ? {
      entry: entry ? benignView(entry) : null,
      canRegister: !entry && !lock && !registerBlocker,
      hint: row.injury === 'soins' && !row.cpamDeclaredOn ? registerBlocker : null,
      firstAiders: firstAiders.map(firstAiderOption),
      href: `${BENIGN_REGISTER_PATH}?site=${encodeURIComponent(row.siteId)}`,
    } : null,
    cpam: health ? cpamState(row, entry, site, now, name) : null,
    /**
     * Maladie professionnelle (EVT-09, rôles habilités : le type n'est chargé que pour eux) : victime, tableau, maladie,
     * certificat médical initial, information par la caisse et questionnaire employeur (30 jours francs, R. 461-9 CSS).
     */
    occupational: mp && health ? {
      victim: victimLabel(row, (pid) => name(pid)), victimKind: victimKindLabel(row.victimKind),
      table: row.mpTable, disease: row.mpDisease, certificateOn: row.mpCertificateOn, informedOn: row.mpInformedOn,
      questionnaire: mpQuestionnaireState(row, site, now),
    } : null,
    /** Données de santé transmises (rôle habilité) ; sinon « Données restreintes ». */
    health,
    dismissal: e.dismissedAt
      ? { on: isoDay(e.dismissedAt), by: name(e.dismissedById ?? dismissStep?.byId ?? null), reason: e.dismissReason ?? dismissStep?.reason ?? '' }
      : null,
  };
}
export type EventDetail = NonNullable<Awaited<ReturnType<typeof loadEventDetail>>>;

/**
 * Journal des modifications d'un événement. Rôle non habilité aux données de santé (SEC-06) : les champs correspondants
 * sont retirés, et une modification qui ne portait que sur eux disparaît. Une pièce jointe reclassée ensuite en pièce
 * médicale garde au journal son ajout sous « Fichier » : son nom (ex. arrêt de travail nommant la victime) est retiré
 * d'après les noms des pièces médicales du journal (ajout, reclassement, retrait), sans réécrire les entrées enregistrées.
 */
export async function loadEventChangeLog(id: string): Promise<ChangeEntry[]> {
  const [{ role }, log] = await Promise.all([getSession(), loadChangeLog('event', id)]);
  if (canSeeHealth(role)) return log;
  const medical = new Set(log.flatMap((e) => e.details.filter((d) => d.field === HEALTH_FILE_FIELD).flatMap((d) => [d.from, d.to]))
    .filter((name): name is string => !!name));
  const isMedicalFile = (d: ChangeEntry['details'][number]) =>
    d.field === 'Fichier' && ((d.from != null && medical.has(d.from)) || (d.to != null && medical.has(d.to)));
  return log.flatMap((entry) => {
    const details = entry.details.filter((d) => !HEALTH_LOG_FIELDS.includes(d.field) && !isMedicalFile(d));
    return details.length || !entry.details.length ? [{ ...entry, details }] : [];
  });
}

/** Date de clôture (dernier passage à « Clôturé ») des événements donnés : identifiant → date ISO. */
export async function loadEventClosures(ids: string[]): Promise<Map<string, string>> {
  const rows = (await loadSteps(ids)).filter((r) => r.kind === 'advance' && r.toStep === STEP_CLOSED);
  return new Map(rows.map((r) => [r.eventId, isoDay(r.at)]));
}

/**
 * Listes de choix des rattachements d'un événement (site sélectionné) : équipements contrôlés, risques du DUERP,
 * documents maîtrisés, plans de prévention et permis non annulés.
 */
export const loadEventLinkOptions = cache(async () => {
  const db = await getDb();
  const site = await currentSiteId();
  const [controls, risks, docs, plans, permits] = await Promise.all([
    loadControls(),
    // Risques en vigueur du DUERP (unités et risques archivés exclus).
    db.select({ id: t.risks.id, hazard: t.risks.hazard, situation: t.risks.situation, unit: t.workUnits.label, siteId: t.workUnits.siteId })
      .from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id))
      .where(and(isNull(t.risks.archivedAt), isNull(t.workUnits.archivedAt))).orderBy(asc(t.workUnits.sort), asc(t.risks.sort)),
    db.select({ id: t.documents.id, title: t.documents.title, siteId: t.documents.siteId }).from(t.documents).orderBy(asc(t.documents.id)),
    db.select({ id: t.preventionPlans.id, title: t.preventionPlans.title, siteId: t.preventionPlans.siteId, status: t.preventionPlans.status }).from(t.preventionPlans).orderBy(desc(t.preventionPlans.id)),
    db.select({ id: t.permits.id, description: t.permits.description, siteId: t.permits.siteId, status: t.permits.status }).from(t.permits).orderBy(desc(t.permits.id)),
  ]);
  return {
    controls: controls.map((c) => [String(c.id), clip(`${c.controlType} · ${c.equipment}`)] as Option),
    risks: risks.filter((r) => inSite(site, r.siteId)).map((r) => [String(r.id), clip(`${r.unit} · ${r.hazard} — ${r.situation}`)] as Option),
    documents: docs.filter((d) => inSite(site, d.siteId)).map((d) => [d.id, clip(`${d.id} · ${d.title}`)] as Option),
    plans: plans.filter((p) => p.status !== 'annule' && inSite(site, p.siteId)).map((p) => [p.id, clip(`${p.id} · ${p.title}`)] as Option),
    permits: permits.filter((p) => p.status !== 'annule' && inSite(site, p.siteId)).map((p) => [p.id, clip(`${p.id} · ${p.description}`)] as Option),
  };
});
export type EventLinkOptions = Awaited<ReturnType<typeof loadEventLinkOptions>>;

// ─── Parcours terrain : « Mes signalements » ────────────────────────────────

/**
 * Signalements nominatifs déclarés par l'utilisateur courant, tous sites confondus (rapprochement par identifiant).
 * Les signalements anonymes ne portent pas de déclarant : ils ne peuvent pas, par conception, être retrouvés ici.
 */
export async function loadMyReports() {
  const db = await getDb();
  const { user } = await getSession();
  const [events, sites, photos] = await Promise.all([
    db.select().from(t.events).where(and(eq(t.events.declarantId, user.id), eq(t.events.anonymous, false))),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    // Pièces médicales (attachments.health) exclues : jamais comptées pour le déclarant (SEC-06).
    db.select({ entityId: t.attachments.entityId, mime: t.attachments.mimeType }).from(t.attachments).where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.health, false))),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  return events
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((e) => {
      const type = EVENT_TYPES[e.type as EventType];
      return {
        id: e.id, occurredOn: e.occurredOn, title: e.title, location: e.location, step: e.step,
        typeLabel: type.label, typeTone: type.tone, typeIcon: type.icon,
        siteId: e.siteId, siteLabel: siteLabel.get(e.siteId) ?? e.siteId, dismissed: !!e.dismissedAt,
        photoCount: photos.filter((p) => p.entityId === e.id && p.mime.startsWith('image/')).length,
      };
    });
}
export type MyReport = Awaited<ReturnType<typeof loadMyReports>>[number];

/**
 * Détail d'un signalement pour son déclarant (retour d'information) : étape et dates, description, mesures immédiates,
 * actions décidées (libellé court et avancement). Ni l'analyse des causes ni le pilote ne sont transmis. null si ce n'est
 * pas le sien.
 */
export async function loadMyReport(id: string) {
  const db = await getDb();
  const now = today();
  const { user } = await getSession();
  const [[e], people] = await Promise.all([
    db.select().from(t.events).where(and(eq(t.events.id, id), eq(t.events.declarantId, user.id), eq(t.events.anonymous, false))),
    loadPeople(),
  ]);
  if (!e) return null;
  const [[site], actions, photos, steps] = await Promise.all([
    db.select({ label: t.sites.label }).from(t.sites).where(eq(t.sites.id, e.siteId)),
    db.select().from(t.actions).where(eq(t.actions.eventId, e.id)),
    db.select({ mime: t.attachments.mimeType }).from(t.attachments).where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, e.id), eq(t.attachments.health, false))),
    loadSteps([e.id]),
  ]);
  const type = EVENT_TYPES[e.type as EventType];
  return {
    id: e.id, title: e.title, location: e.location, siteLabel: site?.label.split(' — ')[0] ?? e.siteId,
    typeLabel: type.label, typeTone: type.tone, typeIcon: type.icon,
    occurredOn: e.occurredOn, createdOn: isoDay(e.createdAt), step: e.step, stepDates: stepDatesOf(steps, e.createdAt, e.step),
    description: e.description, immediateMeasures: e.immediateMeasures,
    photoCount: photos.filter((p) => p.mime.startsWith('image/')).length,
    dismissed: e.dismissedAt ? { on: isoDay(e.dismissedAt), reason: e.dismissReason ?? '' } : null,
    actions: actions
      .sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true }))
      // Libellé court (actionLabel) et avancement (§ 5.1) seulement : ni problème, ni responsable, ni retard.
      .map((a) => { const v = actionView(a, people, now); return { id: a.id, label: v.label, avancement: v.avancement, tone: AVANCEMENT[a.status].tone }; }),
  };
}
export type MyReportDetail = NonNullable<Awaited<ReturnType<typeof loadMyReport>>>;

// ─── QR codes de poste ──────────────────────────────────────────────────────

// Postes, jetons signés et résolution des QR codes : src/lib/data/report-posts.ts ; adresse publique des QR codes :
// publicOrigin() (src/lib/public-url.ts, VIGIE_PUBLIC_URL, jamais l'en-tête Host — PRD-07).

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances des événements :
 * - signalements à qualifier sous QUALIFY_DELAY_DAYS après la déclaration (createdAt) — dépassé : danger ;
 * - accidents du travail à déclarer à la CPAM dans les 48 h de leur connaissance, dimanches et fériés non compris (EVT-03 :
 *   knownAt, sinon createdAt ; après une bascule depuis le registre des accidents bénins, date de connaissance de l'arrêt
 *   ou des soins), tant que la déclaration n'est ni saisie ni motivée, clôturés compris (EVT-02) : donnée de santé (SEC-06),
 *   échéance réservée aux rôles habilités (`health`), adressée au pilote si son dernier rôle connu l'est, sinon au
 *   responsable QHSE du site (animateurs QHSE si le poste est vacant). Réserves motivées : information de la fiche seulement.
 *   Selon la victime (declarationDuty) : accident bénin (premiers soins) à inscrire au registre ou à déclarer dans le même
 *   délai de 48 h ; intérimaire : entreprise de travail temporaire à informer sous 24 h (R. 412-2 CSS), close par le motif
 *   d'absence de déclaration ; victime extérieure : aucune échéance.
 * Les classés sans suite sont exclus (loadEvents). Tous les sites du périmètre (TDB-05) : siteId de l'événement.
 */
export const loadEventSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const db = await getDb();
  const [events, people, leads, sites, register] = await Promise.all([
    loadEvents('perimeter'), loadPeople(), loadQhseLeads(),
    db.select({ id: t.sites.id, alsaceMoselle: t.sites.alsaceMoselle }).from(t.sites),
    db.select({ eventId: t.benignAccidents.eventId, escalatedAt: t.benignAccidents.escalatedAt }).from(t.benignAccidents).where(isNull(t.benignAccidents.cancelledAt)),
  ]);
  const alsaceMoselle = new Map(sites.map((s) => [s.id, s.alsaceMoselle]));
  const escalatedAt = new Map(register.map((r) => [r.eventId, r.escalatedAt]));
  const now = today();
  const todo: TodoItem[] = [];
  const who = (pid: string) => people.get(pid)?.name ?? '';
  const healthOwner = (pid: string | null) => {
    const r = pid ? people.get(pid)?.lastRole : null;
    return !!r && canSeeHealth(r as Role);
  };
  for (const e of events) {
    const href = `/evenements?sel=${e.id}`;
    // Sans pilote désigné : le responsable QHSE du site (ou les animateurs QHSE si le poste est vacant).
    const lead = leads.forSite(e.siteId);
    if (e.step === 0) {
      const due = addDays(isoDay(e.createdAt), QUALIFY_DELAY_DAYS);
      todo.push({
        date: due, dueOn: due, kind: 'Signalement à qualifier', tone: due < now ? 'danger' : 'warn', title: `${e.id} · ${e.title}`, siteId: e.siteId,
        who: e.pilotId ? who(e.pilotId) : lead.who, href, ownerIds: e.pilotId ? [e.pilotId] : lead.ownerIds, overdue: due < now,
      });
    }
    // Déclaration d'un AT selon la victime (declarationDuty), tant qu'elle n'est ni saisie ni motivée : CPAM sous 48 h,
    // accident bénin à inscrire au registre (ou à déclarer) sous 48 h, ETT à informer sous 24 h ; rien pour une victime
    // extérieure (son employeur déclare). `escalatedAt` porte les inscriptions actives au registre.
    if (e.type === 'AT' && !e.cpamDeclaredOn && !e.cpamWaivedAt) {
      const duty = declarationDuty(e);
      const registered = escalatedAt.has(e.id);
      const opts = { alsaceMoselle: alsaceMoselle.get(e.siteId) };
      const deadline = needsCpam(e) ? { kind: 'Déclaration AT à la CPAM', date: cpamDeadline(cpamBasis(e, escalatedAt.get(e.id)), opts).date }
        : duty === 'ett' && !(e.injury === 'soins' && registered) ? { kind: "Information de l'ETT (AT d'un intérimaire)", date: ettDeadline(cpamBasis(e)).date }
          : duty === 'cpam' && e.injury === 'soins' && !registered ? { kind: 'Inscription au registre des accidents bénins', date: cpamDeadline(cpamBasis(e), opts).date }
            : null;
      if (deadline) {
        const due = deadline.date;
        const pilot = e.pilotId && healthOwner(e.pilotId) ? e.pilotId : null;
        const owners = [...new Set([...lead.ownerIds, ...(pilot ? [pilot] : [])])];
        todo.push({
          date: due, dueOn: due, kind: deadline.kind, tone: due < now ? 'danger' : 'warn', title: `${e.id} · ${e.title}`, siteId: e.siteId,
          who: pilot ? who(pilot) : lead.who, href, ownerIds: owners, overdue: due < now, health: true,
        });
      }
    }
    // Maladie professionnelle (EVT-09) : questionnaire employeur reçu, à retourner sous 30 jours francs (R. 461-9 CSS) ;
    // donnée de santé (`health`) — l'événement n'est d'ailleurs chargé que pour les rôles habilités.
    if (e.type === 'MP' && e.mpQuestionnaireReceivedOn && !e.mpQuestionnaireReturnedOn) {
      const due = mpQuestionnaireDeadline(e.mpQuestionnaireReceivedOn, { alsaceMoselle: alsaceMoselle.get(e.siteId) });
      const pilot = e.pilotId && healthOwner(e.pilotId) ? e.pilotId : null;
      todo.push({
        date: due, dueOn: due, kind: 'Questionnaire maladie professionnelle', tone: due < now ? 'danger' : 'warn', title: `${e.id} · ${e.title}`,
        siteId: e.siteId, who: pilot ? who(pilot) : lead.who, href, ownerIds: [...new Set([...lead.ownerIds, ...(pilot ? [pilot] : [])])], overdue: due < now, health: true,
      });
    }
  }
  return { todo };
});

/**
 * Registre des accidents du travail bénins d'un site (EVT-04, page imprimable /evenements/registre-benin) : animateur QHSE
 * et direction seulement (null sinon), site du périmètre (null hors périmètre ou inconnu). Sans site : liste des sites du
 * périmètre (choix). Inscriptions annulées comprises (numéro jamais réattribué), par numéro d'ordre ; `year` : soins de
 * l'année seulement.
 */
export async function loadBenignRegister(siteId: string | null, year?: number) {
  const { role, allowedSiteIds, siteOptions, user } = await getSession();
  if (!canSeeHealth(role)) return null;
  const sites = siteOptions.filter((s) => s.id !== ALL_SITES);
  if (!siteId) return { site: null, sites, entries: [], years: [] as number[], year: null as number | null, firstAiders: [] as FirstAider[] };
  if (!inPerimeter(allowedSiteIds, siteId)) return null;
  const db = await getDb();
  const now = today();
  const [[site], rows, people, firstAiders] = await Promise.all([
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites).where(eq(t.sites.id, siteId)),
    db.select({ entry: t.benignAccidents, event: t.events }).from(t.benignAccidents)
      .innerJoin(t.events, eq(t.events.id, t.benignAccidents.eventId))
      .where(eq(t.benignAccidents.siteId, siteId)).orderBy(asc(t.benignAccidents.number)),
    loadPeople(),
    loadFirstAiders(siteId, now),
  ]);
  if (!site) return null;
  // SEC-11 : registre (données de santé) ouvert — consultation tracée.
  await logAccess({ kind: 'registre_benin', entityType: 'site', entityId: site.id, personId: user.id });
  const name = (pid: string | null) => (pid ? people.get(pid)?.name ?? pid : '—');
  const yearOf = (r: (typeof rows)[number]) => +toParisLocal(r.entry.careGivenAt).slice(0, 4);
  const years = [...new Set(rows.map(yearOf))].sort((a, b) => b - a);
  const entries = rows.filter((r) => !year || yearOf(r) === year).map(({ entry: r, event: e }) => ({
    id: r.id, number: r.number, ref: e.id, occurredOn: e.occurredOn, occurredTime: e.occurredTime,
    victim: victimLabel(e, name), location: e.location, circumstances: e.circumstances, lesionNature: e.lesionNature, lesionSite: e.lesionSite,
    witnesses: e.witnesses, care: r.care, ...caregiverOf(r, people), careGivenAt: toParisLocal(r.careGivenAt), signedOn: r.signedOn,
    // Date d'inscription (délai de 48 h, dimanches et fériés non compris).
    registeredOn: isoDay(r.createdAt),
    escalated: r.escalatedAt ? { at: toParisLocal(r.escalatedAt), injuryLabel: injuryLabel(e.injury), cpamDeclaredOn: e.cpamDeclaredOn } : null,
    cancelled: r.cancelledAt ? { on: isoDay(r.cancelledAt), by: name(r.cancelledById), reason: r.cancelReason ?? '' } : null,
  }));
  return { site: { id: site.id, label: site.label.split(' — ')[0] }, sites, entries, years, year: year ?? null, firstAiders };
}
export type BenignRegister = NonNullable<Awaited<ReturnType<typeof loadBenignRegister>>>;

/**
 * Valeurs proposées à « Nouvel événement » ouvert depuis un plan de prévention ou un permis (?plan=, ?permis=) :
 * site et lieu repris de l'intervention ; un identifiant inconnu ou hors du site sélectionné est ignoré.
 */
export async function loadNewEventDefaults(planId: string | undefined, permitId: string | undefined) {
  const db = await getDb();
  const site = await currentSiteId();
  const [[permit], [planRow]] = await Promise.all([
    permitId ? db.select().from(t.permits).where(eq(t.permits.id, permitId)) : [],
    planId ? db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, planId)) : [],
  ]);
  const p = permit && inSite(site, permit.siteId) ? permit : undefined;
  const pp = planRow && inSite(site, planRow.siteId) && (!p || p.siteId === planRow.siteId) ? planRow : undefined;
  if (!p && !pp) return null;
  return {
    siteId: p?.siteId ?? pp!.siteId,
    location: p?.location ?? pp!.location,
    permitId: p?.id ?? null,
    preventionPlanId: pp?.id ?? p?.preventionPlanId ?? null,
  };
}

// ─── Synthèse imprimable de la DAT et feuille d'accident (EVT-10) ───────────

/**
 * Rubriques de la déclaration d'accident du travail (Cerfa 14463, saisie sur net-entreprises.fr) et de la feuille
 * d'accident remise à la victime (Cerfa 11383, art. L. 441-5 CSS), pour la page imprimable /evenements/imprimer/<id> :
 * animateur QHSE et direction seulement (données de santé), accident du travail consultable (site sélectionné) ; null sinon.
 * Consultation tracée (SEC-11).
 */
export async function loadDatPrint(id: string) {
  const { role, user } = await getSession();
  if (!canSeeHealth(role)) return null;
  const events = await loadVisibleEvents();
  const e = events.find((x) => x.id === id);
  if (!e || e.type !== 'AT') return null;
  const db = await getDb();
  const [people, [site], entry] = await Promise.all([
    loadPeople(),
    db.select({ label: t.sites.label, siret: t.sites.siret, alsaceMoselle: t.sites.alsaceMoselle }).from(t.sites).where(eq(t.sites.id, e.siteId)),
    activeBenignEntry(e.id),
  ]);
  await logAccess({ kind: 'sante', entityType: 'event', entityId: e.id, personId: user.id });
  const name = (pid: string | null) => (pid ? people.get(pid)?.name ?? pid : '—');
  const victim = e.victimId ? people.get(e.victimId) : undefined;
  return {
    id: e.id, title: e.title, occurredOn: e.occurredOn, occurredTime: e.occurredTime, location: e.location, equipment: e.equipment,
    commute: e.commute, duty: declarationDuty(e),
    site: { label: site?.label ?? e.siteId, siret: site?.siret ?? null },
    victim: { label: victimLabel(e, name), kind: victimKindLabel(e.victimKind), job: victim?.job || null, company: e.victimCompany },
    workSchedule: e.workSchedule, knownAt: toParisLocal(e.knownAt ?? e.createdAt), knownIsDefault: !e.knownAt,
    activity: e.activity, circumstances: e.circumstances, witnesses: e.witnesses, thirdParty: e.thirdParty,
    injury: injuryLabel(e.injury), lostDays: e.injury === 'arret' ? e.lostDays : null,
    lesionNature: e.lesionNature, lesionSite: e.lesionSite, careGiven: e.careGiven,
    cpam: cpamState(e, entry, site, today(), name),
  };
}
export type DatPrint = NonNullable<Awaited<ReturnType<typeof loadDatPrint>>>;
