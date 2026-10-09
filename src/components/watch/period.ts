// Calcul d'échéance des contrôles périodiques, partagé par les server actions et les formulaires.

/**
 * Ajoute `n` mois à une date ISO en restant dans le mois d'arrivée :
 * 31/08/2026 + 6 mois = 28/02/2027 (et non 03/03/2027), pour ne jamais dépasser l'échéance réglementaire.
 */
export function addMonthsClamped(iso: string, n: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(+iso.slice(8, 10), lastDay))).toISOString().slice(0, 10);
}
