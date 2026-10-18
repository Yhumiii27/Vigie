// Règles pures de la revue de direction (client-safe, sans import serveur).

/** Revue telle que la voit le contrôle de clôture : participants internes et compte rendu de la séance. */
export type ReviewToClose = { status: string; participantIds: string[] | null; minutes: string | null };
/** Décision de la revue : texte et pilote. */
export type DecisionToClose = { text: string; pilotId: string | null };

/**
 * Contrôles avant la clôture (visa de la direction, AUD-14) : compte rendu saisi (revue « tenue ») avec sa synthèse,
 * au moins un participant de l'entreprise, chaque décision pilotée. Liste vide : la revue peut être clôturée.
 */
export function reviewCloseBlockers(review: ReviewToClose, decisions: DecisionToClose[]): string[] {
  if (review.status !== 'tenue') return ['Saisissez le compte rendu avant de clôturer la revue.'];
  const out: string[] = [];
  if (!review.participantIds?.length) out.push("Indiquez au compte rendu les participants de l'entreprise.");
  if (!review.minutes?.trim()) out.push('Rédigez la synthèse de la séance au compte rendu.');
  const unpiloted = decisions.filter((d) => !d.pilotId);
  if (unpiloted.length === 1) out.push(`Désignez le pilote de la décision « ${clip(unpiloted[0].text)} ».`);
  else if (unpiloted.length > 1) out.push(`Désignez le pilote de ${unpiloted.length} décisions (${unpiloted.map((d) => `« ${clip(d.text)} »`).join(', ')}).`);
  return out;
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
