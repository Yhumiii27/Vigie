import { describe, expect, it } from 'vitest';
import { auditActionSource } from './shared';

// Source d'une action créée depuis l'écran Audits (D20, amendement A4) : imposée par la ligne du programme ; constat hors
// programme ou ligne libre : choix parmi les quatre sources d'audit, Audit interne proposé.

describe('auditActionSource', () => {
  it('ligne du programme : source imposée', () => {
    expect(auditActionSource('finding', 'Certification')).toEqual({ source: 'audit_certification', lockSource: true });
    expect(auditActionSource('plan', 'Visites sécurité')).toEqual({ source: 'audit_terrain', lockSource: true });
    expect(auditActionSource('finding', 'Audits internes')).toEqual({ source: 'audit_interne', lockSource: true });
    expect(auditActionSource('plan', 'Fournisseurs')).toEqual({ source: 'audit_fournisseur', lockSource: true });
    expect(auditActionSource('finding', 'Fournisseurs')).toEqual({ source: 'audit_fournisseur', lockSource: true });
    expect(auditActionSource('plan', 'Revues de direction')).toEqual({ source: 'revue_direction', lockSource: true });
  });
  it('hors programme, ligne libre ou constat d’une ligne « Revues de direction » : les quatre sources d’audit', () => {
    const four = ['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain'];
    for (const [kind, track] of [['finding', null], ['plan', 'Nouvelle ligne'], ['finding', 'Revues de direction'], ['plan', 'constructor']] as const) {
      expect(auditActionSource(kind, track), `${kind} ${track}`).toEqual({ source: 'audit_interne', sourceChoices: four });
    }
  });
});
