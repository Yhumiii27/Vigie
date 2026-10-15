import { describe, expect, it } from 'vitest';
import { nextVersion } from '@/components/documents/meta';
import { RISK_TODO_KIND, VACANT_QHSE_LEAD, type Avancement, type RiskFlag } from '@/lib/domain';
import type { Recipients } from './leads';
import {
  levelName, parseProgramSnapshot, parseVersion, programCandidateIds, programDefaultIds, programLinesInScope, programTotals, riskFlag,
  suggestNextVersion, unitRiskTodos, versionConflict,
} from './risks';

// Règles du DUERP (QUA-03) : alerte calculée d'un risque, numéros de version, destinataires des alertes par unité (TDB-01),
// programme annuel de prévention (DUE-02) ; indices de version des documents maîtrisés.

describe('riskFlag : alerte calculée d’un risque', () => {
  const risk = (g: number, p: number, rg: number, rp: number, residualReviewedOn: string | null = null) =>
    ({ gravity: g, probability: p, residualGravity: rg, residualProbability: rp, residualReviewedOn });
  it('cotation brute ≥ 8 sans action : à définir', () => {
    expect(riskFlag(risk(4, 2, 4, 2), [])).toEqual({ flag: 'toDefine', lastClosedOn: null });
    expect(riskFlag(risk(3, 2, 3, 2), [])).toEqual({ flag: null, lastClosedOn: null });
  });
  it('actions en cours : aucune alerte', () => {
    expect(riskFlag(risk(4, 4, 4, 4), [{ done: true, closedOn: '2026-09-01' }, { done: false, closedOn: null }]).flag).toBeNull();
  });
  it('toutes les actions vérifiées : résiduel encore élevé, ou à recoter depuis la dernière clôture', () => {
    const closed = [{ done: true, closedOn: '2026-09-01' }, { done: true, closedOn: '2026-09-20' }];
    expect(riskFlag(risk(4, 4, 3, 3), closed)).toEqual({ flag: 'residualHigh', lastClosedOn: '2026-09-20' });
    expect(riskFlag(risk(4, 4, 2, 2), closed)).toEqual({ flag: 'toReview', lastClosedOn: '2026-09-20' });
    expect(riskFlag(risk(4, 4, 2, 2, '2026-09-10'), closed).flag).toBe('toReview');
    expect(riskFlag(risk(4, 4, 2, 2, '2026-09-20'), closed).flag).toBeNull();
  });
  it('libellé du niveau', () => {
    expect([2, 4, 9, 16].map(levelName)).toEqual(['Faible', 'Modéré', 'Élevé', 'Critique']);
  });
});

describe('versions du DUERP (AAAA.n)', () => {
  it('format canonique, version suivante, conflits', () => {
    expect(parseVersion('2026.2')).toEqual([2026, 2]);
    expect(parseVersion('2026.02')).toBeNull();
    expect(parseVersion('2027.0')).toBeNull();
    expect(versionConflict(['2025.1', '2026.1'], '2026.2')).toBeNull();
    expect(versionConflict(['2026.1'], '2026.1')).toBe('Ce numéro de version existe déjà.');
    expect(versionConflict(['2026.2'], '2026.1')).toBe('Doit suivre la dernière version (2026.2).');
    expect(versionConflict([], 'v3')).toBe('Format attendu : AAAA.n (ex. 2026.2).');
    expect(suggestNextVersion(['2026.1', '2026.3', '2025.4'], '2026-10-09')).toBe('2026.4');
    expect(suggestNextVersion(['2026.3'], '2027-01-05')).toBe('2027.1');
  });
});

describe('indices de version des documents maîtrisés', () => {
  it('A → B, Z → AA, AZ → BA', () => {
    expect(nextVersion([])).toBe('A');
    expect(nextVersion(['A', 'C', 'B'])).toBe('D');
    expect(nextVersion(['Y', 'Z'])).toBe('AA');
    expect(nextVersion(['AZ', 'B'])).toBe('BA');
  });
});

