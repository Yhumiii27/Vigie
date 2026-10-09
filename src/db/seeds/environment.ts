import 'server-only';
import * as t from '../schema';
import type { SeedTx } from './types';

// Jeu de données initial du domaine « Environnement et déchets », relatif au 07/10/2026.
// Registre 2026 incomplet : quatre enlèvements de déchets dangereux sans bordereau Trackdéchets
// (exigence « Code de l'environnement — R. 541-45 · Trackdéchets » à évaluer dans la veille).
// Deux bordereaux non finalisés plus de 30 jours après la collecte (FD-11 du 19/08, FD-04 du 27/08), un enlèvement
// annulé (doublon du 08/07, motif conservé), le relevé de septembre 2026 manquant sur le site B, et les deux
// enlèvements consécutifs au déversement EV-2026-126 rattachés à l'événement.

// [id, site, libellé, code déchet, unité, code traitement, filière de traitement, collecteur, installation de destination]
const STREAMS: [string, string, string, string, string, string, string, string, string][] = [
  ['FD-01', 'ville-a', 'Huiles hydrauliques usagées', '13 01 10*', 'kg', 'R9', 'Régénération', '[Collecteur Huiles Ouest]', '[Raffinerie de régénération — Ville C]'],
  ['FD-02', 'ville-a', 'Absorbants et chiffons souillés', '15 02 02*', 'kg', 'R1', 'Valorisation énergétique (cimenterie)', '[Collecteur DD Ouest]', '[Cimenterie — Ville D]'],
  ['FD-03', 'ville-a', 'Emballages souillés (fûts, bidons)', '15 01 10*', 'kg', 'R4', 'Reconditionnement et recyclage des métaux', '[Collecteur DD Ouest]', '[Centre de reconditionnement de fûts — Ville E]'],
  ['FD-04', 'ville-a', 'Fluides de coupe usagés', '12 01 09*', 'kg', 'D9', 'Traitement physico-chimique', '[Collecteur DD Ouest]', '[Centre de traitement physico-chimique — Ville F]'],
  ['FD-05', 'ville-a', "Copeaux et chutes d'acier", '12 01 01', 'kg', 'R4', 'Recyclage matière', '[Ferrailleur Ouest]', '[Centre de recyclage des métaux — Ville A]'],
  ['FD-06', 'ville-a', "Copeaux d'aluminium", '12 01 03', 'kg', 'R4', 'Recyclage matière', '[Ferrailleur Ouest]', '[Centre de recyclage des métaux — Ville A]'],
  ['FD-07', 'ville-a', 'Cartons', '15 01 01', 'kg', 'R3', 'Recyclage matière', '[Collecteur DIB Ouest]', '[Papeterie — Ville G]'],
  ['FD-08', 'ville-a', 'Palettes et bois', '15 01 03', 'kg', 'R3', 'Recyclage en panneaux', '[Collecteur DIB Ouest]', '[Plateforme bois — Ville H]'],
  ['FD-09', 'ville-a', 'Déchets en mélange (DIB)', '20 03 01', 'kg', 'D10', 'Incinération', '[Collecteur DIB Ouest]', '[Unité d’incinération — Ville A]'],
  ['FD-10', 'ville-b', "Résidus d'essais et emballages souillés", '15 01 10*', 'kg', 'D10', 'Incinération de déchets dangereux', '[Collecteur DD Ouest]', '[Centre d’incinération de déchets dangereux — Ville I]'],
  ['FD-11', 'ville-b', "Huiles hydrauliques usagées (banc d'essais)", '13 01 10*', 'kg', 'R9', 'Régénération', '[Collecteur Huiles Ouest]', '[Raffinerie de régénération — Ville C]'],
  ['FD-12', 'ville-b', "Déchets en mélange (zone d'essais)", '20 03 01', 'kg', 'D10', 'Incinération', '[Collecteur DIB Ouest]', '[Unité d’incinération — Ville B]'],
];

