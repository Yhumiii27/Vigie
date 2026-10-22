// Routes d'authentification (module sans dépendance serveur : utilisable par proxy.ts).

/** Démarre la connexion Entra ID (?retour=<chemin> : page à rouvrir après la connexion). */
export const LOGIN_PATH = '/auth/connexion';
/** URI de retour OIDC (à inscrire dans l'application Entra : <VIGIE_PUBLIC_URL>/auth/retour). */
export const CALLBACK_PATH = '/auth/retour';
export const LOGOUT_PATH = '/auth/deconnexion';
/** Page « Vous êtes déconnecté » : URI de retour après la déconnexion Microsoft (à inscrire aussi dans l'application Entra). */
export const SIGNED_OUT_PATH = '/auth/deconnecte';
/** Refus d'accès expliqué (?motif=configuration | non-autorise | adresse | connexion | echec), hors session. */
export const ACCESS_PATH = '/auth/acces';

/** « adresse » : première connexion sans adresse e-mail vérifiée d'un domaine de l'entreprise (compte non rattaché). */
export type AccessMotif = 'configuration' | 'non-autorise' | 'adresse' | 'connexion' | 'echec';
export const accessHref = (motif: AccessMotif) => `${ACCESS_PATH}?motif=${motif}`;

/** Préfixe des routes d'authentification, ouvertes sans session (proxy.ts). */
export const AUTH_PREFIX = '/auth/';
/** Route de santé (sonde du conteneur, PRD-11) : ouverte sans session, et depuis localhost. */
export const HEALTH_PATH = '/api/sante';

/**
 * Signalement terrain sans compte (EVT-07) : /signaler?jeton=<jeton du QR code de poste>.
 * Le proxy laisse passer /signaler sans session quand ce paramètre a la forme d'un jeton ; la page et la server action
 * vérifient le jeton (HMAC VIGIE_REPORT_SECRET, map_zones.qr_version) et appliquent la limite de débit.
 */
export const REPORT_PATH = '/signaler';
export const REPORT_TOKEN_PARAM = 'jeton';

/**
 * Chemin de retour après la connexion : chemin local seulement (pas d'URL absolue ni « //hote », pas de boucle vers /auth/).
 * Renvoie « / » pour toute autre valeur.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 2000 || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  if ([...raw].some((c) => c.charCodeAt(0) < 32)) return '/';
  try {
    const u = new URL(raw, 'http://vigie.invalid');
    if (u.origin !== 'http://vigie.invalid' || u.pathname.startsWith(AUTH_PREFIX)) return '/';
    // Contrôle refait sur le chemin normalisé : « /.//hote », « /a/..//hote » ou « /%2e//hote » deviennent « //hote ».
    const out = `${u.pathname}${u.search}`;
    if (out.startsWith('//') || out.includes('\\')) return '/';
    return out;
  } catch {
    return '/';
  }
}

/** Contrôle de forme du jeton de poste dans le proxy (base64url, points admis) ; la vérification réelle est dans la page. */
export const looksLikeReportToken = (v: string | null) => !!v && /^[A-Za-z0-9._~-]{16,512}$/.test(v);

/** Planche des QR codes des postes (encadrement) ; ancre d'un poste : `#poste-<zone>` (EVT-19, lien depuis la fiche). */
export const REPORT_POSTS_PATH = '/signaler/postes';
export const reportPostHref = (siteId: string, zoneId: number) => `${REPORT_POSTS_PATH}?site=${encodeURIComponent(siteId)}#poste-${zoneId}`;
