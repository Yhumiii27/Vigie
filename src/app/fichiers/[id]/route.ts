import { getSession } from '@/lib/session';
import { canReadAttachment, readAttachment } from '@/lib/uploads';

// Sert une pièce jointe (photo de signalement, document, rapport de contrôle), selon le droit sur l'entité propriétaire.
export async function GET(_req: Request, ctx: RouteContext<'/fichiers/[id]'>) {
  const { id } = await ctx.params;
  const [file, session] = await Promise.all([readAttachment(id), getSession()]);
  // Même réponse qu'un fichier absent : ne pas révéler l'existence d'une pièce non autorisée.
  if (!file || !(await canReadAttachment(file.row, session))) return new Response('Fichier introuvable', { status: 404 });
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
