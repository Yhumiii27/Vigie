import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SkillAlerts } from '@/components/skills/SkillAlerts';
import { SkillMatrix } from '@/components/skills/SkillMatrix';
import { today } from '@/lib/dates';
import { SCREENS, canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { ALL_SITES } from '@/lib/session';
import { loadFormOptions } from '@/lib/data/options';
import { loadSkillMatrix } from '@/lib/data/skills';

export const metadata: Metadata = { title: SCREENS.skills.title };

export default async function SkillsPage() {
  const session = await guard('skills');
  // Bandeaux : titres manquants ou expirés, mais aussi expirant avant ou pendant une affectation Keystone (`lapses`).
  const [{ titles, rows, lapses, others }, { people, sites, origins }] = await Promise.all([loadSkillMatrix(), loadFormOptions()]);
  const manage = canManage(session.role);
  const now = today();
  // Nouveau salarié : site sélectionné, ou le premier site en vue « Tous les sites ».
  const defaultSiteId = session.site.id === ALL_SITES ? sites[0]?.[0] ?? '' : session.site.id;
  const options = { people, sites, origins };

  return (
    <>
      <PageHeader title={SCREENS.skills.title} sub={`${rows.length} salariés · ${titles.length} titres suivis`} />
      <div className="vg-page">
        <SkillAlerts alerts={lapses} canManage={manage} options={options} today={now} />
        <SkillMatrix titles={titles} rows={rows} others={others} canManage={manage} options={options} today={now} defaultSiteId={defaultSiteId} />
      </div>
    </>
  );
}
