import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ContributionsView } from '@/components/review/ContributionsView';
import { SCREENS } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadMyContributions } from '@/lib/data/review';
import { MissingNotice } from '@/components/ui';
import { missingDetail } from '@/lib/url-state';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export const metadata: Metadata = { title: SCREENS.contributions.title };

/**
 * « Mes contributions à la revue de direction » (AUD-04), ouvert à tous les rôles : éléments de la check-list attendus de
 * la personne (case « fourni »), avancement de la préparation et compte rendu des revues dont elle est participante,
 * contributrice ou pilote d'une décision — sans l'écran Audits (salarié) ni le dossier consolidé (encadrement).
 */
export default async function ContributionsPage({ searchParams }: PageProps<'/audits/contributions'>) {
  await guard('contributions');
  const { t } = await getI18n();
  const sp = await searchParams;
  const data = await loadMyContributions({ revue: sp.revue });
  const open = data.reviews.filter((r) => r.editable).length;
  const sub = data.reviews.length
    ? fill(data.reviews.length > 1 ? t('{n} reviews concern you · {open} in preparation or to close') : t('{n} review concerns you · {open} in preparation or to close'), { n: data.reviews.length, open })
    : t('Contributions, participations and decisions concerning you');
  return (
    <>
      <PageHeader title={SCREENS.contributions.title} sub={sub} />
      <div className="vg-page">
        {/* UX-13 : ?revue=<id> inconnu ou sans contribution de la personne : même bandeau dans les deux cas. */}
        {missingDetail(sp.revue, data.focus != null) && <MissingNotice text={t('Review not found or without any contribution from you.')} closeHref="/audits/contributions" />}
        <ContributionsView data={data} />
      </div>
    </>
  );
}
