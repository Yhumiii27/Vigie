import 'server-only';
import { count, eq } from 'drizzle-orm';
import { fmtDate } from '../../lib/dates';
import { ACTION_SOURCES, VERIFY_METHODS } from '../../lib/domain';
import * as t from '../schema';
import { paris, status } from './actions';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration des études de sécurité des procédés (VG-01 à VG-05, migration 0023), aligné sur la démonstration
// d'Arche (CAPEX CPX-APM-2026-01 « Second extrusion line », rapport HazID NOT-CPX-APM-2026-01-002 de son catalogue Codex
// simulé) ; usine portée par le site A de Vigie, faute de site de filiale dans le jeu :
// - ES-001 : HazID (HS 2) validée, favorable — jalon franchi ;
// - ES-002 : HazOp (HS 3) validée avec réserves, trois recommandations (actions QSE, source HAZOP) : A-191 réserve
//   bloquante ouverte, A-192 en retard au 09/10, A-193 vérifiée efficace — jalon non franchi (réserve bloquante) ;
// - ES-003 : PSSR planifiée dans 25 jours.
// Numéros A-191 à A-193 : libres dans le jeu, sous le compteur (222), jamais réattribués. Une seule fois : jeu neuf ou base
// de démonstration antérieure à la migration 0023 (upgradeDemo) ; marqueur : aucune étude et personnes du jeu présentes.

export const DEMO_CAPEX = 'CPX-APM-2026-01';
const SITE = 'ville-a';
const QHSE = 'clefevre';

type StudySeed = typeof t.processSafetyStudies.$inferInsert;
type ActionSeed = typeof t.actions.$inferInsert;

const STUDIES: StudySeed[] = [
  {
    id: 'ES-001', siteId: SITE, capexCode: DEMO_CAPEX, milestone: 'HS2', type: 'hazid', status: 'validee', sessionOn: rel(-120), validatedOn: rel(-112),
    conclusion: 'favorable', facilitatorId: QHSE, reportRef: 'NOT-CPX-APM-2026-01-002', createdById: QHSE, createdAt: paris(rel(-140)),
    scope: 'Seconde ligne d’extrusion : réception matière, extrudeuse, bain de refroidissement, découpe et stockage.',
  },
  {
    id: 'ES-002', siteId: SITE, capexCode: DEMO_CAPEX, milestone: 'HS3', type: 'hazop', status: 'validee', sessionOn: rel(-35), validatedOn: rel(-30),
    conclusion: 'reserves', facilitatorExternal: '[Bureau d’études procédés]', reportRef: 'NOT-CPX-APM-2026-01-004', createdById: QHSE, createdAt: paris(rel(-60)),
    scope: 'Nœuds 1 à 6 du P&ID PID-CPX-APM-2026-01-001 : alimentation, fourreau, filière, circuit de refroidissement.',
  },
  {
    id: 'ES-003', siteId: SITE, capexCode: DEMO_CAPEX, milestone: 'PSSR', type: 'pssr', status: 'planifiee', sessionOn: rel(25),
    facilitatorId: QHSE, createdById: QHSE, createdAt: paris(rel(-10)),
    scope: 'Revue avant démarrage de la seconde ligne : réserves HazOp, consignations, formation des opérateurs.',
  },
];

const base = { source: 'hazop' as const, siteId: SITE, domain: 'securite' as const, safetyStudyId: 'ES-002', createdAt: paris(rel(-29)), openedOn: rel(-29) };
const RECOMMENDATIONS: (ActionSeed & { id: string })[] = [
  {
    ...base, id: 'A-191', safetyStudyBlocking: true, pilotId: 'edubois', status: 'p40', priority: 'urgent', dueOn: rel(20), initialDueOn: rel(20), verifyDueOn: rel(40), riskLevel: 3,
    originRef: 'ES-002 · HazOp · CPX-APM-2026-01', detail: 'Ajouter une sécurité de température haute indépendante sur le fourreau de l’extrudeuse',
    problem: 'HazOp nœud 2 : la seule régulation de température du fourreau ne protège pas d’une surchauffe (décomposition de la matière).',
  },
  {
    ...base, id: 'A-192', pilotId: 'sbenali', status: 'initiee', priority: 'moyen_terme', dueOn: rel(-5), initialDueOn: rel(-5), verifyDueOn: rel(20),
    originRef: 'ES-002 · HazOp · CPX-APM-2026-01', detail: 'Rédiger la consigne de purge du circuit de refroidissement',
    problem: 'HazOp nœud 5 : purge du bain de refroidissement sans consigne écrite (risque de brûlure).',
  },
  {
    ...base, id: 'A-193', pilotId: 'edubois', status: 'verifiee', priority: 'moyen_terme', dueOn: rel(-12), initialDueOn: rel(-12), doneOn: rel(-15), verifyDueOn: rel(-8),
    closedOn: rel(-8), verifyMethod: 'audit_visite', efficacyNote: 'Arrêt d’urgence posé et essayé sur la découpe.', effective: true, verifiedById: QHSE,
    originRef: 'ES-002 · HazOp · CPX-APM-2026-01', detail: 'Ajouter un arrêt d’urgence au poste de découpe',
    problem: 'HazOp nœud 6 : aucun arrêt d’urgence accessible depuis le poste de découpe.',
  },
];

