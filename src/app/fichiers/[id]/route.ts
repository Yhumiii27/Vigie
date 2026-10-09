import { readAttachment } from '@/lib/uploads';

// Sert une pièce jointe (photo de signalement, document, rapport de contrôle).
export async function GET(_req: Request, ctx: RouteContext<'/fichiers/[id]'>) {
  const { id } = await ctx.params;
  const file = await readAttachment(id);
  if (!file) return new Response('Fichier introuvable', { status: 404 });
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
