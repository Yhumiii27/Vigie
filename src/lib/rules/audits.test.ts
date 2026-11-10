import { describe, expect, it } from 'vitest';
import { REVIEW_TRACK, auditActionSource, auditKindOf, inferAuditKind, isReviewPlanItem } from './audits';

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

describe('isReviewPlanItem : échéance d’une revue de direction (AUD-23)', () => {
  const item = (track: string, label = 'Audit', detail: string | null = null) => ({ track, label, detail });
  it('ligne des revues, ou libellé / intitulé « revue de direction »', () => {
    expect(isReviewPlanItem(item(REVIEW_TRACK))).toBe(true);
    expect(isReviewPlanItem(item('revue de direction'))).toBe(true);
    expect(isReviewPlanItem(item('Audits internes', 'Revue  de Direction T1'))).toBe(true);
    expect(isReviewPlanItem(item('Divers', 'Préparation', 'Revue de direction annuelle'))).toBe(true);
  });
  it('tout autre « revue » reste un audit : contrat, conception, documentaire, revue seule', () => {
    for (const p of [
      item('Revues de contrat'), item('Revue de conception'), item('Audits internes', 'Revue documentaire'),
      item('Audits internes', 'Revue', 'Revue des exigences client'), item('Revues'), item('Audits internes', 'Revue de directives'),
    ]) expect(isReviewPlanItem(p), JSON.stringify(p)).toBe(false);
  });
});

describe('type d’audit du programme (D08-5)', () => {
  const p = (track: string, label: string, detail: string | null = null, certificationId: string | null = null) => ({ track, label, detail, certificationId });
  it('déduit le type des éléments existants', () => {
    expect(inferAuditKind(p('Revues de direction', 'Revue'))).toBe('revue_direction');
    expect(inferAuditKind(p('Audits internes', 'Revue de processus', 'Achats'))).toBe('revue_processus');
    expect(inferAuditKind(p('Certification', 'Audit blanc 9001'))).toBe('iso_blanc');
    expect(inferAuditKind(p('Certification', 'Suivi 9001'))).toBe('iso_certification');
    expect(inferAuditKind(p('Audits internes', 'Interne', null, 'iso9001'))).toBe('iso_certification');
    expect(inferAuditKind(p('Visites sécurité', 'Atelier'))).toBe('terrain');
    expect(inferAuditKind(p('Fournisseurs', 'Fonderie'))).toBe('autre');
  });
  it('type choisi, sauf pour une revue de direction', () => {
    expect(auditKindOf(p('Audits internes', 'Interne'), 'iso_blanc', null)).toBe('iso_blanc');
    expect(auditKindOf(p('Audits internes', 'Interne'), null, 'terrain')).toBe('terrain');
    expect(auditKindOf(p('Revues de direction', 'Revue'), 'terrain', null)).toBe('revue_direction');
    expect(auditKindOf(p('Audits internes', 'Interne'), 'revue_direction', null)).toBe('autre');
  });
});
