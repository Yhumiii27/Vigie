import 'server-only';
import { cache } from 'react';
import { asc, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { lapseFor, renewalDue, type Lapse } from '@/components/skills/rules';
import { today } from '../dates';
import { columnOf, type SkillState, type Tone } from '../domain';
import { actionColumn, loadPeople, skillState, type Person } from '../queries';
import { currentSiteId, inSite } from '../session';

// ─── Habilitations ──────────────────────────────────────────────────────────

export type TrainingTitle = typeof t.trainingTitles.$inferSelect;
export type KeystoneAssignment = typeof t.keystoneAssignments.$inferSelect;

/** Action de recyclage rattachée à l'exigence (qualification_requirements.renewalActionId), tant qu'elle n'est pas clôturée. */
export type RenewalInfo = {
  id: string;
  title: string;
  dueOn: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  pilot: string;
  /** À lancer ou en cours (y compris en retard) : le recyclage est encore à réaliser. */
  planned: boolean;
};

export type SkillCell = {
  title: TrainingTitle;
  state: SkillState;
  expiresOn: string | null;
  required: boolean;
  obtainedOn: string | null;
  provider: string | null;
  renewal: RenewalInfo | null;
  /**
   * Échéance proposée pour planifier le recyclage, null s'il n'y a rien à planifier (voir renewalDue) :
   * titre expiré, expirant sous 60 jours, jamais suivi, ou expirant avant la fin d'une affectation Keystone.
   */
  renewalDueOn: string | null;
};

export type SkillRow = { person: Person; cells: SkillCell[]; assignments: KeystoneAssignment[] };

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
  renewalDueOn: string | null;
  /** Titres requis du salarié (pour la fenêtre « Voir l'affectation »). */
  required: SkillCell[];
};

export const loadSkillMatrix = cache(async () => {
  const db = await getDb();
  const now = today();
  const [people, titles, reqs, quals, assignments, site] = await Promise.all([
    loadPeople(),
    db.select().from(t.trainingTitles).orderBy(asc(t.trainingTitles.sort)),
    db.select().from(t.qualificationRequirements),
    db.select().from(t.qualifications),
    db.select().from(t.keystoneAssignments).orderBy(asc(t.keystoneAssignments.startOn)),
    currentSiteId(),
  ]);

  const renewalIds = [...new Set(reqs.map((r) => r.renewalActionId).filter((id): id is string => !!id))];
  const renewalActions = renewalIds.length ? await db.select().from(t.actions).where(inArray(t.actions.id, renewalIds)) : [];
  const renewals = new Map<string, RenewalInfo>();
  renewalActions.forEach((a) => {
    if (a.status === 'done') return;
    const col = columnOf(actionColumn(a, now));
    renewals.set(a.id, {
      id: a.id, title: a.title, dueOn: a.dueOn, status: a.status, statusLabel: col.status, tone: col.tone,
      pilot: people.get(a.pilotId)?.name ?? '—', planned: a.status === 'todo' || a.status === 'doing',
    });
  });

  const req = new Map(reqs.map((r) => [`${r.personId}:${r.titleId}`, r]));
  const qual = new Map(quals.map((q) => [`${q.personId}:${q.titleId}`, q]));
  const visible = [...people.values()].filter((p) => inSite(site, p.siteId));

  const rows: SkillRow[] = visible.filter((p) => p.inSkillsMatrix).map((p) => {
    const upcoming = assignments.filter((a) => a.personId === p.id && a.endOn >= now);
    return {
      person: p,
      assignments: upcoming,
      cells: titles.map((ti) => {
        const key = `${p.id}:${ti.id}`;
        const r = req.get(key);
        const q = qual.get(key);
        const state = skillState(!!r, q?.expiresOn, !!q, now);
        const expiresOn = q?.expiresOn ?? null;
        return {
          title: ti,
          state,
          expiresOn,
          required: !!r,
          obtainedOn: q?.obtainedOn ?? null,
          provider: q?.provider ?? null,
          renewal: r?.renewalActionId ? renewals.get(r.renewalActionId) ?? null : null,
          renewalDueOn: renewalDue(state, expiresOn, upcoming, now),
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
        expiresOn: c.expiresOn, assignment: a, renewal: c.renewal, renewalDueOn: c.renewalDueOn, required: row.cells.filter((x) => x.required),
      }];
    })))
    .sort((x, y) => x.assignment.startOn.localeCompare(y.assignment.startOn));

  // Sens historique, lu par le tableau de bord, « À faire » et la revue de direction : titre requis
  // jamais suivi ou déjà expiré aujourd'hui (state = état actuel, r ou x) et affectation Keystone à venir.
  const alerts = lapses.filter((al) => al.lapse === 'missing' || al.lapse === 'expired');

  // Personnel du site non suivi dans la matrice (encadrement, fonctions support).
  const others = visible.filter((p) => !p.inSkillsMatrix);

  return { titles, rows, alerts, lapses, others };
});

export type SkillMatrixData = Awaited<ReturnType<typeof loadSkillMatrix>>;
