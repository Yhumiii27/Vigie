// Mise en forme partagée par l'écran DUERP, ses impressions et le journal (serveur comme client).

/** Espace fine insécable (séparateur des milliers, typographie française). */
const THIN = ' ';

/**
 * Montant en euros : « 12 000 € », « 950,50 € » (centimes seulement s'il y en a). Groupement écrit à la main plutôt
 * qu'avec Intl.NumberFormat, dont la sortie peut différer entre le serveur et le navigateur (écart d'hydratation).
 */
export function fmtEuro(n: number): string {
  const cents = Math.round(Math.abs(n) * 100);
  const int = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  const dec = cents % 100 ? `,${String(cents % 100).padStart(2, '0')}` : '';
  return `${n < 0 ? '−' : ''}${int}${dec} €`;
}
