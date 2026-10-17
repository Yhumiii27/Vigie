import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import type { NotificationType } from '@/lib/domain';
import { hasLeft } from '@/lib/people';
import { today } from '@/lib/today';

// Notifications d'information de la cloche (table notifications, docs/specs/actions-qse.md § 15.1) : une ligne par
// destinataire, écrite dans la transaction de l'écriture qui la provoque. Pas un enregistrement métier tracé (pas de
// logChange) ; lue au clic ou par « Tout marquer comme lu » (flux D). Types et libellés : NOTIFICATION_KINDS
// (src/lib/domain.ts) — action confiée au responsable (ACT-30, jamais d'e-mail) ; commentaire ou preuve ajoutés par le
// responsable, adressés à chaque animateur QHSE (ACT-31, une notification par commentaire ou par preuve) ; suite d'un
// signalement (qualifié, classé sans suite, clôturé), adressée à son déclarant (TDB-06).
// Pas de 'use server' : ce module n'expose aucune action appelable depuis le navigateur ; il ne lit jamais la session
// (auteur `byId` passé explicitement : appelable dans une transaction PGlite).

export type NewNotification = {
  personId: string | null | undefined;
  type: NotificationType;
  entityType: 'action' | 'event';
  entityId: string;
  title: string;
  href: string;
  byId: string | null;
  /** Commentaire notifié (action_commentaire) : son retrait réécrit le titre (withdrawCommentNotifications, D23). */
  commentId?: number | null;
};

/** Ajoute une notification d'information dans la transaction appelante ; rien si personId est vide ou égal à byId. Renvoie l'id. */
export async function notify(tx: DbOrTx, n: NewNotification): Promise<number | null> {
  if (!n.personId || n.personId === n.byId) return null;
  const [row] = await tx.insert(t.notifications).values({
    personId: n.personId, type: n.type, entityType: n.entityType, entityId: n.entityId, title: n.title, href: n.href, byId: n.byId,
    commentId: n.commentId ?? null,
  }).returning({ id: t.notifications.id });
  return row.id;
}

/**
 * Animateurs QHSE destinataires d'ACT-31 : personnes présentes à l'effectif (date du jour, today()) dont le dernier rôle
 * connu (people.last_role) est « Animateur QHSE », dans l'ordre de l'annuaire — même résolution que les animateurs de
 * loadQhseLeads (src/lib/data/leads.ts), sans son cache de requête (appelable dans une transaction).
 */
export async function qhseAnimatorIds(tx: DbOrTx): Promise<string[]> {
  const now = today();
  const rows = await tx.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people)
    .where(eq(t.people.lastRole, 'Animateur QHSE')).orderBy(asc(t.people.sort));
  return rows.filter((p) => !hasLeft(p, now)).map((p) => p.id);
}

/** Extrait d'un texte sur une ligne (espaces réduits), `max` caractères au plus (… final compris). */
export const textExcerpt = (s: string, max = 80) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** « Action A-221 confiée par [C. Lefèvre] : Remplacer le garde-corps… » (ACT-30). */
export const actionConfieeTitle = (id: string, author: string, label: string) => `Action ${id} confiée par ${author} : ${label}`;
/**
 * « A-215 : commentaire de [T. Nguyen] — Garde-corps posé ce matin… » (ACT-31) ; l'extrait est ramené à 80 caractères.
 * `fileNames` : preuves jointes au commentaire, nommées à la suite (« · preuves « a.pdf », « b.jpg » »).
 */
export const actionCommentTitle = (id: string, author: string, excerpt80: string, fileNames: readonly string[] = []) =>
  `${id} : commentaire de ${author} — ${textExcerpt(excerpt80, 80)}${fileNames.length
    ? ` · ${fileNames.length > 1 ? 'preuves' : 'preuve'} ${fileNames.map((f) => `« ${f} »`).join(', ')}` : ''}`;
/** « A-215 : preuve « photo.jpg » ajoutée par [T. Nguyen] » (ACT-31, une notification par fichier). */
export const actionProofTitle = (id: string, author: string, fileName: string) => `${id} : preuve « ${fileName} » ajoutée par ${author}`;
/** Suite donnée à un signalement (TDB-06), notifiée à son déclarant nominatif. */
export type ReportOutcome = 'qualifie' | 'classe' | 'cloture';
const OUTCOME_LABELS: Record<ReportOutcome, string> = { qualifie: 'qualifié', classe: 'classé sans suite', cloture: 'clôturé' };
/** « Votre signalement EV-2026-131 a été qualifié par [C. Lefèvre] : Chute de plain-pied… » (TDB-06). */
export const reportOutcomeTitle = (id: string, outcome: ReportOutcome, author: string, title: string) =>
  `Votre signalement ${id} a été ${OUTCOME_LABELS[outcome]} par ${author} : ${textExcerpt(title, 80)}`;
/** Fiche « Mes signalements » d'un signalement (lien de la notification au déclarant). */
export const myReportHref = (id: string) => `/signaler/mes-signalements/${encodeURIComponent(id)}`;

/**
 * Information du déclarant (TDB-06) : son signalement est qualifié, classé sans suite ou clôturé. Déclarant nominatif de
 * l'effectif seulement (declarant_id, jamais un signalement anonyme ni un déclarant externe sans compte) ; rien quand il
 * est l'auteur du changement. Intitulé de l'événement seul (jamais une donnée de santé : l'intitulé d'un AT n'en porte
 * pas) ; lien vers « Mes signalements ». Dans la transaction de l'écriture.
 */
export async function notifyReportOutcome(tx: DbOrTx, ev: { id: string; title: string; declarantId: string | null; anonymous: boolean },
  outcome: ReportOutcome, by: { id: string; name: string }): Promise<number | null> {
  if (!ev.declarantId || ev.anonymous) return null;
  return notify(tx, {
    personId: ev.declarantId, type: 'signalement_suite', entityType: 'event', entityId: ev.id, byId: by.id,
    title: reportOutcomeTitle(ev.id, outcome, by.name, ev.title), href: myReportHref(ev.id),
  });
}

/** « A-215 : commentaire de [T. Nguyen] — (commentaire retiré) » : titre d'une notification ACT-31 après le retrait. */
export const actionCommentWithdrawnTitle = (id: string, author: string) => `${id} : commentaire de ${author} — (commentaire retiré)`;

/**
 * Retrait d'un commentaire (D23 : le texte retiré n'est plus jamais envoyé au navigateur) : les notifications ACT-31 qui en
 * portent l'extrait (commentId) reçoivent le titre sans extrait, lues ou non, dans la transaction du retrait. Renvoie le
 * nombre de notifications réécrites.
 */
export async function withdrawCommentNotifications(tx: DbOrTx, c: { id: number; actionId: string; author: string }): Promise<number> {
  const rows = await tx.update(t.notifications).set({ title: actionCommentWithdrawnTitle(c.actionId, c.author) })
    .where(eq(t.notifications.commentId, c.id)).returning({ id: t.notifications.id });
  return rows.length;
}
