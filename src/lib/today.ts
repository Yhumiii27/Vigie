import 'server-only';
import { config } from './config';

/** Date du jour à Paris (AAAA-MM-JJ) ; en démonstration, `VIGIE_TODAY` fige la date de référence. */
export function today(): string {
  const fixed = config().today;
  if (fixed) return fixed;
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
