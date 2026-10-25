import { addDays } from '../../lib/dates';

// Dates du jeu de démonstration (QUA-20) : chaque date est donnée par son écart en jours (le décalage) à la date de
// référence du jeu, DEMO_REFERENCE_DAY, jamais en dur : rel(-12) = douze jours avant la référence. La référence est la date
// du jour recommandée pour la démonstration et celle des tests : VIGIE_TODAY=2026-10-09 (test/helpers.ts DEMO_TODAY,
// playwright.config.ts, CI). Un horodatage s'écrit `${rel(n)}T10:00:00+02:00` (heure de Paris, décalage horaire écrit).
//
// Déplacer le jeu = changer DEMO_REFERENCE_DAY (et VIGIE_TODAY) : toutes les dates suivent, au jour près. Ne suivent pas,
// et seraient à revoir : les années et mois saisis en nombre (programme d'audit, objectifs, programme de prévention,
// heures travaillées calculées par mois), les dates écrites dans un texte (intitulés, motifs, références « EV-2026-… »),
// le décalage horaire écrit d'un horodatage (heure d'été ou d'hiver) et le jour de la semaine (rappel du mercredi, délais
// de déclaration hors dimanches et fériés) quand l'écart n'est pas un multiple de 7 jours.

/** Date de référence du jeu de démonstration (« AAAA-MM-JJ ») : un vendredi. */
export const DEMO_REFERENCE_DAY = '2026-10-09';

/** Jour à `offset` jours de la date de référence (négatif : avant), « AAAA-MM-JJ ». */
export const rel = (offset: number) => addDays(DEMO_REFERENCE_DAY, offset);

/** Date « AAAA-MM-JJ » d'une année, d'un mois et d'un jour calendaires (données mensuelles et annuelles du jeu). */
export const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
