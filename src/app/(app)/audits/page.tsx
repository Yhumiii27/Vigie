import type { Metadata } from 'next';
import { CertificationCards } from '@/components/audits/CertificationCards';
import { FindingsCard } from '@/components/audits/FindingsCard';
import { ProgramTimeline } from '@/components/audits/ProgramTimeline';
import { ReviewChecklist } from '@/components/audits/ReviewChecklist';
import { PageHeader } from '@/components/PageHeader';
import { Aside, SegLinks } from '@/components/ui';
import { isoWeek, monthName, monthOf, yearOf } from '@/lib/dates';
import { SCREENS, canApprove, canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { DEFAULT_AUDIT, loadAudits } from '@/lib/data/audits';
import { loadFormOptions } from '@/lib/data/options';

export const metadata: Metadata = { title: SCREENS.audits.title };

export default async function AuditsPage({ searchParams }: PageProps<'/audits'>) {
  const session = await guard('audits');
  const sp = await searchParams;
  const [{ now, certs, year, yearOptions, tracks, allTracks, plan, auditGroups, review }, options] = await Promise.all([
    loadAudits({ year: sp.annee }),
    loadFormOptions(),
  ]);
  const manage = canManage(session.role);
  const approve = canApprove(session.role);
  const nowYear = yearOf(now);
  const curMonth = nowYear === year ? monthOf(now) : nowYear > year ? 13 : 0;
  const actionOptions = { people: options.people, origins: options.origins, sites: options.sites };
  const ownerSuggestions = [...options.people.map(([, label]) => label.split(' — ')[0]), 'Vigie · automatique'];

  const yearNav = yearOptions.length > 1 && (
    <SegLinks size={11} pad="3px 8px" options={yearOptions.map((y) => ({ href: `/audits?annee=${y}`, label: String(y), on: y === year }))} />
  );
  const period = curMonth >= 1 && curMonth <= 12 ? `Semaine ${isoWeek(now)} · ${monthName(curMonth)} en cours` : curMonth === 0 ? 'Programme prévisionnel' : 'Année écoulée';

  return (
    <>
      <PageHeader title={SCREENS.audits.title} sub={`Programme ${year} et revue de direction`} />
      <div className="vg-page">
        <CertificationCards certs={certs} canApprove={approve} />

        <ProgramTimeline year={year} curMonth={curMonth} tracks={tracks} allTracks={allTracks} items={plan} canManage={manage} options={actionOptions}
          aside={<><Aside>{period}</Aside>{yearNav}</>} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
          <FindingsCard groups={auditGroups} defaultAudit={DEFAULT_AUDIT} canManage={manage} options={actionOptions} />
          <ReviewChecklist reviewOn={review.reviewOn} items={review.items} canManage={manage} ownerSuggestions={ownerSuggestions} />
        </div>
      </div>
    </>
  );
}
