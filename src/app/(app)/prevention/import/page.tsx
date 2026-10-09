import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ImportScreen, type ImportTab } from '@/components/pp-import/ImportScreen';
import { canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadImportScreen } from './data';

export const metadata: Metadata = { title: 'Importer un plan de prévention' };

// Props typées explicitement : les types de routes générés (PageProps<'/…'>) ne connaissent la route qu'après la génération par next dev / build.
export default async function PreventionImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await guard('prevention');
  const sp = await searchParams;
  const data = await loadImportScreen();
  const tab: ImportTab = sp.onglet === 'modeles' ? 'modeles' : 'import';
  const n = data.templates.length;

  return (
    <>
      <PageHeader title="Importer un plan de prévention"
        sub={`Formulaire PDF remplissable, Word ou scan · champs et cases cochées reconnus · ${n ? `${n} modèle${n > 1 ? 's' : ''} d'import enregistré${n > 1 ? 's' : ''}` : "aucun modèle d'import enregistré"}`} />
      <div className="vg-page">
        <ImportScreen data={data} canManage={canManage(role)} initialTab={tab} />
      </div>
    </>
  );
}
