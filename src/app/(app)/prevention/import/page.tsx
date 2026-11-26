import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ImportScreen, type ImportTab } from '@/components/pp-import/ImportScreen';
import { canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadImportScreen } from './data';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export const metadata: Metadata = { title: 'Importer un plan de prévention' };

// Props typées explicitement : les types de routes générés (PageProps<'/…'>) ne connaissent la route qu'après la génération par next dev / build.
export default async function PreventionImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await guard('prevention');
  const { t } = await getI18n();
  const sp = await searchParams;
  const data = await loadImportScreen();
  const tab: ImportTab = sp.onglet === 'modeles' ? 'modeles' : 'import';
  const n = data.templates.length;

  return (
    <>
      <PageHeader title={t('Import a prevention plan')}
        sub={`${t('Fillable PDF form, Word or scan · fields and ticked boxes recognised')} · ${n ? fill(n > 1 ? t('{n} import templates recorded') : t('{n} import template recorded'), { n }) : t('no import template recorded')}`} />
      <div className="vg-page">
        <ImportScreen data={data} canManage={canManage(role)} initialTab={tab} />
      </div>
    </>
  );
}
