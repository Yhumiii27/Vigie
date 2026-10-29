import 'server-only';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { injuryLabel } from '@/components/events/shared';
import { EVENT_TYPES, type EventType } from '../domain';
import { fmtParisDateTime, parisDay } from '../dates';
import { getSession, inPerimeter } from '../session';

// Droit d'accès d'un salarié à ses données (SEC-13, RGPD art. 15) : vue par personne de toutes les données que Vigie
// conserve à son sujet, pour répondre à une demande d'accès. Lecture seule (aucun droit modifié ici : le rôle vient de
// Microsoft Entra ID hors démonstration) ; réservée aux rôles habilités aux données de santé (canSeeHealth : animateur
// QHSE, direction — page de HEALTH_PAGES), la vue comprenant les accidents dont la personne est victime. Personne du
// périmètre de la consultante (site de rattachement) ; chaque consultation est inscrite au journal des consultations.

const LIMIT = 200;
const fmt = (d: Date | null) => (d ? fmtParisDateTime(d) : null);

/** Personnes proposées (périmètre de la personne connectée), présentes puis sorties, par nom. */
export async function loadPersonalDataPeople() {
  const [{ allowedSiteIds }, db] = await Promise.all([getSession(), getDb()]);
  const rows = await db.select({ id: t.people.id, name: t.people.name, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).orderBy(asc(t.people.name));
  return rows.filter((p) => inPerimeter(allowedSiteIds, p.siteId)).map((p) => [p.id, p.leftOn ? `${p.name} — sorti de l'effectif` : p.name] as const);
}

/** Données d'une personne du périmètre, ou null (inconnue ou hors périmètre : rien n'est révélé). */
export async function loadPersonalData(personId: string) {
  const [{ allowedSiteIds }, db] = await Promise.all([getSession(), getDb()]);
  const [person] = await db.select().from(t.people).where(eq(t.people.id, personId));
  if (!person || !inPerimeter(allowedSiteIds, person.siteId)) return null;
  const [sites, titles, quals, requirements, events, actions, comments, attachments, documents, planItems, reviews, changes, accesses, notifications, situations, changeRequests] = await Promise.all([
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    db.select({ id: t.trainingTitles.id, label: t.trainingTitles.label }).from(t.trainingTitles),
    db.select().from(t.qualifications).where(eq(t.qualifications.personId, personId)).orderBy(desc(t.qualifications.obtainedOn)),
    db.select().from(t.qualificationRequirements).where(eq(t.qualificationRequirements.personId, personId)),
    db.select({
      id: t.events.id, siteId: t.events.siteId, type: t.events.type, title: t.events.title, occurredOn: t.events.occurredOn,
      declarantId: t.events.declarantId, victimId: t.events.victimId, pilotId: t.events.pilotId, injury: t.events.injury, lostDays: t.events.lostDays,
    }).from(t.events).where(or(eq(t.events.declarantId, personId), eq(t.events.victimId, personId), eq(t.events.pilotId, personId))).orderBy(desc(t.events.occurredOn)),
    db.select({ id: t.actions.id, siteId: t.actions.siteId, problem: t.actions.problem, status: t.actions.status, dueOn: t.actions.dueOn })
      .from(t.actions).where(eq(t.actions.pilotId, personId)).orderBy(asc(t.actions.id)),
    db.select({ id: t.actionComments.id, actionId: t.actionComments.actionId, createdAt: t.actionComments.createdAt, withdrawnAt: t.actionComments.withdrawnAt })
      .from(t.actionComments).where(eq(t.actionComments.authorId, personId)).orderBy(desc(t.actionComments.createdAt)),
    db.select({ id: t.attachments.id, entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName, createdAt: t.attachments.createdAt, health: t.attachments.health })
      .from(t.attachments).where(eq(t.attachments.uploadedBy, personId)).orderBy(desc(t.attachments.createdAt)),
    db.select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(eq(t.documents.ownerId, personId)).orderBy(asc(t.documents.id)),
    db.select({ id: t.auditPlanItems.id, year: t.auditPlanItems.year, label: t.auditPlanItems.label, detail: t.auditPlanItems.detail, ownerId: t.auditPlanItems.ownerId, auditorId: t.auditPlanItems.auditorId })
      .from(t.auditPlanItems).where(or(eq(t.auditPlanItems.ownerId, personId), eq(t.auditPlanItems.auditorId, personId))).orderBy(asc(t.auditPlanItems.id)),
    db.select({ id: t.reviews.id, reviewOn: t.reviews.reviewOn, participantIds: t.reviews.participantIds }).from(t.reviews)
      .where(sql`${t.reviews.participantIds} @> ${JSON.stringify([personId])}::jsonb`).orderBy(asc(t.reviews.reviewOn)),
    db.select({ entityType: t.changeLog.entityType, entityId: t.changeLog.entityId, summary: t.changeLog.summary, at: t.changeLog.at })
      .from(t.changeLog).where(eq(t.changeLog.byId, personId)).orderBy(desc(t.changeLog.at)).limit(LIMIT),
    db.select({ kind: t.accessLog.kind, entityType: t.accessLog.entityType, entityId: t.accessLog.entityId, at: t.accessLog.at })
      .from(t.accessLog).where(eq(t.accessLog.personId, personId)).orderBy(desc(t.accessLog.at)).limit(LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(t.notifications).where(eq(t.notifications.personId, personId)),
    db.select({ id: t.emergencySituations.id, label: t.emergencySituations.label }).from(t.emergencySituations).where(eq(t.emergencySituations.ownerId, personId)),
    db.select({ id: t.changeRequests.id, title: t.changeRequests.title }).from(t.changeRequests).where(or(eq(t.changeRequests.pilotId, personId), eq(t.changeRequests.createdById, personId))),
  ]);
  const [changeCount] = await db.select({ n: sql<number>`count(*)::int` }).from(t.changeLog).where(eq(t.changeLog.byId, personId));
  const [accessCount] = await db.select({ n: sql<number>`count(*)::int` }).from(t.accessLog).where(and(eq(t.accessLog.personId, personId)));
  const siteLabel = (id: string | null) => (id ? sites.find((s) => s.id === id)?.label ?? id : '—');
  const titleLabel = (id: string) => titles.find((x) => x.id === id)?.label ?? id;
  const visibleEvents = events.filter((e) => inPerimeter(allowedSiteIds, e.siteId));
  return {
    identity: {
      id: person.id, name: person.name, job: person.job, service: person.service, site: siteLabel(person.siteId), email: person.email,
      matricule: person.matricule, entraLinked: !!person.entraObjectId, inSkillsMatrix: person.inSkillsMatrix,
      leftOn: person.leftOn, leftReason: person.leftReason,
      // Droits : rôle applicatif Entra relevé à la dernière connexion (jamais modifié depuis Vigie) et site de rattachement.
      lastRole: person.lastRole, lastLoginAt: fmt(person.lastLoginAt),
    },
    qualifications: quals.map((q) => ({
      id: q.id, title: titleLabel(q.titleId), obtainedOn: q.obtainedOn, expiresOn: q.expiresOn, provider: q.provider, scope: q.scope,
      effectiveness: q.effectiveness, cancelled: q.cancelledAt ? { on: parisDay(q.cancelledAt), reason: q.cancelReason ?? '' } : null,
    })),
    requiredTitles: requirements.map((r) => titleLabel(r.titleId)),
    events: visibleEvents.map((e) => ({
      id: e.id, occurredOn: e.occurredOn, type: EVENT_TYPES[e.type as EventType]?.label ?? e.type, title: e.title, site: siteLabel(e.siteId),
      roles: [e.declarantId === personId && 'déclarant', e.victimId === personId && 'victime', e.pilotId === personId && 'pilote'].filter((x): x is string => !!x),
      // Donnée de santé (victime d'un accident du travail) : page réservée aux rôles canSeeHealth.
      health: e.victimId === personId && e.injury ? `${injuryLabel(e.injury)}${e.lostDays != null ? ` · ${e.lostDays} j perdus` : ''}` : null,
    })),
    actions: actions.map((a) => ({ id: a.id, problem: a.problem, status: a.status, dueOn: a.dueOn, site: siteLabel(a.siteId) })),
    comments: comments.map((c) => ({ id: c.id, actionId: c.actionId, on: fmt(c.createdAt), withdrawn: !!c.withdrawnAt })),
    attachments: attachments.map((a) => ({ id: a.id, entity: `${a.entityType} · ${a.entityId}`, fileName: a.fileName, on: fmt(a.createdAt), health: a.health })),
    documents,
    planItems: planItems.map((p) => ({ id: p.id, label: `${p.detail ?? p.label} (${p.year})`, role: [p.ownerId === personId && 'responsable', p.auditorId === personId && 'auditeur interne'].filter(Boolean).join(', ') })),
    reviews: reviews.map((r) => ({ id: r.id, reviewOn: r.reviewOn })),
    situations, changeRequests,
    changes: { total: changeCount?.n ?? 0, rows: changes.map((c) => ({ ...c, at: fmt(c.at) })) },
    accesses: { total: accessCount?.n ?? 0, rows: accesses.map((a) => ({ ...a, at: fmt(a.at) })) },
    notifications: notifications[0]?.n ?? 0,
  };
}
