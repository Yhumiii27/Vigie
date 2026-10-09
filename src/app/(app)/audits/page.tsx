import type { Metadata } from 'next';
import { CertificationCards } from '@/components/audits/CertificationCards';
import { FindingsCard } from '@/components/audits/FindingsCard';
import { ProgramTimeline } from '@/components/audits/ProgramTimeline';
import { PageHeader } from '@/components/PageHeader';
import { ReviewCard } from '@/components/review/ReviewCard';
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
  const [data, options] = await Promise.all([
    loadAudits({ year: sp.annee, element: sp.element, constat: sp.constat }),
    loadFormOptions(),
  ]);
  const { now, certs, year, yearOptions, tracks, allTracks, plan, planFindings, auditGroups, cancelledFindings, auditOptions, openElement, openFinding } = data;
  const manage = canManage(session.role);
  const approve = canApprove(session.role);
  const nowYear = yearOf(now);
  const curMonth = nowYear === year ? monthOf(now) : nowYear > year ? 13 : 0;
  const actionOptions = { people: options.people, origins: options.origins, sites: options.sites, actions: options.actions };
  const certOptions = certs.map((c) => [c.id, c.standard] as const);
  const closeHref = `/audits?annee=${year}`;

  const yearNav = yearOptions.length > 1 && (
    <SegLinks size={11} pad="3px 8px" options={yearOptions.map((y) => ({ href: `/audits?annee=${y}`, label: String(y), on: y === year }))} />
  );
  const period = curMonth >= 1 && curMonth <= 12 ? `Semaine ${isoWeek(now)} · ${monthName(curMonth)} en cours` : curMonth === 0 ? 'Programme prévisionnel' : 'Année écoulée';

  return (
    <>
      <PageHeader title={SCREENS.audits.title} sub={`Programme ${year} et revue de direction`} />
      <div className="vg-page">
        <CertificationCards certs={certs} canApprove={approve} />

        <ProgramTimeline key={openElement ?? 'prog'} year={year} curMonth={curMonth} tracks={tracks} allTracks={allTracks} items={plan} findings={planFindings}
          certs={certOptions} auditOptions={auditOptions} canManage={manage} options={actionOptions} initialId={openElement} closeHref={closeHref}
          aside={<><Aside>{period}</Aside>{yearNav}</>} />

        {/* Pas de `key` liée au lien profond : la fermeture retire ?constat= de l'URL sans remonter la carte ni changer de groupe. */}
        <FindingsCard groups={auditGroups} cancelled={cancelledFindings} auditOptions={auditOptions} defaultAudit={DEFAULT_AUDIT} canManage={manage}
          options={actionOptions} initialFindingId={openFinding} closeHref={closeHref} />

        <div id="revue" style={{ scrollMarginTop: 16 }}>
          <ReviewCard searchParams={sp} />
        </div>
      </div>
    </>
  );
}
