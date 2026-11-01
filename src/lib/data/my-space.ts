import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { actionHref, compareActions } from '../action-rules';
import { STEP_CLOSED, isClosedActionStatus, type SkillState, type Tone } from '../domain';
import { actionView, loadPeople } from '../queries';
import { renewalForecast, type ForecastItem } from '../rules/skills';
import { getSession } from '../session';
import { today } from '../today';
import { loadMyReports } from './events';
import { loadSkillData } from './skills';

// Espace salarié mobile (EVT-22, /signaler/mon-espace) : les seules données de la personne connectée, quel que soit son
// rôle — ses actions (responsable : pilot_id, sur tous les sites, canReadAction), sa ligne de la matrice des habilitations
// (sur tout son périmètre, HAB-14) et ses recyclages à prévoir (renewalForecast, HAB-09), ses signalements nominatifs
// (loadMyReports). Rien d'autrui : ni responsable, ni site d'un autre, ni liste du personnel ; aucune donnée de santé
// (aucune colonne d'un événement n'est lue ici, hors le décompte de « Mes signalements »).

export type MyAction = { id: string; label: string; statusLabel: string; tone: Tone; dueOn: string; late: boolean; href: string };
export type MySkill = { titleId: string; title: string; state: SkillState; expiresOn: string | null; required: boolean };
export type MySpace = {
  name: string;
  actions: MyAction[];
  /** Titres requis ou détenus (formation en cours), dans l'ordre des titres suivis ; null : hors de la matrice. */
  skills: MySkill[] | null;
  /** Recyclages et formations à prévoir : à rattraper, puis échéances des 12 prochains mois. */
  renewals: ForecastItem[];
  reports: { total: number; open: number };
};

export async function loadMySpace(): Promise<MySpace> {
  const session = await getSession();
  const db = await getDb();
  const now = today();
  const [rows, people, skillData, reports] = await Promise.all([
    db.select().from(t.actions).where(eq(t.actions.pilotId, session.user.id)),
    loadPeople(),
    loadSkillData('perimeter'),
    loadMyReports(),
  ]);
  const actions = rows
    .filter((a) => !isClosedActionStatus(a.status))
    .map((a) => ({ a, v: actionView(a, people, now) }))
    .sort((x, y) => compareActions(x.v, y.v, now))
    .map(({ a, v }) => ({ id: a.id, label: v.label, statusLabel: v.statusLabel, tone: v.tone, dueOn: a.dueOn, late: v.late, href: actionHref(a.id) }));
  const row = skillData.rows.find((r) => r.person.id === session.user.id);
  const skills = row
    ? row.cells.filter((c) => c.required || c.qualificationId !== null)
      .map((c) => ({ titleId: c.title.id, title: c.title.label, state: c.state, expiresOn: c.expiresOn, required: c.required }))
    : null;
  const forecast = row ? renewalForecast([{ person: { id: row.person.id, name: row.person.name }, cells: row.cells }], now) : null;
  const renewals = forecast ? [...forecast.overdue, ...forecast.months.flatMap((m) => m.items)] : [];
  return {
    name: session.user.name,
    actions,
    skills,
    renewals,
    reports: { total: reports.length, open: reports.filter((r) => r.step < STEP_CLOSED && !r.dismissed).length },
  };
}
