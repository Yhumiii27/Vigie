// Causeries et quarts d'heure sécurité (CNF-09, réponse du service QHSE du 09/11/2026 : « traités dans Vigie et il faudra
// avoir la possibilité d'envoyer une feuille d'émargement via l'outil à l'ensemble des participants »). Vue de l'écran
// Prévention (?vue=causeries), à côté des plans de prévention et du poste de garde : même public (QHSE, direction,
// encadrement), saisie par l'encadrement qui anime. Règles pures : liens, contrôles de saisie, indicateurs (calculés,
// jamais stockés), message de la feuille d'émargement.

export const SAFETY_TALKS_VIEW = 'causeries';
export const SAFETY_TALKS_HREF = `/prevention?vue=${SAFETY_TALKS_VIEW}`;
export const safetyTalkHref = (id: string) => `${SAFETY_TALKS_HREF}&causerie=${encodeURIComponent(id)}`;
export const SAFETY_TALK_PRINT_PATH = '/prevention/imprimer/causerie';
export const safetyTalkPrintHref = (id: string) => `${SAFETY_TALK_PRINT_PATH}/${encodeURIComponent(id)}`;
/** Ancre de « Mon espace » où le participant signe (EVT-22). */
export const MY_TALKS_ANCHOR = 'causeries';

export const TALK_DURATION_MAX = 480;
export const TALK_PARTICIPANTS_MAX = 200;
/** Causerie saisie au plus tard un an après, au plus tôt 90 jours avant (causerie planifiée). */
const PAST_DAYS = 366;
const FUTURE_DAYS = 90;

/** Date d'une causerie : ni plus d'un an avant aujourd'hui, ni plus de 90 jours après. */
export function talkDateError(heldOn: string | null, today: string): string | null {
  if (!heldOn) return 'Date obligatoire.';
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
  const diff = day(heldOn) - day(today);
  if (diff < -PAST_DAYS) return 'Causerie de plus d’un an : non saisie.';
  if (diff > FUTURE_DAYS) return 'Au plus 90 jours à l’avance.';
  return null;
}

/** La feuille d'émargement ne s'envoie qu'une fois la causerie tenue (date du jour ou passée), non annulée, avec des participants. */
export function sheetBlocker(t: { heldOn: string; cancelled: boolean; participants: number }, today: string): string | null {
  if (t.cancelled) return 'Causerie annulée.';
  if (t.heldOn > today) return 'La feuille d’émargement s’envoie une fois la causerie tenue.';
  if (!t.participants) return 'Aucun participant inscrit.';
  return null;
}

/** Taux d'émargement (0 à 1), null sans participant. */
export function signatureRate(participants: readonly { signedAt: unknown }[]): number | null {
  if (!participants.length) return null;
  return participants.filter((p) => !!p.signedAt).length / participants.length;
}

export const fmtRate = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)} %`);

export type TalkStatsRow = { siteId: string; month: string; talks: number; participants: number; signed: number; rate: number | null };

/** Indicateurs par site et par mois (AAAA-MM) : causeries tenues (annulées exclues), participants, émargements, taux. */
export function talkStats(talks: readonly { siteId: string; heldOn: string; cancelled: boolean; participants: readonly { signedAt: unknown }[] }[]): TalkStatsRow[] {
  const rows = new Map<string, TalkStatsRow>();
  for (const t of talks) {
    if (t.cancelled) continue;
    const month = t.heldOn.slice(0, 7);
    const key = `${t.siteId}|${month}`;
    const row = rows.get(key) ?? { siteId: t.siteId, month, talks: 0, participants: 0, signed: 0, rate: null };
    row.talks += 1;
    row.participants += t.participants.length;
    row.signed += t.participants.filter((p) => !!p.signedAt).length;
    row.rate = row.participants ? row.signed / row.participants : null;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.month.localeCompare(a.month) || a.siteId.localeCompare(b.siteId));
}

/** Adresse utilisable comme destinataire (une seule, sans espace ni chevron : aucune injection d'en-tête). */
export const isMailAddress = (s: string | null | undefined): s is string => !!s && /^[^\s<>@",;]+@[^\s<>@",;]+\.[^\s<>@",;]+$/.test(s);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** E-mail de la feuille d'émargement (texte et HTML échappé) : thème, date, site, animateur, lien vers « Mon espace ». */
export function attendanceEmail(t: { id: string; theme: string; heldOn: string; site: string; animator: string; link: string }) {
  const date = `${t.heldOn.slice(8, 10)}/${t.heldOn.slice(5, 7)}/${t.heldOn.slice(0, 4)}`;
  const subject = `Feuille d'émargement à signer : ${t.theme} (${date})`;
  const text = [
    'Bonjour,', '',
    `Vous avez participé à la causerie sécurité « ${t.theme} » du ${date} (${t.site}), animée par ${t.animator}.`,
    'Merci de signer la feuille d’émargement dans Vigie (un clic, depuis « Mon espace ») :', `  ${t.link}`, '',
    `Référence : ${t.id}`, '— Vigie',
  ].join('\n');
  const html = `<p>Bonjour,</p><p>Vous avez participé à la causerie sécurité « ${escapeHtml(t.theme)} » du ${date} (${escapeHtml(t.site)}), animée par ${escapeHtml(t.animator)}.</p>`
    + `<p>Merci de signer la feuille d’émargement dans Vigie (un clic, depuis « Mon espace ») : <a href="${escapeHtml(t.link)}">signer la feuille d’émargement</a>.</p>`
    + `<p>Référence : ${escapeHtml(t.id)}<br>— Vigie</p>`;
  return { subject, text, html };
}
