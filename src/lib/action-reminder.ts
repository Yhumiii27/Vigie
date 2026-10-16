// Rappel hebdomadaire du mercredi (docs/specs/actions-qse.md § 15.2, ACT-32 dans la cloche, ACT-33 par e-mail) : règles
// pures, sans accès à la base ni à la session, partagées par la cloche (src/lib/data/notifications.ts), la tâche d'envoi
// (src/lib/action-reminder-job.ts) et leurs tests.
//
// Contenu (réponse du service QHSE du 15/10/2026, point 11 du § 22 révisé) : toutes les actions du responsable sur tous
// les sites — d'abord ses actions ouvertes (À faire → 80 %), en retard en tête (jours de retard décroissants) puis par
// date cible, ensuite un second groupe « Terminées — en attente de vérification » (jamais en retard) ; Reportées,
// Vérifiées et Abandonnées exclues. Pas de synthèse pour le QHSE : chacun reçoit le rappel de ses propres actions.

import { actionHref, actionLabel, compareActions, isLate, lateDays, SITE_TO_COMPLETE_LABEL } from './action-rules';
import { fmtDate, isoWeekday, isoWeekKey, lastWednesday, toParisLocal } from './dates';
import { ACTION_AVANCEMENTS, AVANCEMENT, REMINDER_KEY_PREFIX, isAvancement, isOpenAvancement, isReminderAvancement, type Avancement } from './domain';

/** Avancements du rappel (ouvertes + Terminée), pour la requête des actions d'un responsable. */
export const REMINDER_AVANCEMENTS: readonly Avancement[] = ACTION_AVANCEMENTS.filter(isReminderAvancement);
/** Lien du rappel : vue générale filtrée sur les actions de la personne connectée (retards d'abord). */
export const REMINDER_HREF = '/actions?mes=1';
/** Libellés des deux groupes du rappel. */
export const REMINDER_OPEN_HEADING = 'Actions en cours';
export const REMINDER_FINISHED_HEADING = 'Terminées — en attente de vérification';

/** Action telle que la lit le rappel (colonnes de la table actions). */
export type ReminderAction = { id: string; detail: string; status: string; dueOn: string; siteId: string | null };
/** Ligne du rappel : numéro, libellé, avancement (« en retard de N j »), date cible, site. */
export type ReminderRow = {
  id: string; label: string; status: Avancement; avancement: string;
  dueOn: string; due: string; late: boolean; lateDays: number; site: string; href: string;
};
/** Contenu du rappel d'une personne : `count` = ouvertes + Terminées, `late` = ouvertes en retard. */
export type ReminderRows = { open: ReminderRow[]; finished: ReminderRow[]; count: number; late: number };

/** Libellé court d'un site (« Site de [Ville A] » pour « Site de [Ville A] — siège et ateliers »). */
const shortSite = (label: string) => label.split(' — ')[0];

/**
 * Lignes du rappel d'une personne à la date `todayIso` (date du jour Vigie) : actions ouvertes triées comme la vue
 * générale (retards d'abord, puis date cible, puis numéro décroissant), puis Terminées par date cible ; les autres
 * avancements sont ignorés. `sites` : libellés par identifiant (site inconnu : son identifiant ; sans site : « Site à
 * compléter »).
 */
export function reminderRows(actions: readonly ReminderAction[], todayIso: string, sites: ReadonlyMap<string, string>): ReminderRows {
  const row = (a: ReminderAction & { status: Avancement }): ReminderRow => {
    const late = isLate(a, todayIso);
    const days = lateDays(a, todayIso);
    return {
      id: a.id, label: actionLabel(a.detail), status: a.status,
      avancement: late ? `${AVANCEMENT[a.status].label} — en retard de ${days} j` : AVANCEMENT[a.status].label,
      dueOn: a.dueOn, due: fmtDate(a.dueOn), late, lateDays: days,
      site: a.siteId ? shortSite(sites.get(a.siteId) ?? a.siteId) : SITE_TO_COMPLETE_LABEL,
      href: actionHref(a.id),
    };
  };
  const kept = actions.filter((a): a is ReminderAction & { status: Avancement } => isAvancement(a.status) && isReminderAvancement(a.status));
  const sorted = [...kept].sort((a, b) => compareActions(a, b, todayIso));
  const open = sorted.filter((a) => isOpenAvancement(a.status)).map(row);
  const finished = sorted.filter((a) => a.status === 'terminee').map(row);
  return { open, finished, count: open.length + finished.length, late: open.filter((r) => r.late).length };
}

/** Intitulé du rappel dans la cloche : « Vos actions QSE en cours : 5, dont 2 en retard ». */
export const reminderTitle = (n: number, m: number) => `Vos actions QSE en cours : ${n}, dont ${m} en retard`;
/** Objet de l'e-mail (format exact du § 15.2) : « Vigie · vos actions QSE en cours (5, dont 2 en retard) ». */
export const reminderSubject = (n: number, m: number) => `Vigie · vos actions QSE en cours (${n}, dont ${m} en retard)`;

