import { describe, expect, it } from 'vitest';
import { admissibleSources } from '@/lib/action-rules';
import { ORIGIN_REF_MAX } from '@/lib/domain';
import { controlOverdueDefaults, controlReserveDefaults, requirementActionDefaults } from './action-defaults';

// Valeurs proposées par l'écran Veille au formulaire d'action (plan du paquet 1, flux E2) : source imposée conforme à
// admissibleSources (D20), élément lié, domaine proposé, site, vérification planifiée.

const TODAY = '2026-10-09';
const kindOf = (link: string | undefined) => link?.split(':')[0] ?? null;

describe('exigence de veille en écart', () => {
  const req = {
    id: 7, text: 'Code du travail — R. 4512-6', domain: 'Santé-sécurité', summary: 'Plan de prévention écrit au-delà de 400 h.', evaluation: 'ecart',
    evaluationNote: '2 interventions sans plan signé', pilotId: 'clefevre', dueOn: '2026-12-01',
  };

  it('source « Veille réglementaire » imposée, exigence liée, domaine proposé, sans site imposé', () => {
    const d = requirementActionDefaults(req, TODAY);
    expect(d).toMatchObject({
      source: 'veille', lockSource: true, link: 'requirement:7', linkLabel: 'Exigence · Code du travail — R. 4512-6', originRef: 'Code du travail — R. 4512-6',
      domain: 'securite', pilotId: 'clefevre', dueOn: '2026-12-01', verifyDueOn: '2026-12-31',
      detail: "Traiter l'écart « 2 interventions sans plan signé » : Code du travail — R. 4512-6",
    });
    expect(d.problem).toBe('Code du travail — R. 4512-6 — Écart : 2 interventions sans plan signé.\nPlan de prévention écrit au-delà de 400 h.');
    expect(d).not.toHaveProperty('siteId');
    expect(admissibleSources(kindOf(d.link), {})).toContain(d.source);
  });

  it('analyse d’écart, date passée : date cible dans 30 jours ; référence bornée', () => {
    const long = 'x'.repeat(200);
    const d = requirementActionDefaults({ ...req, text: long, evaluation: 'analyse', evaluationNote: null, dueOn: '2026-01-01', pilotId: null, domain: 'Texte libre' }, TODAY);
    expect(d).toMatchObject({ dueOn: '2026-11-08', verifyDueOn: '2026-12-08', domain: null, pilotId: undefined });
    expect(d.detail).toBe(`Analyser l'écart : ${long}`);
    expect(d.originRef).toHaveLength(ORIGIN_REF_MAX);
  });
});

describe('contrôle périodique', () => {
  const ctrl = {
    id: 3, equipment: 'Pont roulant 10 t — atelier montage', controlType: 'VGP levage', periodMonths: 12, organization: '[Organisme A]',
    reserves: 'Fin de course à régler', responsibleId: 'sbenali', nextOn: '2026-10-20', siteId: 'ville-a',
  };

  it('réserves : source « Contrôle réglementaire » imposée, contrôle lié, site du contrôle', () => {
    const d = controlReserveDefaults(ctrl, TODAY);
    expect(d).toMatchObject({
      source: 'controle_reglementaire', lockSource: true, link: 'control:3', linkLabel: 'VGP levage · Pont roulant 10 t — atelier montage',
      siteId: 'ville-a', pilotId: 'sbenali', dueOn: '2026-10-20', verifyDueOn: '2026-11-19',
      detail: 'Lever les réserves « Fin de course à régler » : Pont roulant 10 t',
      problem: 'Réserves du contrôle « VGP levage » ([Organisme A]) : Fin de course à régler.',
    });
    expect(admissibleSources(kindOf(d.link), {})).toContain(d.source);
    // Prochain contrôle au-delà de 30 jours : date cible dans 30 jours.
    expect(controlReserveDefaults({ ...ctrl, nextOn: '2027-04-01' }, TODAY).dueOn).toBe('2026-11-08');
  });

  it('contrôle dépassé : sous 15 jours ; contrôle commun à tous les sites : site laissé au choix', () => {
    const d = controlOverdueDefaults({ ...ctrl, reserves: null, nextOn: '2026-09-01', siteId: null }, TODAY);
    expect(d).toMatchObject({
      source: 'controle_reglementaire', link: 'control:3', dueOn: '2026-10-24', verifyDueOn: '2026-11-23', siteId: undefined,
      problem: 'Contrôle « VGP levage » dépassé depuis le 01/09/2026 (tous les 12 mois, [Organisme A]).',
      detail: 'Réaliser le contrôle « VGP levage » : Pont roulant 10 t',
    });
  });
});
