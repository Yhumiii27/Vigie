import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ContributionsView } from '@/components/review/ContributionsView';
import { SCREENS } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadMyContributions } from '@/lib/data/review';
import { MissingNotice } from '@/components/ui';
import { missingDetail } from '@/lib/url-state';

export const metadata: Metadata = { title: SCREENS.contributions.title };

/**
 * « Mes contributions à la revue de direction » (AUD-04), ouvert à tous les rôles : éléments de la check-list attendus de
 * la personne (case « fourni »), avancement de la préparation et compte rendu des revues dont elle est participante,
 * contributrice ou pilote d'une décision — sans l'écran Audits (salarié) ni le dossier consolidé (encadrement).
 */
export default async function ContributionsPage({ searchParams }: PageProps<'/audits/contributions'>) {
  await guard('contributions');
  const sp = await searchParams;
  const data = await loadMyContributions({ revue: sp.revue });
  const open = data.reviews.filter((r) => r.editable).length;
  const sub = data.reviews.length
    ? `${data.reviews.length} revue${data.reviews.length > 1 ? 's' : ''} vous concern${data.reviews.length > 1 ? 'ent' : 'e'} · ${open} en préparation ou à clôturer`
    : 'Contributions, participations et décisions vous concernant';
  return (
    <>
      <PageHeader title={SCREENS.contributions.title} sub={sub} />
      <div className="vg-page">
        {/* UX-13 : ?revue=<id> inconnu ou sans contribution de la personne : même bandeau dans les deux cas. */}
        {missingDetail(sp.revue, data.focus != null) && <MissingNotice text="Revue introuvable ou sans contribution de votre part." closeHref="/audits/contributions" />}
        <ContributionsView data={data} />
      </div>
    </>
  );
}
