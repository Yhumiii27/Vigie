import { loadReviewCard } from '@/lib/data/review';
import { ALL_SITES, getSession } from '@/lib/session';
import { ReviewPanel } from './ReviewPanel';

type Params = Record<string, string | string[] | undefined>;

/**
 * Revue de direction de l'écran /audits (préparation, séance, décisions, historique).
 * `searchParams` : paramètres de la page (?revue=<id> choisit la revue, ?revues=annulees affiche les annulées).
 */
export async function ReviewCard({ searchParams }: { searchParams: Params }) {
  const [data, session] = await Promise.all([loadReviewCard({ revue: searchParams.revue }), getSession()]);
  const params = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
  return <ReviewPanel data={data} params={params} showCancelled={searchParams.revues === 'annulees'} allSites={session.site.id === ALL_SITES} />;
}
