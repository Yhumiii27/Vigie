import 'server-only';
import { cache } from 'react';
import { today } from '../dates';
import { actionColumn, controlStatus, isOpen, loadActions, loadControls, loadEvents } from '../queries';
import { loadDocumentSignals } from './documents';
import { loadEnvironmentSignals } from './environment';
import { loadPreventionSignals } from './prevention';
import { loadCoactivitySignals } from './sitemap';
import { loadSkillMatrix } from './skills';

// ─── Badges de navigation et sous-titres ────────────────────────────────────

export const loadCounters = cache(async () => {
  const now = today();
  const [events, actions, controls, skills, prevention, documents, environment, coactivity] = await Promise.all([
    loadEvents(), loadActions(), loadControls(), loadSkillMatrix(), loadPreventionSignals(), loadDocumentSignals(), loadEnvironmentSignals(), loadCoactivitySignals(),
  ]);
  const openEvents = events.filter(isOpen).length;
  const cols = actions.map((a) => actionColumn(a, now));
  const openActions = cols.filter((c) => c !== 'done').length;
  const lateActions = cols.filter((c) => c === 'late').length;
  const controlsSoon = controls.filter((c) => controlStatus(c, now).days <= 30).length;
  const skillAlerts = skills.rows.reduce((n, r) => n + r.cells.filter((c) => c.state === 's' || c.state === 'x' || c.state === 'r').length, 0);
  return {
    openEvents, openActions, lateActions, controlsSoon, skillAlerts, people: skills.rows.length, titles: skills.titles.length,
    prevention: prevention.badge + coactivity.badge, documents: documents.badge, environment: environment.badge,
  };
});
