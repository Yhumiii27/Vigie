import { canApprove, type Role, type Tone } from '@/lib/domain';

// Registre spécial des dangers graves et imminents (CNF-01 ; L. 4131-2, L. 4132-2, D. 4132-1 et D. 4132-2 du code du
// travail ; réponse du service QHSE du 09/11/2026 : « le registre peut être traité sur Vigie uniquement avec un accès
// spécifique pour les membres du CSE »). Règles pures : lecteurs et rédacteurs, état d'un avis, contrôles de saisie.
// Un avis est consigné et signé par un représentant du personnel au CSE (postes concernés, nature et cause du danger, noms
// des travailleurs exposés) ; l'employeur (animateur QHSE) y consigne les mesures prises, puis clôt l'avis. Jamais supprimé.

/** Page du registre (un registre par site, ?site=) et sa version imprimable. */
export const DGI_REGISTER_PATH = '/evenements/registre-dgi';
export const DGI_PRINT_PATH = `${DGI_REGISTER_PATH}/imprimer`;
export const dgiHref = (siteId: string, id?: number) => `${DGI_REGISTER_PATH}?site=${encodeURIComponent(siteId)}${id ? `&avis=${id}` : ''}`;

/** Personne connectée, telle que les droits du registre la lisent. */
export type DgiViewer = { role: Role; cse: boolean };

/** Lecture du registre : animateur QHSE, direction et membres du CSE (quel que soit leur rôle). */
export const canReadDgi = (v: DgiViewer) => canApprove(v.role) || v.cse;
/** Consignation d'un avis : membres du CSE, et l'animateur QHSE (avis recopié d'un registre papier, à signer ensuite). */
export const canRecordDgi = (v: DgiViewer) => v.cse || v.role === 'Animateur QHSE';
/** Signature d'un avis par un représentant du personnel au CSE. */
export const canSignDgi = (v: DgiViewer) => v.cse;
/** Mesures de l'employeur, clôture et annulation d'une saisie erronée : animateur QHSE (service QHSE). */
export const canHandleDgi = (v: DgiViewer) => v.role === 'Animateur QHSE';

export const DGI_READ_DENIED = 'Registre réservé à l’animateur QHSE, à la direction et aux membres du CSE.';
export const DGI_RECORD_DENIED = 'Avis consigné par un membre du CSE (ou recopié par l’animateur QHSE).';
export const DGI_SIGN_DENIED = 'Avis signé par un représentant du personnel au CSE.';

export type DgiStateKey = 'a_signer' | 'signale' | 'mesures' | 'clos' | 'annule';
export const DGI_STATES: Record<DgiStateKey, { label: string; tone: Tone }> = {
  a_signer: { label: 'À signer par le représentant du CSE', tone: 'warn' },
  signale: { label: 'Mesures de l’employeur attendues', tone: 'danger' },
  mesures: { label: 'Mesures prises, à clore', tone: 'warn' },
  clos: { label: 'Clos', tone: 'ok' },
  annule: { label: 'Annulé', tone: 'neutral' },
};

/** État d'un avis d'après ses dates (jamais stocké). */
export function dgiState(n: { signedAt: unknown; measuresAt: unknown; closedAt: unknown; cancelledAt: unknown }): DgiStateKey {
  if (n.cancelledAt) return 'annule';
  if (n.closedAt) return 'clos';
  if (n.measuresAt) return 'mesures';
  return n.signedAt ? 'signale' : 'a_signer';
}

/** Avis ouvert sans mesures de l'employeur : échéance au responsable QHSE du site et à la direction, due le jour même. */
export const needsMeasures = (n: Parameters<typeof dgiState>[0]) => !n.cancelledAt && !n.closedAt && !n.measuresAt;

/** Date et heure de l'alerte (heure de Paris « AAAA-MM-JJTHH:mm ») : ni future, ni antérieure d'un an. */
export function reportedAtError(local: string | null, nowLocal: string): string | null {
  if (!local) return 'Date et heure obligatoires.';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return 'Date et heure invalides.';
  if (local > nowLocal) return 'Date et heure postérieures à maintenant.';
  const yearAgo = `${Number(nowLocal.slice(0, 4)) - 1}${nowLocal.slice(4)}`;
  if (local < yearAgo) return 'Alerte de plus d’un an : à consigner sur le registre papier de l’époque.';
  return null;
}
