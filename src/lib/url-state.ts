// Convention d'URL des écrans (UX-12), reprise de la vue générale des actions (ACT-27) — règles pures, sans import.
//
// - Onglet : `?onglet=<clé>` ; vue d'un même contenu : `?vue=<clé>` (liste, kanban, a-prevoir…).
// - Portée de la liste dans le cycle de vie : `?etat=<clé>` — `archives` pour les éléments archivés (exigences et
//   contrôles de la veille, risques et unités du DUERP, entreprises extérieures), `classes` / `tous` (événements),
//   `historique` / `abandonnees` (actions), `a-traiter` / `sortis` (habilitations) ; valeur par défaut omise. Exceptions
//   gardées (critères d'une liste à plusieurs vues, liens profonds existants) : `?filtre=` des plans et permis de
//   prévention (phase, état, annulés), `?vue=annules` du registre des déchets (wasteEntryHref, DOC-08).
// - Filtres : un paramètre par critère, nommé d'après le critère (`type`, `origine`, `statut`, `service`, `responsable`,
//   `gravite`…) ; case « oui » : `=1` ; recherche libre : `?q=` ; valeurs par défaut omises, paramètre répété : première
//   valeur, valeur inconnue : défaut.
// - Fiche ouverte : un paramètre par type d'élément, nommé d'après lui (`DETAIL_PARAMS`), porté par l'URL (lien profond,
//   retour arrière) ; un élément inconnu ou hors périmètre affiche le bandeau commun (MissingNotice, UX-13), jamais un
//   repli silencieux. Les fiches ouvertes côté navigateur passent par l'historique (`pushState`), les filtres appliqués
//   côté navigateur le remplacent (`replaceState`) : Next.js suit les deux (useSearchParams).
// - Anciens paramètres : lus puis réécrits (`canonicalHref` : redirection par src/proxy.ts pour une page chargée, par la page
//   elle-même pour une navigation côté navigateur), pour ne casser aucun lien existant (échéances, notifications, favoris).

export type SearchParams = Record<string, string | string[] | undefined>;

/** Première valeur d'un paramètre (répété : la première ; absent : undefined). */
export const firstParam = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Construit une URL en remplaçant certains paramètres de recherche (valeur vide ou undefined : paramètre retiré). */
export function hrefWith(path: string, current: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries({ ...current, ...patch }).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Portée « archivés » d'une liste (`?etat=archives`). */
export const ARCHIVES = 'archives';

/**
 * Paramètre de la fiche ouverte, par écran et par type d'élément (liens profonds des échéances, notifications et fiches
 * liées). Exceptions gardées pour ne casser aucun lien : `sel` (événements, aperçu mobile) et `doc` (documents).
 */
export const DETAIL_PARAMS = {
  '/evenements': { evenement: 'sel' },
  '/actions': { action: 'action' },
  '/veille': { exigence: 'exigence', controle: 'controle', observation: 'observation' },
  '/risques': { risque: 'risque', situation: 'situation' },
  '/documents': { document: 'doc' },
  '/prevention': { plan: 'plan', permis: 'permis' },
  '/environnement': { enlevement: 'enlevement', filiere: 'filiere' },
  '/habilitations': { salarie: 'salarie' },
  '/audits': { element: 'element', constat: 'constat', revue: 'revue', changement: 'changement' },
  '/audits/contributions': { revue: 'revue' },
  '/revue-de-direction': { revue: 'revue' },
  '/apercu-mobile': { signalement: 'sel' },
} as const;

type Rewrite = (sp: Record<string, string>) => Record<string, string | undefined> | null;

/** Anciens paramètres, par écran : patch à appliquer (undefined : paramètre retiré), ou null s'il n'y a rien à réécrire. */
const LEGACY: Record<string, Rewrite> = {
  // Veille : ?archives=1 (exigences) et ?statut=archives (contrôles) → ?etat=archives.
  '/veille': (sp) => {
    if (sp.archives === undefined && sp.statut !== ARCHIVES) return null;
    const archived = sp.archives === '1' || sp.statut === ARCHIVES;
    return { archives: undefined, statut: sp.statut === ARCHIVES ? undefined : sp.statut, etat: archived ? ARCHIVES : sp.etat };
  },
  // Prévention, entreprises extérieures : ?filtre=archivees → ?etat=archives (les filtres de phase des plans et d'état des
  // permis restent ?filtre=, critères de la liste).
  '/prevention': (sp) => (sp.filtre === 'archivees' ? { filtre: undefined, etat: ARCHIVES } : null),
  // DUERP : ?archives=1 → ?etat=archives.
  '/risques': (sp) => (sp.archives === undefined ? null : { archives: undefined, etat: sp.archives === '1' ? ARCHIVES : sp.etat }),
};

/** Paramètres d'URL ramenés à leur première valeur (ordre conservé). */
function flatten(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const f = firstParam(v);
    if (f !== undefined) out[k] = f;
  }
  return out;
}

