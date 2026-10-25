import { and, count, desc, eq, isNull, like } from 'drizzle-orm';
import * as t from '../schema';
import { demoPdf } from './actions';
import type { SeedTx } from './types';
import { rel } from './dates';

// Jeu de démonstration du paquet 6 (fonctions des modules, migration 0011) : situation de coactivité maîtrisée (PRV-10)
// et pièces jointes ajoutées après la saisie (DUE-09 : DUERP signé et justificatif d'un risque ; AUD-17 : pièces de la
// revue et d'un élément d'entrée ; DOC-11 : certificat de traitement d'un enlèvement), écrites seulement avec `files`.
// Les autres éléments du paquet se calculent (filtres des événements, prévision des recyclages, échéances de la revue,
// événements liés, liens profonds) ou viennent de la migration (rattachement des exigences, VEI-07).

const paris = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`);
const demoFile = (name: string, ref: string) => new File([demoPdf(`Vigie - piece de demonstration - ${ref} - ${name}`)], name, { type: 'application/pdf' });

/**
 * Remplit (une seule fois) les données du paquet 6 : jeu neuf (dans sa transaction) ou base de démonstration antérieure à
 * la migration 0011 (upgradeDemo). Marqueur : aucune situation de coactivité maîtrisée, et événement EV-2026-119 du jeu
 * présent. Les pièces jointes ne sont écrites qu'avec `files` (VIGIE_UPLOAD_DIR), jamais par une vérification en mémoire.
 */
export async function seedModuleFunctions(tx: SeedTx, opts: { files?: boolean } = {}) {
  // Lectures successives : dans une transaction, une seule connexion (pas de requêtes concurrentes sur un client pg).
  const [controls] = await tx.select({ n: count() }).from(t.coactivityControls);
  const [marker] = await tx.select({ n: count() }).from(t.events).where(eq(t.events.id, 'EV-2026-119'));
  if (controls.n > 0 || marker.n === 0) return;

  // PRV-10 : livraisons poids lourds et repli de la nacelle sur la voie de livraison, maîtrisés par un créneau réservé.
  const activities = await tx.select({ id: t.siteActivities.id, title: t.siteActivities.title }).from(t.siteActivities)
    .where(and(eq(t.siteActivities.siteId, 'ville-a'), isNull(t.siteActivities.cancelledAt)));
  const a = activities.find((x) => x.title.startsWith('Livraisons et expéditions poids lourds'));
  const b = activities.find((x) => x.title.startsWith('Repli de la nacelle'));
  if (a && b) {
    const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
    const at = paris(rel(-1), '09:30');
    const measure = 'Livraisons poids lourds suspendues de 13 h à 14 h pendant le repli de la nacelle ; voie balisée et guidée par le magasinier.';
    const [row] = await tx.insert(t.coactivityControls).values({
      siteId: 'ville-a', pairKey: `${lo.id}-${hi.id}`, activityA: lo.id, activityB: hi.id, measure, controlledById: 'clefevre', controlledAt: at,
    }).returning({ id: t.coactivityControls.id });
    await tx.insert(t.changeLog).values({
      entityType: 'site_map', entityId: 'ville-a', action: 'control', byId: 'clefevre', at,
      summary: `Coactivité maîtrisée : « ${lo.title} » et « ${hi.title} » (voie d'accès commune, situation du 08/10/2026)`,
      details: [{ field: 'Mesure prise', from: null, to: measure }, { field: 'Maîtrise', from: null, to: `n° ${row.id}` }],
    });
  }

  if (!opts.files) return;
  const { saveUpload } = await import('../../lib/uploads');
  const attach = async (kind: string, entityId: string, journal: { entityType: string; entityId: string }, field: string, fileName: string, byId: string, at: Date, ref: string) => {
    const file = await saveUpload(demoFile(fileName, ref), kind, entityId, byId, { db: tx, quota: false });
    await tx.update(t.attachments).set({ createdAt: at }).where(eq(t.attachments.id, file.id));
    await tx.insert(t.changeLog).values({
      entityType: journal.entityType, entityId: journal.entityId, action: 'attach', byId, at,
      summary: `${field} ajouté`, details: [{ field, from: null, to: fileName }],
    });
  };

  // DUE-09 : DUERP signé de la version en vigueur, justificatif d'un risque.
  const [current] = await tx.select({ version: t.duerpVersions.version }).from(t.duerpVersions).where(eq(t.duerpVersions.current, true));
  if (current) {
    await attach('duerp_version', current.version, { entityType: 'duerp_version', entityId: current.version }, 'DUERP signé',
      `DUERP-${current.version}-signe.pdf`, 'hmarchand', paris(rel(-203), '17:00'), `DUERP ${current.version}`);
  }
  const [risk] = await tx.select({ id: t.risks.id }).from(t.risks).where(and(eq(t.risks.unitId, 'montage'), like(t.risks.hazard, 'Manutention%'), isNull(t.risks.archivedAt)));
  if (risk) {
    await attach('risk', String(risk.id), { entityType: 'risk', entityId: String(risk.id) }, 'Justificatif',
      'mesurage-charges-poste-montage.pdf', 'clefevre', paris(rel(-15), '11:00'), `risque ${risk.id}`);
  }

  // AUD-17 : présentation de la revue intermédiaire (clôturée : pièces figées) et contribution d'un élément d'entrée.
  const [held] = await tx.select({ id: t.reviews.id }).from(t.reviews).where(eq(t.reviews.reviewOn, rel(-113)));
  if (held) {
    await attach('review', String(held.id), { entityType: 'review', entityId: String(held.id) }, 'Pièce de la revue',
      'presentation-revue-intermediaire-2026.pdf', 'clefevre', paris(rel(-113), '12:00'), 'revue du 18/06/2026');
  }
  const [item] = await tx.select({ id: t.reviewItems.id, reviewId: t.reviewItems.reviewId }).from(t.reviewItems)
    .innerJoin(t.reviews, eq(t.reviews.id, t.reviewItems.reviewId))
    .where(and(eq(t.reviews.reviewOn, rel(62)), eq(t.reviewItems.ownerId, 'edubois'), like(t.reviewItems.label, 'Résultats des audits%')));
  if (item) {
    await attach('review_item', String(item.id), { entityType: 'review', entityId: String(item.reviewId) }, "Pièce d'un élément d'entrée",
      'synthese-audits-2026.pdf', 'edubois', paris(rel(-3), '15:30'), 'revue du 10/12/2026');
  }

  // DOC-11 : certificat de traitement d'un enlèvement de déchets dangereux traité.
  const [entry] = await tx.select({ id: t.wasteEntries.id, bsd: t.wasteEntries.bsdNumber }).from(t.wasteEntries)
    .where(and(eq(t.wasteEntries.bsdStatus, 'traite'), eq(t.wasteEntries.siteId, 'ville-a'), isNull(t.wasteEntries.cancelledAt)))
    .orderBy(desc(t.wasteEntries.removedOn)).limit(1);
  if (entry) {
    await attach('waste_entry', String(entry.id), { entityType: 'waste_entry', entityId: String(entry.id) }, "Pièce de l'enlèvement",
      `certificat-traitement-${entry.bsd ?? entry.id}.pdf`, 'rfontaine', paris(rel(-9), '10:00'), `enlèvement ${entry.id}`);
  }
}
