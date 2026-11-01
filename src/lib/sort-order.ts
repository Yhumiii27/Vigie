// Rang d'un nouvel élément d'une liste ordonnée (colonne `sort` : certifications, constats, check-list et décisions de la
// revue, unités de travail, personnes, titres suivis, sites) : un de plus que le plus grand rang, 0 pour une liste vide.
// Seule copie (QUA-25).

export const nextSort = (rows: readonly { sort: number }[]) => Math.max(-1, ...rows.map((r) => r.sort)) + 1;
