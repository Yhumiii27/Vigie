import type { NextRequest } from 'next/server';
import { today } from '@/lib/today';
import { canSee } from '@/lib/domain';
import { loadWasteRegisterCsv } from '@/lib/data/environment';
import { getSession } from '@/lib/session';

// Export du registre chronologique des déchets sortants (site sélectionné) :
//   ?annee=<AAAA>   → CSV de l'année (année en cours par défaut)

export async function GET(req: NextRequest) {
  const { role } = await getSession();
  if (!canSee(role, 'env')) return new Response('Accès refusé', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const currentYear = +today().slice(0, 4);
  const raw = req.nextUrl.searchParams.get('annee');
  const year = raw ? Number(raw) : currentYear;
  if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
    return new Response('Paramètre « annee » invalide', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const { csv, fileName } = await loadWasteRegisterCsv(year);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
