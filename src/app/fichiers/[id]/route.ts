import { getOptionalSession } from '@/lib/session';
import { canReadAttachment, readAttachment } from '@/lib/uploads';

// Sert une pièce jointe (photo de signalement, document, rapport de contrôle), selon le droit sur l'entité propriétaire
// et le périmètre de sites de la personne connectée. Sans session (proxy contourné, session expirée) : 404.
export async function GET(_req: Request, ctx: RouteContext<'/fichiers/[id]'>) {
  const { id } = await ctx.params;
  const session = await getOptionalSession();
  // Même réponse qu'un fichier absent : ne pas révéler l'existence d'une pièce non autorisée.
  const notFound = () => new Response('Fichier introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!session) return notFound();
  const file = await readAttachment(id);
  if (!file || !(await canReadAttachment(file.row, session))) return notFound();
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.row.mimeType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.row.fileName)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