/** Remplit (une seule fois) les études de démonstration et leurs recommandations, avec leur journal. */
export async function seedProcessSafety(tx: SeedTx) {
  const [[studies], [lead], [site]] = await Promise.all([
    tx.select({ n: count() }).from(t.processSafetyStudies),
    tx.select({ n: count() }).from(t.people).where(eq(t.people.id, QHSE)),
    tx.select({ n: count() }).from(t.sites).where(eq(t.sites.id, SITE)),
  ]);
  if (studies.n > 0 || lead.n === 0 || site.n === 0) return;
  // Base mise à niveau : un numéro du jeu déjà pris (action créée depuis) n'est jamais réattribué ; recommandation omise.
  const taken = new Set((await tx.select({ id: t.actions.id }).from(t.actions)).map((a) => a.id));
  const recs = RECOMMENDATIONS.filter((a) => !taken.has(a.id));
  await tx.insert(t.processSafetyStudies).values(STUDIES);
  if (recs.length) await tx.insert(t.actions).values(recs);
  const log: (typeof t.changeLog.$inferInsert)[] = [
    ...STUDIES.map((s) => ({
      entityType: 'process_safety_study', entityId: s.id!, action: 'create', byId: QHSE, at: s.createdAt as Date,
      summary: `Étude ${s.type === 'hazid' ? 'HazID' : s.type === 'hazop' ? 'HazOp' : 'PSSR'} (jalon ${s.milestone === 'HS2' ? 'HS 2' : s.milestone === 'HS3' ? 'HS 3' : 'PSSR'}) planifiée le ${fmtDate(s.sessionOn)}`,
    })),
    {
      entityType: 'process_safety_study', entityId: 'ES-001', action: 'validate', byId: QHSE, at: paris(rel(-112), '16:00'), summary: `Étude validée le ${fmtDate(rel(-112))} : favorable`,
      details: [{ field: 'Statut', from: 'Planifiée', to: 'Validée' }, { field: 'Conclusion', from: null, to: 'Favorable' }],
    },
    {
      entityType: 'process_safety_study', entityId: 'ES-002', action: 'validate', byId: QHSE, at: paris(rel(-30), '16:00'), summary: `Étude validée le ${fmtDate(rel(-30))} : favorable avec réserves`,
      details: [{ field: 'Statut', from: 'Planifiée', to: 'Validée' }, { field: 'Conclusion', from: null, to: 'Favorable avec réserves' }],
    },
  ];
  for (const a of recs) {
    const blocking = !!a.safetyStudyBlocking;
    log.push({
      entityType: 'action', entityId: a.id, action: 'create', summary: 'Action créée', byId: QHSE, at: a.createdAt as Date,
      details: [
        { field: 'Source', from: null, to: ACTION_SOURCES.hazop.label },
        { field: 'Date cible', from: null, to: fmtDate(a.initialDueOn) },
        ...(blocking ? [{ field: 'Réserve bloquante', from: null, to: 'oui' }] : []),
      ],
    }, {
      entityType: 'process_safety_study', entityId: 'ES-002', action: 'link', byId: QHSE, at: a.createdAt as Date,
      summary: `Action ${a.id} créée et rattachée${blocking ? ' (réserve bloquante)' : ''}`,
    });
    if (a.status === 'p40' || a.status === 'initiee') log.push(status(a.id, 'step', 'a_faire', a.status, paris(rel(-20), '09:00'), QHSE));
    if (a.status === 'verifiee') {
      log.push(
        status(a.id, 'finish', 'a_faire', 'terminee', paris(a.doneOn!, '17:00'), QHSE, { doneOn: a.doneOn!, details: [{ field: 'Date effective', from: null, to: fmtDate(a.doneOn!) }] }),
        status(a.id, 'verify', 'terminee', 'verifiee', paris(a.closedOn!, '17:30'), QHSE, {
          effective: true,
          details: [
            { field: 'Date de vérification', from: null, to: fmtDate(a.closedOn!) },
            { field: 'Nature de la vérification', from: null, to: VERIFY_METHODS[a.verifyMethod!] },
            { field: 'Résultat', from: null, to: 'Efficace' },
          ],
        }),
      );
    }
  }
  await tx.insert(t.changeLog).values(log);
}
