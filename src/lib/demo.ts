// Mode démonstration (VIGIE_DEMO=1) : identités et réglages propres au jeu de démonstration (src/db/seed.ts).
// Rien ici ne sert hors démonstration : l'utilisateur vient alors d'Entra ID (src/lib/auth/), les destinataires
// des alertes du responsable QHSE de chaque site (sites.qhse_lead_id).

import type { Role } from './domain';

/** Cookie du rôle choisi dans le sélecteur de démonstration. */
export const DEMO_ROLE_COOKIE = 'vigie_role';

/** Rôle → personne de démonstration (identifiants du jeu de données). */
export const DEMO_ROLE_PEOPLE: Record<Role, string> = {
  'Animateur QHSE': 'clefevre',
  Direction: 'hmarchand',
  'Chef de service': 'sbenali',
  'Chef de projet': 'edubois',
  Salarié: 'tnguyen',
};

/**
 * Membres du CSE de la démonstration (CNF-01, registre des dangers graves et imminents) : la personne du rôle Salarié et
 * celle du chef de service ; hors démonstration, le groupe Entra VIGIE_CSE_GROUP.
 */
export const DEMO_CSE_PEOPLE: readonly string[] = [DEMO_ROLE_PEOPLE['Salarié'], DEMO_ROLE_PEOPLE['Chef de service']];

/** Rôle par défaut de la démonstration, sans cookie. */
export const DEMO_DEFAULT_ROLE: Role = 'Animateur QHSE';

/** Responsable QHSE des sites du jeu de démonstration (sites.qhse_lead_id). */
export const DEMO_QHSE_LEAD = DEMO_ROLE_PEOPLE['Animateur QHSE'];

/** Lieu proposé par l'aperçu mobile de démonstration (/apercu-mobile). */
export const DEMO_POST = 'Atelier montage · poste M3';