describe('unitRiskTodos : alertes des unités au responsable QHSE du site de l’unité (TDB-01)', () => {
  const leads: Record<string, Recipients> = {
    'ville-a': { ownerIds: ['lead-a'], who: '[A. Leroy]', vacant: false },
    'ville-b': { ownerIds: ['lead-b'], who: '[B. Morel]', vacant: false },
  };
  const everyLead: Recipients = { ownerIds: ['lead-a', 'lead-b'], who: '[A. Leroy] · [B. Morel]', vacant: false };
  const vacant: Recipients = { ownerIds: ['anim-1', 'anim-2'], who: VACANT_QHSE_LEAD, vacant: true };
  const forSite = (siteId: string | null) => (siteId ? leads[siteId] ?? vacant : everyLead);
  const units = [
    { id: 'atelier', label: 'Atelier A', siteId: 'ville-a' }, { id: 'zone', label: 'Zone B', siteId: 'ville-b' },
    { id: 'routes', label: 'Déplacements', siteId: null }, { id: 'annexe', label: 'Annexe C', siteId: 'ville-c' },
  ];
  const risks: { id: number; unitId: string; hazard: string; flag: RiskFlag | null }[] = [
    { id: 1, unitId: 'atelier', hazard: 'Bruit', flag: 'toDefine' }, { id: 2, unitId: 'atelier', hazard: 'Chute', flag: 'toDefine' },
    { id: 3, unitId: 'atelier', hazard: 'Coupure', flag: null },
    { id: 4, unitId: 'zone', hazard: 'ATEX', flag: 'residualHigh' }, { id: 5, unitId: 'zone', hazard: 'Hydraulique', flag: 'toReview' },
    { id: 6, unitId: 'routes', hazard: 'Risque routier', flag: 'toDefine' }, { id: 7, unitId: 'annexe', hazard: 'Levage', flag: 'toReview' },
  ];
  const todo = unitRiskTodos(units, risks, forSite, '2026-10-09');
  const find = (prefix: string) => todo.filter((t) => t.title.startsWith(prefix));

  it('deux sites, deux responsables : chaque unité vers le responsable de son site', () => {
    expect(find('Atelier A')).toEqual([{
      kind: RISK_TODO_KIND, who: '[A. Leroy]', ownerIds: ['lead-a'], siteId: 'ville-a', date: '2026-10-09', tone: 'danger', overdue: true, count: 2,
      title: 'Atelier A · 2 risques ≥ 8 sans action de réduction', href: '/risques?unite=atelier',
    }]);
    expect(find('Zone B')).toEqual([
      expect.objectContaining({ who: '[B. Morel]', ownerIds: ['lead-b'], siteId: 'ville-b', count: 1, title: 'Zone B · 1 risque au résiduel encore ≥ 8', href: '/risques?risque=4' }),
      expect.objectContaining({ who: '[B. Morel]', ownerIds: ['lead-b'], tone: 'warn', title: 'Zone B · Hydraulique — résiduel à recoter (actions vérifiées)', href: '/risques?risque=5' }),
    ]);
  });

  it('unité commune à tous les sites : responsables des sites actifs ; poste vacant : animateurs QHSE', () => {
    expect(find('Déplacements')).toEqual([expect.objectContaining({ ownerIds: ['lead-a', 'lead-b'], who: '[A. Leroy] · [B. Morel]', siteId: null })]);
    expect(find('Annexe C')).toEqual([expect.objectContaining({ ownerIds: ['anim-1', 'anim-2'], who: VACANT_QHSE_LEAD, siteId: 'ville-c', tone: 'warn' })]);
    expect(todo).toHaveLength(5);
  });
});

