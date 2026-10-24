import { getOptionalSession } from '@/lib/session';
import { canReadAttachment, readAttachment } from '@/lib/uploads';
import { logAccess } from '@/server/access-log';
import { attachmentHeaders } from '@/lib/file-serving';

// Sert une pièce jointe (photo de signalement, document, rapport de contrôle), selon le droit sur l'entité propriétaire
// et le périmètre de sites de la personne connectée. Sans session (proxy contourné, session expirée) : 404.
// Consultation tracée (SEC-11, journal des consultations) ; pièce médicale jamais gardée en cache par le navigateur
// (poste partagé), les autres pièces une heure. En-têtes de service (SEC-08) : src/lib/file-serving.ts.
export async function GET(_req: Request, ctx: RouteContext<'/fichiers/[id]'>) {
  const { id } = await ctx.params;
  const session = await getOptionalSession();
  // Même réponse qu'un fichier absent : ne pas révéler l'existence d'une pièce non autorisée.
  const notFound = () => new Response('Fichier introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!session) return notFound();
  const file = await readAttachment(id);
  if (!file || !(await canReadAttachment(file.row, session))) return notFound();
  await logAccess({
    kind: 'fichier', entityType: file.row.entityType, entityId: file.row.entityId, attachmentId: file.row.id, health: file.row.health, personId: session.user.id,
  });
  return new Response(new Uint8Array(file.data), { headers: attachmentHeaders(file.row, file.data.length) });
}
