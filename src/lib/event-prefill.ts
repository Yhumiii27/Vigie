// « Nouvel événement » prérempli depuis la fiche d'un autre écran (EVT-24) — règles pures, sans import serveur.
//
// Lien : /evenements?nouveau=1&<source>=<identifiant>, une source par lien : plan de prévention (`plan`), permis (`permis`),
// contrôle périodique (`controle`), risque du DUERP (`risque`), document maîtrisé (`document`) ; l'écran Environnement
// ouvre le formulaire sur le type « Environnement » (`type=ENV`). Le serveur (loadNewEventDefaults) ne reprend qu'un
// élément visible de la personne (site sélectionné et périmètre, risque et contrôle en vigueur) ; un identifiant inconnu,
// archivé ou hors périmètre est ignoré sans rien révéler : le formulaire s'ouvre alors vide. Jamais une donnée de santé.

import { REPORT_TYPE_KEYS, type EventType } from './domain';

/** Paramètre d'URL de chaque source de préremplissage. */
export const NEW_EVENT_SOURCES = ['plan', 'permis', 'controle', 'risque', 'document'] as const;
export type NewEventSource = (typeof NEW_EVENT_SOURCES)[number];

/** Lien « Signaler un événement » depuis une fiche (formulaire « Nouvel événement » ouvert d'emblée). */
export function newEventHref(source: NewEventSource | 'type', id: string | number): string {
  return `/evenements?nouveau=1&${source}=${encodeURIComponent(String(id))}`;
}

/**
 * Type proposé par l'URL (`?type=ENV`) : un type déclarable depuis un écran (REPORT_TYPE_KEYS : jamais une maladie
 * professionnelle, réservée aux rôles habilités aux données de santé et saisie par eux) ; sinon aucun.
 */
export function prefillType(raw: string | undefined): EventType | undefined {
  return raw && (REPORT_TYPE_KEYS as readonly string[]).includes(raw) ? (raw as EventType) : undefined;
}

/** Valeur d'une source dans les paramètres d'URL (identifiant non vide, 60 caractères au plus) ; sinon undefined. */
export function sourceParam(sp: Record<string, string | string[] | undefined>, source: NewEventSource): string | undefined {
  const v = sp[source];
  const s = typeof v === 'string' ? v.trim() : undefined;
  return s && s.length <= 60 ? s : undefined;
}

/** Clé du formulaire ouvert par un lien (un nouveau lien remonte le formulaire avec ses nouvelles valeurs). */
export function prefillKey(sp: Record<string, string | string[] | undefined>): string {
  if (sp.nouveau !== '1') return 'new';
  return ['new', ...NEW_EVENT_SOURCES.map((s) => sourceParam(sp, s) ?? ''), prefillType(typeof sp.type === 'string' ? sp.type : undefined) ?? ''].join('-');
}