describe('PAPRIPACT : actions reprises et proposées (DUE-02)', () => {
  // Avancements du plan d'actions QSE : Vérifiée = close (closed_on = date de la vérification), Abandonnée exclue ;
  // Terminée (à vérifier) et Reportée restent non closes.
  const actions: { id: string; dueOn: string; status: Avancement; closedOn: string | null }[] = [
    { id: 'A-1', dueOn: '2026-03-01', status: 'verifiee', closedOn: '2026-03-05' },
    { id: 'A-2', dueOn: '2025-11-01', status: 'p40', closedOn: null },
    { id: 'A-3', dueOn: '2025-11-01', status: 'verifiee', closedOn: '2025-11-02' },
    { id: 'A-4', dueOn: '2026-05-01', status: 'abandonnee', closedOn: null },
    { id: 'A-5', dueOn: '2026-02-01', status: 'a_faire', closedOn: null },
    { id: 'A-6', dueOn: '2027-01-10', status: 'a_faire', closedOn: null },
    { id: 'A-10', dueOn: '2026-03-01', status: 'initiee', closedOn: null },
    { id: 'A-7', dueOn: '2025-12-31', status: 'terminee', closedOn: null },
    { id: 'A-8', dueOn: '2025-06-30', status: 'reportee', closedOn: null },
    // Vérifiée en 2026 d'une action à date cible 2025 : proposée à l'ajout en 2026, pas reprise d'office.
    { id: 'A-9', dueOn: '2025-12-15', status: 'verifiee', closedOn: '2026-01-20' },
  ];
  // A-5 n'est rattachée à aucun risque en vigueur.
  const linked = new Set(['A-1', 'A-2', 'A-3', 'A-4', 'A-6', 'A-7', 'A-8', 'A-9', 'A-10']);

  it('reprise : date cible dans l’année ou report d’une action non close ; abandonnées et non rattachées exclues', () => {
    expect(programDefaultIds(actions, linked, 2026)).toEqual(['A-8', 'A-2', 'A-7', 'A-1', 'A-10']);
    expect(programDefaultIds(actions, linked, 2027)).toEqual(['A-8', 'A-2', 'A-7', 'A-10', 'A-6']);
    expect(programDefaultIds(actions, new Set(), 2026)).toEqual([]);
  });

  it('ajout : rattachées, non abandonnées, hors programme, non closes ou vérifiées dans l’année', () => {
    expect(programCandidateIds(actions, linked, new Set(['A-2']), 2026)).toEqual(['A-8', 'A-9', 'A-7', 'A-1', 'A-10', 'A-6']);
    expect(programCandidateIds(actions, linked, new Set(), 2025)).toEqual(['A-8', 'A-2', 'A-3', 'A-7', 'A-10', 'A-6']);
  });

  it('totaux, lecture de l’instantané, périmètre', () => {
    expect(programTotals([{ estimatedCost: 1000, done: true }, { estimatedCost: null, cancelled: true }, { estimatedCost: 250.5 }]))
      .toEqual({ count: 3, costed: 2, cost: 1250.5, done: 1, cancelled: 1 });
    expect(programTotals([])).toEqual({ count: 0, costed: 0, cost: 0, done: 0, cancelled: 0 });

    expect(parseProgramSnapshot(null)).toBeNull();
    expect(parseProgramSnapshot([])).toBeNull();
    expect(parseProgramSnapshot('x')).toBeNull();
    expect(parseProgramSnapshot({ takenOn: '2026-10-01', duerpVersion: '2026.1', cseConsultedOn: '2026-09-30', lines: [
      { actionId: 'A-1', title: 'Former', siteId: 'ville-a', site: 'Site A', pilot: '[C. Lefèvre]', dueOn: '2026-03-01', status: 'Clôturée',
        risks: [{ id: 3, unitId: 'montage', unit: 'Atelier montage', hazard: 'Électricité', cotation: 8 }, { unit: 'Bureaux', hazard: 'Chute', cotation: '4' }],
        estimatedCost: 2400, resources: '', indicator: 'Habilitations à jour' },
      { title: 'sans référence' }, 'ligne illisible',
    ] })).toEqual({
      takenOn: '2026-10-01', takenBy: null, duerpVersion: '2026.1', cseConsultedOn: '2026-09-30',
      lines: [{
        actionId: 'A-1', title: 'Former', siteId: 'ville-a', site: 'Site A', pilot: '[C. Lefèvre]', dueOn: '2026-03-01', status: 'Clôturée',
        risks: [{ id: 3, unitId: 'montage', unit: 'Atelier montage', hazard: 'Électricité', cotation: 8 }, { unit: 'Bureaux', hazard: 'Chute', cotation: 0 }],
        estimatedCost: 2400, resources: null, indicator: 'Habilitations à jour',
      }],
    });
    expect(parseProgramSnapshot({ lines: 'x' })).toEqual({ takenOn: '', takenBy: null, duerpVersion: '', cseConsultedOn: '', lines: [] });

    const lines = [{ siteId: 'ville-a' }, { siteId: 'ville-b' }, { siteId: null }];
    expect(programLinesInScope(lines, ['ville-b'], null)).toEqual([{ siteId: 'ville-b' }, { siteId: null }]);
    expect(programLinesInScope(lines, null, 'ville-a')).toEqual([{ siteId: 'ville-a' }, { siteId: null }]);
    expect(programLinesInScope(lines, null, null)).toEqual(lines);
    expect(programLinesInScope(lines, ['ville-b'], 'ville-a')).toEqual([{ siteId: null }]);
  });
});