// [filière, date d'enlèvement, quantité (kg), n° BSD, statut BSD, transporteur (défaut : collecteur), notes]
const ENTRIES: [string, string, number, string | null, string | null, string | null, string | null][] = [
  ['FD-07', '2025-10-08', 640, null, null, null, null],
  ['FD-05', '2025-10-15', 2860, null, null, null, null],
  ['FD-09', '2025-10-22', 1180, null, null, '[Transports Benne Express]', null],
  ['FD-12', '2025-11-05', 280, null, null, null, null],
  ['FD-01', '2025-11-14', 420, 'BSD-20251113-4HZT8QWM', 'traite', null, null],
  ['FD-06', '2025-11-19', 540, null, null, null, null],
  ['FD-02', '2025-12-03', 160, 'BSD-20251202-9RVX2LKC', 'traite', null, null],
  ['FD-08', '2025-12-10', 1450, null, null, null, null],
  ['FD-05', '2025-12-17', 3120, null, null, null, null],
  ['FD-09', '2026-01-14', 1260, null, null, '[Transports Benne Express]', null],
  ['FD-07', '2026-01-21', 580, null, null, null, null],
  ['FD-10', '2026-01-28', 120, 'BSD-20260127-W2GH8PLD', 'traite', null, null],
  ['FD-04', '2026-02-11', 1850, 'BSD-20260210-T3MP6YQA', 'traite', null, null],
  ['FD-01', '2026-02-20', 380, 'BSD-20260219-8NWD5KRE', 'traite', null, null],
  ['FD-05', '2026-03-04', 3340, null, null, null, null],
  ['FD-03', '2026-03-12', 240, 'BSD-20260312-7KQ4P2XR', 'traite', null, null],
  ['FD-12', '2026-03-18', 310, null, null, null, null],
  ['FD-06', '2026-03-25', 610, null, null, null, null],
  ['FD-10', '2026-04-09', 140, null, null, null, "Résidus de simulants d'essai, collecte ponctuelle : bordereau non saisi dans Trackdéchets."],
  ['FD-09', '2026-04-15', 1120, null, null, '[Transports Benne Express]', null],
  ['FD-08', '2026-04-22', 1280, null, null, null, null],
  ['FD-02', '2026-05-06', 190, 'BSD-20260505-2CJF7VNS', 'traite', null, null],
  ['FD-01', '2026-05-22', 450, 'BSD-20260521-6PLQ9XTA', 'traite', null, null],
  ['FD-05', '2026-06-03', 2980, null, null, null, null],
  ['FD-04', '2026-06-12', 2100, null, null, null, 'Enlèvement en urgence (bac de la CU-2 saturé) sous bordereau papier — à régulariser dans Trackdéchets.'],
  ['FD-11', '2026-06-17', 260, 'BSD-20260616-H4VK7NQS', 'traite', null, null],
  ['FD-07', '2026-06-24', 720, null, null, null, null],
  ['FD-12', '2026-07-01', 290, null, null, null, null],
  ['FD-09', '2026-07-08', 1340, null, null, '[Transports Benne Express]', null],
  ['FD-03', '2026-07-17', 210, null, null, null, 'Numéro de bordereau non communiqué par le collecteur — relance en cours.'],
  ['FD-11', '2026-08-19', 240, 'BSD-20260818-M3QX7TBC', 'collecte', null, 'Certificat de traitement non reçu de la raffinerie.'],
  ['FD-05', '2026-08-26', 2450, null, null, null, 'Activité réduite (fermeture estivale).'],
  ['FD-04', '2026-08-27', 1920, 'BSD-20260826-K5RW3HDN', 'emis', null, 'Signature du transporteur en attente dans Trackdéchets.'],
  ['FD-06', '2026-09-09', 580, null, null, null, null],
  ['FD-08', '2026-09-16', 1390, null, null, null, null],
  ['FD-10', '2026-09-23', 110, 'BSD-20260922-R8DM2XWF', 'collecte', null, null],
  ['FD-01', '2026-09-29', 520, 'BSD-20260928-Q7TB4MZE', 'collecte', null, "Huile pompée dans la rétention après le déversement EV-2026-126 et vidange de la cuve 1 000 L du magasin."],
  ['FD-02', '2026-09-29', 85, null, null, null, 'Absorbants utilisés lors du déversement EV-2026-126 — BSD à créer.'],
];