/** Mercredi du rappel en cours à la date `todayIso` (le plus récent ≤ todayIso) et sa semaine ISO (« 2026-W42 »). */
export function reminderWeek(todayIso: string): { day: string; week: string } {
  const day = lastWednesday(todayIso);
  return { day, week: isoWeekKey(day) };
}
/** Clé d'état lu du rappel dans la cloche : « rappel-actions|2026-W42 » (une par semaine, D12). */
export const reminderKey = (week: string) => `${REMINDER_KEY_PREFIX}${week}`;

/**
 * Envoi de l'e-mail dû (D13) : le mercredi seulement (date du jour Vigie `todayIso`), à partir de l'heure configurée
 * (heure de Paris de l'instant `now`) et jusqu'à 23:59 ; aucun rattrapage les jours suivants.
 */
export function isReminderDue(todayIso: string, now: Date, time: { hour: number; minute: number }): boolean {
  if (isoWeekday(todayIso) !== 3) return false;
  const clock = toParisLocal(now).slice(11, 16);
  return clock >= `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * E-mail du rappel d'une personne (ACT-33) : objet du § 15.2, texte brut et HTML (valeurs échappées), un tableau par
 * groupe (N°, libellé, avancement avec « en retard de N j », date cible, site), lien vers chaque fiche et vers la vue
 * générale filtrée sur ses actions. `baseUrl` : origine publique de Vigie, sans « / » final.
 */
export function renderReminderEmail(input: { person: { name: string }; rows: ReminderRows; baseUrl: string; day: string }): { subject: string; text: string; html: string } {
  const { person, rows, baseUrl, day } = input;
  const subject = reminderSubject(rows.count, rows.late);
  const all = `${baseUrl}${REMINDER_HREF}`;
  const intro = `Voici vos actions QSE en cours au mercredi ${fmtDate(day)}, sur tous les sites : ${rows.count}, dont ${rows.late} en retard.`;
  const footer = [
    "L'avancement de vos actions est tenu par le service QHSE ; depuis la fiche d'une action, vous pouvez commenter et joindre vos preuves.",
    'Message automatique de Vigie, envoyé chaque mercredi aux responsables d’actions QSE en cours.',
  ];
  const groups = ([[REMINDER_OPEN_HEADING, rows.open], [REMINDER_FINISHED_HEADING, rows.finished]] as const).filter(([, list]) => list.length > 0);

  const text = [
    `Bonjour ${person.name},`, '', intro, '',
    ...groups.flatMap(([heading, list]) => [
      heading,
      ...list.flatMap((r) => [`- ${r.id} · ${r.label}`, `  ${r.avancement} · date cible ${r.due} · ${r.site}`, `  ${baseUrl}${r.href}`]),
      '',
    ]),
    `Toutes vos actions : ${all}`, '', ...footer, '',
  ].join('\n');

  const cell = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top';
  const table = (list: readonly ReminderRow[]) => [
    '<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:14px">',
    `<thead><tr>${['N°', 'Action', 'Avancement', 'Date cible', 'Site'].map((h) => `<th style="${cell};color:#6b7280;font-weight:600">${h}</th>`).join('')}</tr></thead>`,
    '<tbody>',
    ...list.map((r) => `<tr><td style="${cell};white-space:nowrap"><a href="${escapeHtml(baseUrl + r.href)}">${escapeHtml(r.id)}</a></td>`
      + `<td style="${cell}">${escapeHtml(r.label)}</td>`
      + `<td style="${cell}${r.late ? ';color:#b91c1c;font-weight:600' : ''}">${escapeHtml(r.avancement)}</td>`
      + `<td style="${cell};white-space:nowrap">${escapeHtml(r.due)}</td>`
      + `<td style="${cell}">${escapeHtml(r.site)}</td></tr>`),
    '</tbody></table>',
  ].join('\n');
  const html = [
    '<!doctype html>', '<html lang="fr"><head><meta charset="utf-8"><title>', escapeHtml(subject), '</title></head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.45">',
    `<p>Bonjour ${escapeHtml(person.name)},</p>`, `<p>${escapeHtml(intro)}</p>`,
    ...groups.flatMap(([heading, list]) => [`<h3 style="font-size:15px;margin:18px 0 6px">${escapeHtml(heading)}</h3>`, table(list)]),
    `<p style="margin-top:18px"><a href="${escapeHtml(all)}">Toutes vos actions dans Vigie</a></p>`,
    ...footer.map((f) => `<p style="font-size:12px;color:#6b7280">${escapeHtml(f)}</p>`),
    '</body></html>',
  ].join('\n');
  return { subject, text, html };
}
