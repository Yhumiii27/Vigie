import type { Metadata, Viewport } from 'next';
import { MySpaceView } from '@/components/events/MySpaceView';
import { reportQuery } from '@/lib/rules/events';
import { loadMySpace } from '@/lib/data/my-space';

export const metadata: Metadata = { title: 'Mon espace' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

// Espace salarié mobile (EVT-22) : mes actions, mes habilitations, mes signalements — tout rôle connecté, sur ses seules
// données (loadMySpace). Parcours terrain sans la coque de l'application (portée /signaler de l'application installable,
// EVT-20) ; session obligatoire (getSession redirige vers la connexion : le proxy n'ouvre sans session que /signaler?jeton=).
export default async function MySpacePage({ searchParams }: PageProps<'/signaler/mon-espace'>) {
  const [sp, space] = await Promise.all([searchParams, loadMySpace()]);
  const qs = reportQuery(sp);
  return (
    <main id="contenu" style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>
      <MySpaceView space={space} reportHref={`/signaler${qs}`} myReportsHref={`/signaler/mes-signalements${qs}`} />
    </main>
  );
}