// Consommations mensuelles : saisonnalité (janvier → décembre) et niveaux de base par site.
const SEASON = {
  electricite: [1.18, 1.12, 1.05, 0.98, 0.95, 0.93, 0.9, 0.62, 0.97, 1.02, 1.1, 1.08],
  gaz: [1.9, 1.7, 1.35, 0.85, 0.4, 0.18, 0.12, 0.1, 0.25, 0.7, 1.35, 1.75],
  eau: [0.95, 0.95, 1, 1, 1.05, 1.1, 1.15, 0.6, 1.05, 1, 1, 0.9],
} as const;
// Site A : siège et ateliers ; site B : zone d'essais (bancs électriques, chauffage électrique, pas de gaz).
const BASE: Record<string, Partial<Record<keyof typeof SEASON, number>>> = {
  'ville-a': { electricite: 52_000, gaz: 38_000, eau: 150 },
  'ville-b': { electricite: 9_200, eau: 24 },
};
// Évolution 2026 / 2025 : relamping LED et chauffage mieux régulé, eau stable.
const TREND_2026: Record<keyof typeof SEASON, number> = { electricite: 0.955, gaz: 0.93, eau: 1.02 };

const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;

export async function seedEnvironment(tx: SeedTx) {
  const streams = STREAMS.map(([id, siteId, label, ewcCode, unit, treatmentCode, channel, collector, destination]) => ({
    id, siteId, label, ewcCode, hazardous: ewcCode.endsWith('*'), unit, treatmentCode, channel, collector, destination,
  }));
  await tx.insert(t.wasteStreams).values(streams);

  const byId = new Map(streams.map((s) => [s.id, s]));
  await tx.insert(t.wasteEntries).values(ENTRIES.map(([streamId, removedOn, quantity, bsdNumber, bsdStatus, transporter, notes]) => {
    const s = byId.get(streamId)!;
    return {
      siteId: s.siteId, streamId, removedOn, quantity, bsdNumber, bsdStatus,
      // Copies figées à l'inscription (cf. saveWasteEntry).
      ewcCode: s.ewcCode, treatmentCode: s.treatmentCode, destination: s.destination,
      transporter: transporter ?? s.collector, notes,
      // Enlèvements consécutifs au déversement du magasin.
      eventId: notes?.includes('EV-2026-126') ? 'EV-2026-126' : null,
    };
  }));
  // Doublon saisi par erreur puis annulé (registre conservé : jamais de suppression).
  const dib = byId.get('FD-09')!;
  await tx.insert(t.wasteEntries).values({
    siteId: dib.siteId, streamId: dib.id, removedOn: '2026-07-09', quantity: 1340, transporter: '[Transports Benne Express]',
    ewcCode: dib.ewcCode, treatmentCode: dib.treatmentCode, destination: dib.destination, notes: null,
    cancelledAt: new Date('2026-07-10T09:30:00+02:00'), cancelledById: 'clefevre', cancelReason: "Doublon de l'enlèvement du 08/07/2026 (saisie en double).",
  });

  // Janvier 2025 → septembre 2026 (août 2026 pour le site B : relevé de septembre manquant), léger aléa de ±4 %.
  const rows: (typeof t.consumptions.$inferInsert)[] = [];
  Object.entries(BASE).forEach(([siteId, kinds], si) => {
    const months = siteId === 'ville-b' ? 20 : 21;
    for (let i = 0; i < months; i++) {
      const y = 2025 + Math.floor(i / 12), m = (i % 12) + 1;
      (Object.keys(kinds) as (keyof typeof SEASON)[]).forEach((kind, ki) => {
        const jitter = 1 + (((m * 7 + y * 3 + si * 5 + ki * 2) % 9) - 4) / 100;
        const trend = y === 2026 ? TREND_2026[kind] : 1;
        rows.push({ siteId, month: iso(y, m), kind, value: Math.round(kinds[kind]! * SEASON[kind][m - 1] * jitter * trend) });
      });
    }
  });
  await tx.insert(t.consumptions).values(rows);
}
