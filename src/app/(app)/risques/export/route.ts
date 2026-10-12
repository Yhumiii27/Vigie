import type { NextRequest } from 'next/server';
import { canSee } from '@/lib/domain';
import { fileSlug, loadDuerpVersion, loadRiskExport, risksCsv } from '@/lib/data/risks';
import { getSession } from '@/lib/session';

// Exports du DUERP, ouverts à tous les rôles (consultation du document unique, R. 4121-4, DUE-01 : contenu déjà affiché à
// l'écran, sans pilote ni événement ; site sélectionné, instantanés réduits au périmètre) :
//   ?unite=<id>                 → CSV de l'unité de travail (site sélectionné)
//   ?portee=tout                → CSV de toutes les unités du site sélectionné (ou de tous les sites)
//   ?version=<n>                → CSV de l'instantané d'une version archivée
//   ?version=<n>&format=json    → instantané en JSON (consultation dans la fenêtre « Versions archivées »)

function csvResponse(body: string, name: string) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const notFound = (msg: string) => new Response(msg, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function GET(req: NextRequest) {
  const { role } = await getSession();
  // Écran « Évaluation des risques » : ouvert à tous les rôles aujourd'hui ; contrôle conservé si ROLES change.
  if (!canSee(role, 'risks')) return new Response('Accès refusé', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const sp = req.nextUrl.searchParams;

  const version = sp.get('version');
  if (version) {
    const v = await loadDuerpVersion(version);
    if (!v) return notFound('Version introuvable');
    if (sp.get('format') === 'json') {
      return Response.json(v, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (!v.snapshot.risks) return notFound('Aucun instantané pour cette version (archivée hors Vigie)');
    return csvResponse(risksCsv(v.snapshot.risks), `DUERP_${fileSlug(v.version)}_archive.csv`);
  }

  const unitId = sp.get('unite');
  if (unitId) {
    const data = await loadRiskExport({ unitId });
    const unit = data.units[0];
    if (!unit) return notFound('Unité de travail introuvable');
    return csvResponse(risksCsv(data.risks), `DUERP_${fileSlug(data.version ?? 'en-cours')}_${fileSlug(unit.label)}.csv`);
  }

  if (sp.get('portee') === 'tout') {
    const data = await loadRiskExport({ all: true });
    const scope = data.siteLabel ? fileSlug(data.siteLabel) : 'tous-sites';
    return csvResponse(risksCsv(data.risks), `DUERP_${fileSlug(data.version ?? 'en-cours')}_${scope}.csv`);
  }

  return new Response('Paramètre attendu : unite, portee=tout ou version', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
