// Familles de dangers proposées à la saisie d'un risque du DUERP (DUE-18) — liste de référence, jamais imposée.
//
// Source : familles usuelles de la brochure INRS ED 840 « Évaluation des risques professionnels — Aide au repérage des
// risques dans les PME-PMI » (rubriques de repérage), libellés harmonisés pour les regroupements et exports du document
// unique. Le champ « Danger » reste libre : la liste est proposée en suggestions (datalist), un autre libellé est accepté
// tel quel (ex. danger propre au site, pyrotechnie).

export const HAZARD_FAMILIES = [
  'Chute de plain-pied',
  'Chute de hauteur',
  'Chute d’objets, effondrement',
  'Circulation interne (engins, piétons)',
  'Risque routier (déplacements)',
  'Manutention manuelle (charge physique)',
  'Manutention mécanique (levage, chariots)',
  'Machines et outils (équipements de travail)',
  'Agents chimiques (produits, émissions, poussières)',
  'Agents biologiques',
  'Incendie, explosion (ATEX)',
  'Électricité',
  'Bruit',
  'Vibrations',
  'Ambiances thermiques (chaleur, froid)',
  'Éclairage',
  'Rayonnements (ionisants, optiques, électromagnétiques)',
  'Travail sur écran',
  'Risques psychosociaux',
  'Travail isolé',
  'Interventions d’entreprises extérieures (coactivité)',
] as const;

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").trim().toLowerCase();

/**
 * Suggestions du champ « Danger » : familles de référence, puis libellés déjà employés dans le document unique qui n'en
 * sont pas (sans doublon, accents et casse ignorés), dans l'ordre alphabétique.
 */
export function hazardSuggestions(used: readonly string[] = []): string[] {
  const seen = new Set(HAZARD_FAMILIES.map(norm));
  const extra: string[] = [];
  for (const raw of used) {
    const v = raw.trim();
    if (!v || seen.has(norm(v))) continue;
    seen.add(norm(v));
    extra.push(v);
  }
  return [...HAZARD_FAMILIES, ...extra.sort((a, b) => a.localeCompare(b, 'fr'))];
}
