import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { addDays, fmtDate, parisDay } from '../dates';
import { TODO_HORIZON_DAYS, type TodoItem, type Tone } from '../domain';
import { drillDue } from '../emergency-rules';
import { hasLeft } from '../people';
import { loadPeople, loadSiteRows } from '../queries';
import { siteFilter } from '../session';
import { loadQhseLeads } from './leads';
import { entityVersions } from '@/server/versions';

// Situations d'urgence (CNF-08, ISO 45001 §8.2, ISO 14001 §8.2) : situations identifiées par site, moyens et consignes,
// exercices tenus et prochain exercice (calculé : drillDue, src/lib/emergency-rules.ts). Écran « Évaluation des risques »,
// vue ?vue=urgences (tous les rôles de l'écran ; saisie : canEdit(role, 'risks')).

export type DrillView = {
  id: number; heldOn: string; participants: string; findings: string; by: string;
  cancelled: { on: string; by: string; reason: string } | null;
};

export type EmergencyView = {
  id: number; siteId: string; siteLabel: string; label: string; scenario: string; response: string;
  drillMonths: number; nextDrillOn: string | null; ownerId: string | null; owner: string;
  createdOn: string;
  /** Exercices, le plus récent d'abord (annulés compris, barrés). */
  drills: DrillView[];
  lastHeldOn: string | null;
  /** Prochain exercice attendu (calculé) ; null pour une situation archivée. */
  due: { on: string; planned: boolean; plannedLate: boolean; first: boolean; late: boolean; tone: Tone; label: string } | null;
  archived: { on: string; by: string; reason: string } | null;
};

const readEmergencies = cache(async () => {
  const db = await getDb();
  const [situations, drills, people, sites] = await Promise.all([
    db.select().from(t.emergencySituations).orderBy(asc(t.emergencySituations.id)),
    db.select().from(t.emergencyDrills).orderBy(asc(t.emergencyDrills.id)),
    loadPeople(),
    loadSiteRows(),
  ]);
  const now = today();
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  const views: EmergencyView[] = situations.map((s) => {
    const own = drills.filter((d) => d.situationId === s.id).sort((a, b) => b.heldOn.localeCompare(a.heldOn) || b.id - a.id);
    const lastHeldOn = own.find((d) => !d.cancelledAt)?.heldOn ?? null;
    const createdOn = parisDay(s.createdAt);
    const d = drillDue({ drillMonths: s.drillMonths, nextDrillOn: s.nextDrillOn, createdOn }, lastHeldOn);
    const late = d.dueOn < now;
    const label = late ? `Exercice en retard depuis le ${fmtDate(d.dueOn)}`
      : d.planned ? `Exercice planifié le ${fmtDate(d.dueOn)}` : `${d.first ? 'Premier exercice' : 'Prochain exercice'} avant le ${fmtDate(d.dueOn)}`;
    return {
      id: s.id, siteId: s.siteId, siteLabel: siteLabel.get(s.siteId) ?? s.siteId, label: s.label, scenario: s.scenario, response: s.response,
      drillMonths: s.drillMonths, nextDrillOn: s.nextDrillOn, ownerId: s.ownerId, owner: name(s.ownerId), createdOn,
      drills: own.map((x) => ({
        id: x.id, heldOn: x.heldOn, participants: x.participants, findings: x.findings, by: name(x.createdById),
        cancelled: x.cancelledAt ? { on: parisDay(x.cancelledAt), by: name(x.cancelledById), reason: x.cancelReason ?? '' } : null,
      })),
      lastHeldOn,
      due: s.archivedAt ? null : {
        on: d.dueOn, planned: d.planned, plannedLate: d.plannedLate, first: d.first, late,
        tone: late ? 'danger' : d.dueOn <= addDays(now, TODO_HORIZON_DAYS) ? 'warn' : 'neutral', label,
      },
      archived: s.archivedAt ? { on: parisDay(s.archivedAt), by: name(s.archivedById), reason: s.archiveReason ?? '' } : null,
    };
  });
  return { now, views, people };
});

/**
 * Situations d'urgence du site sélectionné (« Tous les sites » : périmètre), en service puis archivées ; `versions` :
 * version de chaque fiche pour le formulaire de modification (QUA-12).
 */
export async function loadEmergencies({ employee = false }: { employee?: boolean } = {}) {
  const [{ views, now }, keep, db] = await Promise.all([readEmergencies(), siteFilter('site'), getDb()]);
  // Salarié (consultation des consignes) : ni responsable ni détail des exercices (participants, saisie) — données d'autrui.
  const rows = views.filter((v) => keep(v.siteId))
    .map((v) => (employee ? { ...v, ownerId: null, owner: '', drills: v.drills.filter((d) => !d.cancelled).map((d) => ({ ...d, participants: '', findings: '', by: '' })) } : v));
  const versions = Object.fromEntries(await entityVersions(db, 'emergency_situation', rows.map((r) => r.id)));
  return { now, situations: rows.filter((v) => !v.archived), archived: rows.filter((v) => !!v.archived), versions };
}

/**
 * Échéances des exercices d'urgence (CNF-08), sur tout le périmètre (TDB-05) : exercice en retard, ou attendu dans
 * l'horizon de « À faire » (TODO_HORIZON_DAYS). Destinataire : le responsable de la situation encore présent, sinon le
 * responsable QHSE du site. Clé stable `urgence-exercice|<id>` (la date d'échéance s'y ajoute : todoKey).
 */
export const loadEmergencySignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const [{ views, now, people }, keep, leads] = await Promise.all([readEmergencies(), siteFilter('perimeter'), loadQhseLeads()]);
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const todo: TodoItem[] = views
    .filter((v) => keep(v.siteId) && v.due && v.due.on <= horizon)
    .map((v) => {
      const owner = v.ownerId ? people.get(v.ownerId) : undefined;
      const to = owner && !hasLeft(owner, now) ? { who: owner.name, ownerIds: [owner.id] } : leads.forSite(v.siteId);
      const due = v.due!;
      return {
        date: due.late ? now : due.on, dueOn: due.on, kind: "Situation d'urgence", tone: due.late ? 'danger' : 'warn', overdue: due.late,
        title: `${v.label} — ${due.late ? `exercice en retard depuis le ${fmtDate(due.on)}` : due.planned ? `exercice planifié le ${fmtDate(due.on)}` : `exercice à organiser avant le ${fmtDate(due.on)}`}`,
        key: `urgence-exercice|${v.id}`, who: to.who, ownerIds: to.ownerIds, siteId: v.siteId, href: `/risques?vue=urgences&situation=${v.id}`,
      } satisfies TodoItem;
    });
  return { todo };
});
