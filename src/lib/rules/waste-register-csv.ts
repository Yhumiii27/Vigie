// Registre chronologique des déchets sortants en CSV (C. env. R. 541-43, arrêté du 31 mai 2021) : en-têtes et mentions en
// chaînes sources anglaises traduites par `t` (langue de la personne, cookie vigie-lang ; français par défaut, en-têtes
// d'avant la traduction mot pour mot) ; libellés des tables de src/lib par labelT ; texte saisi et données tels quels.
// Module pur : lignes préparées par loadWasteRegisterCsv (src/lib/data/environment.ts).
import { labelT } from '@/i18n/labels';
import type { T } from '@/i18n/translate';
import { fmtDate } from '@/lib/dates';
import { toCsv } from '@/lib/csv';
import { BSD_STATUS, toRegisterQuantity, treatmentLabel, type BsdStatus } from './environment';

/** Mentions d'un enlèvement que porte le registre (EntryView de src/lib/data/environment.ts les fournit). */
export type WasteRegisterRow = {
  removedOn: string; site: string; siteSiret: string | null; pickupAddress: string | null; stream: string; ewcCode: string; hazardous: boolean;
  pop: boolean; quantity: number; unit: string; transporter: string; transporterSiret: string | null; transporterAddress: string | null;
  transporterReceipt: string | null; bsdNumber: string | null; missingBsd: boolean; bsdStatus: BsdStatus | null; destination: string;
  destinationSiret: string | null; destinationAddress: string | null; treatmentCode: string; qualificationLabel: string | null; channel: string;
  gaps: string[]; notes: string | null;
};

export function wasteRegisterCsv(rows: readonly WasteRegisterRow[], t: T): string {
  const l = labelT(t);
  const yes = (b: boolean) => (b ? t('Yes') : t('No'));
  const headers = [
    t('Shipping date (collection)'), t('Establishment'), t('Establishment SIRET'), t('Collection address'), t('Usual name of the waste'),
    t('Waste code'), t('Hazardous'), 'POP', t('Quantity'), t('Unit'), t('Quantity (t or m³)'), t('Register unit'),
    t('Carrier'), t('Carrier SIRET'), t('Carrier address'), t('Carrier receipt no.'),
    t('Consignment note no. (BSD)'), t('Consignment note status'),
    t('Destination facility'), t('Facility SIRET'), t('Facility address'),
    t('Treatment code'), t('Treatment operation'), t('Final treatment qualification'), t('Treatment channel'),
    t('Missing items'), t('Remarks'),
  ];
  return toCsv([headers, ...rows.map((e) => {
    const register = toRegisterQuantity(e.quantity, e.unit);
    return [
      fmtDate(e.removedOn), e.site, e.siteSiret ?? '', e.pickupAddress ?? '', e.stream,
      e.ewcCode, yes(e.hazardous), yes(e.pop), e.quantity, e.unit, register?.quantity ?? '', register?.unit ?? '',
      e.transporter, e.transporterSiret ?? '', e.transporterAddress ?? '', e.transporterReceipt ?? '',
      e.bsdNumber ?? (e.missingBsd ? t('MISSING') : ''), e.bsdStatus ? l(BSD_STATUS[e.bsdStatus].label) : '',
      e.destination, e.destinationSiret ?? '', e.destinationAddress ?? '',
      e.treatmentCode, l(treatmentLabel(e.treatmentCode)), e.qualificationLabel ? l(e.qualificationLabel) : '', e.channel,
      e.gaps.join(' · '), e.notes ?? '',
    ];
  })]);
}
