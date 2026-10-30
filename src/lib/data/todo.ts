import 'server-only';
import { cache } from 'react';
import { ALL_SITES, byUrgency, type TodoItem } from '../domain';
import { loadSiteRows } from '../queries';
import { currentSiteId, getSession } from '../session';
import { visibleTodo, type VisibleTodo } from '../todo-visibility';
import { loadActionSignals } from './actions';
import { loadAuditSignals } from './audits';
import { loadChangeSignals } from './changes';
import { loadDocumentSignals } from './documents';
import { loadEmergencySignals } from './emergencies';
import { loadEnvironmentSignals } from './environment';
import { loadEventSignals } from './events';
import { loadPreventionSignals } from './prevention-signals';
import { loadReportPostSignals } from './report-posts';
import { loadReviewSignals } from './review';
import { loadRiskSignals } from './risks';
import { loadSiteSignals } from './sites';
import { loadSkillSignals } from './skills';
import { loadCoactivitySignals } from './sitemap';
import { loadWatchSignals } from './watch';

// Source unique des échéances : « À traiter » du tableau de bord, page À faire, notifications et badges.
// Chaque domaine fournit `load<Domaine>Signals(): Promise<{ todo: TodoItem[] }>` (mémorisé avec cache()) ;
// son horizon est TODO_HORIZON_DAYS (CONTROL_HORIZON_DAYS pour les contrôles), dépassements compris. Les signaux sont
// calculés sur tout le périmètre de la personne (scope 'perimeter', TDB-05) et portent le site de l'élément (siteId).

/**
 * Toutes les échéances du périmètre de la personne, chaque échéance portant son site (siteId), avant filtre par rôle et par
 * site sélectionné (loadVisibleTodo) : dépassements d'abord, puis par date.
 */
export const loadTodo = cache(async (): Promise<TodoItem[]> => {
  const signals = await Promise.all([
    loadEventSignals(), loadActionSignals(), loadWatchSignals(), loadSkillSignals(), loadRiskSignals(),
    loadAuditSignals(), loadReviewSignals(), loadPreventionSignals(), loadCoactivitySignals(),
    loadDocumentSignals(), loadEnvironmentSignals(), loadSiteSignals(), loadReportPostSignals(),
    // Paquet 13, seconde moitié : exercices des situations d'urgence (CNF-08), demandes de changement (CNF-11).
    loadEmergencySignals(), loadChangeSignals(),
  ]);
  return signals.flatMap((s) => s.todo).sort(byUrgency);
});

/** Sites de la base, archivés compris (libellés des échéances d'un autre site, périmètre des indicateurs). */
export const loadSiteDirectory = cache(async () => (await loadSiteRows()).map((s) => ({ id: s.id, label: s.label, archivedAt: s.archivedAt })));

/** Libellé court d'un site (« Site de [Ville B] » pour « Site de [Ville B] — zone d'essais »). */
export const shortSiteLabel = (label: string) => label.split(' — ')[0];

export type { VisibleTodo };

/**
 * Échéances visibles par la personne connectée (visibleTodo, src/lib/todo-visibility.ts) : « Toutes » = échéances du site
 * sélectionné que son rôle peut traiter, plus ses propres échéances (ownerIds) sur tous les sites de son périmètre (TDB-05),
 * y compris sur un écran qui lui est fermé (vue en lecture, sinon sans lien : TDB-02) ; jamais une échéance qui révèle une
 * donnée de santé pour un rôle non habilité (SEC-06) ; pour un salarié, les siennes seulement.
 * Échéance d'un autre site : libellé court du site (siteLabel) ; sans lien si ce site ne peut pas être sélectionné
 * (site archivé hors « Tous les sites »), puisque l'écran cible, filtré sur le site sélectionné, ne la trouverait pas.
 * Vue « Tous les sites » (TDB-15) : chaque échéance d'un site porte aussi son libellé court (siteLabel), lien inchangé.
 */
export const loadVisibleTodo = cache(async (): Promise<VisibleTodo[]> => {
  const [{ role, user, siteOptions }, todo, siteId, sites] = await Promise.all([getSession(), loadTodo(), currentSiteId(), loadSiteDirectory()]);
  const selectable = new Set(siteOptions.map((s) => s.id));
  const labels = new Map(sites.map((s) => [s.id, shortSiteLabel(s.label)]));
  return visibleTodo(todo, { role, user, siteId }).map((x) => {
    if (!x.siteId) return x;
    if (!x.elsewhere) return siteId ? x : { ...x, siteLabel: labels.get(x.siteId) ?? x.siteId };
    const reachable = selectable.has(x.siteId) || selectable.has(ALL_SITES);
    return { ...x, siteLabel: labels.get(x.siteId) ?? x.siteId, href: reachable ? x.href : undefined };
  });
});
