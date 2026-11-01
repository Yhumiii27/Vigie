import { describe, expect, it } from 'vitest';
import {
  SORT_DUE, controlChoices, filterControls, filterRequirements, hasListFilters, parseControlFilters, parseRequirementFilters, requirementChoices,
} from './watch-filters';

// VEI-13 : filtres, recherche et tri de la veille, portés par l'URL.

const reqs = [
  { id: 1, evaluation: 'conforme', domain: 'Sécurité', pilotId: 'p1', pilot: 'Zoé', text: 'Arrêté ATEX', summary: 'Zonage', dueSort: '2027-01-10' },
  { id: 2, evaluation: 'ecart', domain: 'Environnement', pilotId: 'p2', pilot: 'Alain', text: 'ICPE', summary: 'Rejets aqueux', dueSort: null },
  { id: 3, evaluation: 'ecart', domain: 'Sécurité', pilotId: null, pilot: '', text: 'Code du travail', summary: 'Échafaudages', dueSort: '2026-11-01' },
];
const EVAL = { conforme: { label: 'Conforme' }, ecart: { label: 'Écart' } };

describe('exigences (VEI-13)', () => {
  const choices = requirementChoices(reqs, EVAL);

  it('choix tirés de la liste', () => {
    expect(choices.domains).toEqual([['Environnement', 'Environnement'], ['Sécurité', 'Sécurité']]);
    expect(choices.pilots).toEqual([['p2', 'Alain'], ['p1', 'Zoé']]);
    expect(choices.evaluations).toEqual([['conforme', 'Conforme'], ['ecart', 'Écart']]);
  });

  it('paramètres validés : valeur inconnue ou personne absente de la liste ignorée', () => {
    expect(parseRequirementFilters({ evaluation: 'ecart', domaine: 'Inconnu', pilote: 'p9', q: '  icpe ', tri: 'echeance' }, choices))
      .toEqual({ evaluation: 'ecart', domaine: undefined, pilote: undefined, q: 'icpe', tri: SORT_DUE });
    expect(parseRequirementFilters({ tri: 'autre', q: 'x'.repeat(300) }, choices)).toMatchObject({ tri: undefined, q: 'x'.repeat(100) });
  });

  it('filtres cumulés, recherche sans accents ni casse, tri par échéance (sans échéance en dernier)', () => {
    expect(filterRequirements(reqs, { evaluation: 'ecart', domaine: 'Sécurité' }).map((r) => r.id)).toEqual([3]);
    expect(filterRequirements(reqs, { q: 'echafaud' }).map((r) => r.id)).toEqual([3]);
    expect(filterRequirements(reqs, { tri: SORT_DUE }).map((r) => r.id)).toEqual([3, 1, 2]);
    expect(filterRequirements(reqs, {}).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(reqs.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('filtres actifs hors tri', () => {
    expect(hasListFilters({ tri: SORT_DUE })).toBe(false);
    expect(hasListFilters({ q: 'a' })).toBe(true);
  });
});

describe('contrôles périodiques (VEI-13)', () => {
  const ctrls = [
    { id: 1, responsibleId: 'p1', responsible: 'Zoé', equipment: 'Pont roulant 5 t', controlType: 'VGP', organization: 'Apave', equipmentCode: null, nextOn: '2027-02-01' },
    { id: 2, responsibleId: null, responsible: '', equipment: 'Extincteurs', controlType: 'Vérification', organization: 'Sicli', equipmentCode: 'EXT', nextOn: '2026-11-15' },
  ];
  it('responsable de la liste, recherche, tri par prochain contrôle', () => {
    const choices = controlChoices(ctrls);
    expect(choices.responsibles).toEqual([['p1', 'Zoé']]);
    expect(parseControlFilters({ responsable: 'p2' }, choices).responsable).toBeUndefined();
    expect(filterControls(ctrls, { responsable: 'p1' }).map((c) => c.id)).toEqual([1]);
    expect(filterControls(ctrls, { q: 'apave' }).map((c) => c.id)).toEqual([1]);
    expect(filterControls(ctrls, { q: 'ext' }).map((c) => c.id)).toEqual([2]);
    expect(filterControls(ctrls, { tri: SORT_DUE }).map((c) => c.id)).toEqual([2, 1]);
  });
});
