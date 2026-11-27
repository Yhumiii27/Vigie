import type { NextRequest } from 'next/server';
import { today } from '@/lib/today';
import { canSee } from '@/lib/domain';
import { loadWasteRegisterCsv } from '@/lib/data/environment';
import { getSession } from '@/lib/session';
import { csvResponse } from '@/lib/csv';
import { getI18n } from '@/i18n/server';

// Export du registre chronologique des déchets sortants (site sélectionné) :
//   ?annee=<AAAA>   → CSV de l'année (année en cours par défaut)

export async function GET(req: NextRequest) {
  const [{ role }, { t }] = await Promise.all([getSession(), getI18n()]);
  if (!canSee(role, 'env')) return new Response(t('Access denied'), { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const currentYear = +today().slice(0, 4);
  const raw = req.nextUrl.searchParams.get('annee');
  const year = raw ? Number(raw) : currentYear;
  if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
    return new Response(t('Invalid « annee » parameter'), { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const { csv, fileName } = await loadWasteRegisterCsv(year, t);
  return csvResponse(csv, fileName);
}
