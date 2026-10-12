// Identifiants d'établissement (registre des déchets, arrêté du 31 mai 2021 ; « Gérer les sites ») : SIRET français, ou
// numéro de TVA intracommunautaire d'un transporteur ou d'une installation étrangère. Règles pures (client et serveur).

/** SIREN de La Poste : ses établissements suivent une clé propre (somme des chiffres multiple de 5). */
const LA_POSTE_SIREN = '356000000';

/** Retire espaces (insécables compris), points et tirets ; majuscules (numéros de TVA). */
export const normalizeSiret = (raw: string) => raw.replace(/[\s.  -]/g, '').toUpperCase();

/** Clé de Luhn : en partant de la droite, un chiffre sur deux est doublé (9 retranché au-delà de 9), somme multiple de 10. */
function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** SIRET valide : 14 chiffres et clé de Luhn ; établissements de La Poste : somme des chiffres multiple de 5. */
export function isSiret(s: string): boolean {
  if (!/^\d{14}$/.test(s)) return false;
  if (luhn(s)) return true;
  return s.startsWith(LA_POSTE_SIREN) && [...s].reduce((n, d) => n + +d, 0) % 5 === 0;
}

/** « NNN NNN NNN NNNNN » (SIREN puis NIC) ; une valeur qui n'est pas un SIRET est rendue telle quelle. */
export const fmtSiret = (s: string) => (/^\d{14}$/.test(s) ? `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}` : s);

/** Numéro de TVA intracommunautaire étranger (transporteur ou installation hors de France) : préfixe pays hors FR. */
export const isEuVatNumber = (s: string) => /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(s) && !s.startsWith('FR');