/**
 * URL canonique d'un écran quand ses paramètres en portent d'anciens (à rediriger), sinon null. Les autres paramètres
 * sont conservés (première valeur).
 */
export function canonicalHref(path: string, sp: SearchParams): string | null {
  const rewrite = LEGACY[path];
  if (!rewrite) return null;
  const current = flatten(sp);
  const patch = rewrite(current);
  if (!patch) return null;
  return hrefWith(path, current, patch);
}

/** Portée « archivés » demandée (`?etat=archives`). */
export const wantsArchives = (sp: SearchParams) => firstParam(sp.etat) === ARCHIVES;

/** Lien profond vers une fiche (`?<param>=<id>`) qui ne correspond à aucun élément affichable : bandeau MissingNotice. */
export const missingDetail = (param: string | string[] | undefined, found: boolean) => {
  const v = firstParam(param);
  return v !== undefined && v !== '' && !found;
};

// ─── Habilitations : filtres de la matrice (anciennement mémorisés dans le navigateur) ──────────────────────────

export const SKILL_SCOPES = ['tous', 'a-traiter', 'sortis'] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];
export type SkillFilters = { etat: SkillScope; service: string; q: string };
export const SKILL_QUERY_MAX = 100;

/** Filtres de la matrice : `?etat=a-traiter|sortis`, `?service=`, `?q=` (≤ 100 caractères) ; valeur inconnue : défaut. */
export function parseSkillFilters(sp: SearchParams | URLSearchParams): SkillFilters {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) ?? undefined : firstParam(sp[k]))?.trim() ?? '';
  const etat = get('etat');
  return {
    etat: (SKILL_SCOPES as readonly string[]).includes(etat) ? (etat as SkillScope) : 'tous',
    service: get('service').slice(0, SKILL_QUERY_MAX),
    q: get('q').slice(0, SKILL_QUERY_MAX),
  };
}

/** Paramètres d'URL des filtres de la matrice (valeurs par défaut omises). */
export function skillFiltersParams(f: Partial<SkillFilters>): Record<string, string | undefined> {
  return { etat: f.etat && f.etat !== 'tous' ? f.etat : undefined, service: f.service || undefined, q: f.q || undefined };
}

/**
 * Ancien filtre de la matrice mémorisé dans le navigateur (`{ chip: 'tous' | 'a_traiter' | 'sortis', service }`, clé
 * `vigie.skills.filter`) : filtres équivalents, ou null s'il n'y a rien à reprendre (valeur absente, illisible ou par défaut).
 */
export function legacySkillFilters(raw: string | null): Partial<SkillFilters> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { chip?: unknown; service?: unknown };
    const etat: SkillScope = v.chip === 'a_traiter' ? 'a-traiter' : v.chip === 'sortis' ? 'sortis' : 'tous';
    const service = typeof v.service === 'string' ? v.service.slice(0, SKILL_QUERY_MAX) : '';
    return etat === 'tous' && !service ? null : { etat, service };
  } catch {
    return null;
  }
}

/** Recherche (`?…`) d'une URL après application d'un patch (valeur vide : paramètre retiré), pour history.replaceState. */
export function searchWith(search: string, patch: Record<string, string | undefined>): string {
  const params = new URLSearchParams(search);
  for (const [k, v] of Object.entries(patch)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
