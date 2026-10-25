import { loadReviewCard } from '@/lib/data/review';
import { ALL_SITES, getSession } from '@/lib/session';
import { MissingNotice, hrefWith } from '@/components/ui';
import { firstParam, missingDetail } from '@/lib/url-state';
import { ReviewPanel } from './ReviewPanel';

type Params = Record<string, string | string[] | undefined>;

/**
 * Revue de direction de l'écran /audits (préparation, séance, décisions, historique).
 * `searchParams` : paramètres de la page (?revue=<id> choisit la revue, ?revues=annulees affiche les annulées).
 */
export async function ReviewCard({ searchParams }: { searchParams: Params }) {
  const [data, session] = await Promise.all([loadReviewCard({ revue: searchParams.revue }), getSession()]);
  const params = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
  // UX-13 : ?revue=<id> inconnu → revue en cours, avec le bandeau commun (jamais de repli silencieux).
  const asked = firstParam(searchParams.revue);
  const missing = missingDetail(searchParams.revue, data.reviews.some((r) => String(r.id) === asked));
  return (
    <>
      {missing && <MissingNotice text="Revue de direction introuvable : la revue en cours est affichée." closeHref={`${hrefWith('/audits', params, { revue: undefined })}#revue`} />}
      <ReviewPanel data={data} params={params} showCancelled={searchParams.revues === 'annulees'} allSites={session.site.id === ALL_SITES} />
    </>
  );
}
