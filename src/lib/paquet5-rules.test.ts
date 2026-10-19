import { describe, expect, it } from 'vitest';
import { francDaysDeadline, mpQuestionnaireDeadline } from '@/components/events/deadlines';
import { HEALTH_FIELDS, HEALTH_FORM_FIELDS, MP_FIELDS, withoutHealth } from '@/components/events/shared';
import { bsdRefusalErrors, BSD_STATUS } from '@/components/environment/model';
import { missingPrerequisites, prerequisiteCycle } from '@/components/skills/rules';
import { CONTROL_RESULTS, FINDING_GAP_KINDS, FINDING_KINDS, REPORT_TYPE_KEYS, canSeeEventType, contextNeedsTreatment, isBlockingControlResult } from './domain';
import { elapsedMonths, objectiveValue, type ObjectiveData } from './objective-values';
import { OBJECTIVE_INDICATORS, fmtObjectiveTarget, fmtObjectiveValue, objectiveStatus } from './objectives';
import { certificationStatus, workforceAccident } from './queries';
import { appliesToSite, legalTextUrlError } from './watch-rules';

// Règles pures du paquet 5 (conformité réglementaire) : maladies professionnelles et accidents de trajet (EVT-09),
// délais, prérequis des titres (HAB-10), applicabilité des exigences (VEI-10), résultat des contrôles (VEI-11), constats
// (AUD-09), certification suspendue (AUD-08), BSD refusés (DOC-12), objectifs mesurables (AUD-13), contexte (CNF-05).

const NOW = '2026-10-09';

describe('EVT-09 : maladies professionnelles et accidents de trajet', () => {
  it('le type MP est réservé aux rôles habilités aux données de santé et absent du signalement terrain', () => {
    expect(canSeeEventType('Animateur QHSE', 'MP')).toBe(true);
    expect(canSeeEventType('Direction', 'MP')).toBe(true);
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) expect(canSeeEventType(role, 'MP')).toBe(false);
    expect(canSeeEventType('Salarié', 'AT')).toBe(true);
    expect(REPORT_TYPE_KEYS).not.toContain('MP');
    expect(REPORT_TYPE_KEYS).toContain('AT');
  });
  it('les champs d’une maladie professionnelle sont des données de santé, retirés par withoutHealth', () => {
    for (const k of MP_FIELDS) {
      expect(HEALTH_FIELDS).toContain(k);
      expect(HEALTH_FORM_FIELDS).toContain(k);
    }
    const row = Object.fromEntries(HEALTH_FIELDS.map((k) => [k, 'x'])) as Record<(typeof HEALTH_FIELDS)[number], unknown>;
    expect(withoutHealth({ ...row, title: 'Maladie professionnelle' })).toMatchObject({ mpDisease: null, mpTable: null, title: 'Maladie professionnelle' });
  });
  it('un accident de trajet n’est pas compté dans les taux (TF1, TG, pyramide)', () => {
    expect(workforceAccident({ type: 'AT', victimKind: 'salarie', commute: false })).toBe(true);
    expect(workforceAccident({ type: 'AT', victimKind: 'salarie', commute: true })).toBe(false);
    expect(workforceAccident({ type: 'AT', victimKind: null })).toBe(true);
    expect(workforceAccident({ type: 'MP', victimKind: 'salarie' })).toBe(false);
  });
  it('questionnaire employeur : 30 jours francs, reporté au premier jour ouvrable', () => {
    expect(mpQuestionnaireDeadline('2026-10-02')).toBe('2026-11-02'); // 01/11 dimanche → lundi 02/11
    expect(mpQuestionnaireDeadline('2026-10-12')).toBe('2026-11-12'); // dernier jour le 11/11, férié : reporté au 12
    expect(francDaysDeadline('2026-12-15', 10)).toBe('2026-12-28'); // 25/12 férié, 26 samedi, 27 dimanche
    expect(francDaysDeadline('2026-12-15', 11, { alsaceMoselle: true })).toBe('2026-12-28');
  });
});

describe('HAB-10 : prérequis entre titres', () => {
  const active = new Set(['r484', 'r489', 'conduite']);
  it('au moins un prérequis valide suffit ; sinon tous sont signalés', () => {
    expect(missingPrerequisites([], new Map(), active, NOW)).toEqual([]);
    expect(missingPrerequisites(['r484', 'r489'], new Map([['r484', { expiresOn: '2027-01-01' }]]), active, NOW)).toEqual([]);
    expect(missingPrerequisites(['r484', 'r489'], new Map([['r484', { expiresOn: '2026-10-01' }]]), active, NOW)).toEqual(['r484', 'r489']);
    expect(missingPrerequisites(['r489'], new Map([['r489', { expiresOn: null }]]), active, NOW)).toEqual([]);
    expect(missingPrerequisites(['r489'], new Map(), active, NOW)).toEqual(['r489']);
  });
  it('un prérequis archivé est ignoré', () => {
    expect(missingPrerequisites(['ancien'], new Map(), active, NOW)).toEqual([]);
  });
  it('cycle de prérequis détecté', () => {
    const graph = new Map<string, string[]>([['conduite', ['r489']], ['r489', []]]);
    expect(prerequisiteCycle('r489', ['conduite'], graph)).toBe('conduite');
    expect(prerequisiteCycle('conduite', ['r489'], graph)).toBeNull();
    expect(prerequisiteCycle('a', ['b'], new Map([['b', ['c']], ['c', ['a']]]))).toBe('b');
  });
});

describe('VEI-10 et VEI-11 : exigences et contrôles', () => {
  it('lien vers le texte : https sur Légifrance ou EUR-Lex', () => {
    expect(legalTextUrlError('https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000018532320')).toBeNull();
    expect(legalTextUrlError('https://eur-lex.europa.eu/eli/reg/2023/1230/oj')).toBeNull();
    expect(legalTextUrlError('http://www.legifrance.gouv.fr/x')).toBe('Adresse https attendue.');
    expect(legalTextUrlError('https://legifrance.gouv.fr.example.com/x')).toMatch(/Légifrance/);
    expect(legalTextUrlError('pas une adresse')).toMatch(/invalide/);
  });
  it('applicabilité par site', () => {
    expect(appliesToSite([], 'ville-a')).toBe(true);
    expect(appliesToSite(['ville-b'], 'ville-a')).toBe(false);
    expect(appliesToSite(['ville-b'], 'ville-b')).toBe(true);
    expect(appliesToSite(['ville-b'], null)).toBe(true);
  });
  it('résultats de contrôle : défavorable et mise à l’arrêt bloquent l’équipement', () => {
    expect(Object.keys(CONTROL_RESULTS)).toEqual(['favorable', 'reserves', 'defavorable', 'arret']);
    expect(isBlockingControlResult('defavorable')).toBe(true);
    expect(isBlockingControlResult('arret')).toBe(true);
    expect(isBlockingControlResult('reserves')).toBe(false);
    expect(isBlockingControlResult(null)).toBe(false);
  });
});

describe('AUD-08 et AUD-09 : certification et constats', () => {
  it('certificat suspendu : statut danger', () => {
    expect(certificationStatus({ tone: 'ok', status: '', validUntil: '2028-12-14', suspendedOn: '2026-10-01' }, '2026-11-17', NOW))
      .toEqual({ label: 'Certificat suspendu depuis le 01/10/2026', tone: 'danger' });
    expect(certificationStatus({ tone: 'ok', status: '', validUntil: '2028-12-14', suspendedOn: null }, '2026-11-17', NOW).tone).not.toBe('danger');
  });
  it('types de constat : écart majeur et observation ; écarts à délai de réponse', () => {
    expect(Object.keys(FINDING_KINDS)).toEqual(['ecart_majeur', 'ecart_mineur', 'observation', 'piste', 'point_fort']);
    expect(FINDING_GAP_KINDS).toEqual(['ecart_majeur', 'ecart_mineur']);
  });
});

describe('DOC-12 : refus de bordereau', () => {
  it('statuts refusé et accepté partiellement', () => {
    expect(BSD_STATUS.refuse.label).toBe('Refusé');
    expect(BSD_STATUS.accepte_partiel.label).toBe('Accepté partiellement');
  });
  it('motif obligatoire, quantité refusée d’une acceptation partielle entre 0 et la quantité enlevée', () => {
    expect(bsdRefusalErrors('traite', 100, null, null)).toEqual({});
    expect(bsdRefusalErrors('refuse', 100, null, null)).toEqual({ bsdRefusalReason: expect.any(String) });
    expect(bsdRefusalErrors('refuse', 100, null, 'Non conforme')).toEqual({});
    expect(bsdRefusalErrors('accepte_partiel', 100, null, 'x')).toEqual({ bsdRefusedQuantity: expect.stringMatching(/obligatoire/) });
    expect(bsdRefusalErrors('accepte_partiel', 100, 100, 'x')).toEqual({ bsdRefusedQuantity: expect.stringMatching(/comprise/) });
    expect(bsdRefusalErrors('accepte_partiel', 100, 12.5, 'x')).toEqual({});
  });
});

describe('AUD-13 : objectifs mesurables', () => {
  it('état : atteint, dépassé, à atteindre, non mesuré', () => {
    expect(objectiveStatus(null, 4, 'max', false).key).toBe('none');
    expect(objectiveStatus(3.2, 4, 'max', false)).toMatchObject({ key: 'met', label: 'Atteint à ce jour' });
    expect(objectiveStatus(5, 4, 'max', false)).toMatchObject({ key: 'missed', label: 'Dépassé', tone: 'danger' });
    expect(objectiveStatus(10, 24, 'min', false)).toMatchObject({ key: 'pending', tone: 'warn' });
    expect(objectiveStatus(10, 24, 'min', true)).toMatchObject({ key: 'missed', label: 'Non atteint' });
    expect(objectiveStatus(24, 24, 'min', true)).toMatchObject({ key: 'met', label: 'Atteint' });
  });
  it('formats', () => {
    expect(fmtObjectiveValue('tf1', 3.25)).toBe('3,3');
    expect(fmtObjectiveValue('actions_retard', 12.4)).toBe('12 %');
    expect(fmtObjectiveTarget('remontees', 24)).toBe('≥ 24');
    expect(fmtObjectiveTarget('tf1', 4)).toBe('≤ 4,0');
    expect(fmtObjectiveValue('cout_non_qualite', null)).toBe('—');
    expect(OBJECTIVE_INDICATORS.tf1.sense).toBe('max');
  });
  it('mois échus de l’année', () => {
    expect(elapsedMonths(2026, NOW)).toHaveLength(9);
    expect(elapsedMonths(2025, NOW)).toHaveLength(12);
    expect(elapsedMonths(2027, NOW)).toEqual([]);
  });
  const ev = (o: Partial<ObjectiveData['events'][number]>): ObjectiveData['events'][number] => ({
    type: 'PA', injury: null, lostDays: null, occurredOn: '2026-03-01', siteId: 'ville-a', victimKind: null, commute: false, ncCostKeur: null, dismissedAt: null, ...o,
  });
  const data: ObjectiveData = {
    events: [
      ev({}), ev({ type: 'SD', siteId: 'ville-b' }), ev({ dismissedAt: new Date() }), ev({ occurredOn: '2025-12-01' }),
      ev({ type: 'AT', injury: 'arret', lostDays: 10, victimKind: 'salarie' }), ev({ type: 'AT', injury: 'arret', lostDays: 5, commute: true }),
      ev({ type: 'NC', ncCostKeur: 1.2 }), ev({ type: 'RC', ncCostKeur: 0.3 }),
    ],
    actions: [
      { siteId: 'ville-a', status: 'verifiee', dueOn: '2026-05-01', closedOn: '2026-06-01', effective: true },
      { siteId: 'ville-a', status: 'verifiee', dueOn: '2026-05-01', closedOn: '2026-06-01', effective: false },
      { siteId: 'ville-a', status: 'p40', dueOn: '2026-09-01', closedOn: null, effective: null },
      { siteId: 'ville-b', status: 'a_faire', dueOn: '2026-12-01', closedOn: null, effective: null },
    ],
    controls: [{ siteId: 'ville-a', nextOn: '2026-10-01', archivedAt: null }, { siteId: 'ville-b', nextOn: '2026-12-01', archivedAt: null }],
    hours: Array.from({ length: 9 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}-01`, siteId: 'ville-a', hours: 100_000 })),
    sites: [{ id: 'ville-a', archivedOn: null }, { id: 'ville-b', archivedOn: null }],
  };
  const value = (indicator: Parameters<typeof objectiveValue>[0], siteId: string | null = null, year = 2026) => objectiveValue(indicator, data, { year, now: NOW, siteId });
  it('valeurs calculées : comptages de l’année, classés sans suite et trajet exclus', () => {
    expect(value('remontees')).toBe(2);
    expect(value('remontees', 'ville-a')).toBe(1);
    expect(value('accidents_arret')).toBe(1);
    expect(value('nc')).toBe(1);
    expect(value('reclamations')).toBe(1);
    expect(value('cout_non_qualite')).toBe(1500);
    expect(value('actions_efficaces')).toBe(50);
    expect(value('actions_retard')).toBe(50);
    expect(value('controles_depasses')).toBe(1);
    expect(value('controles_depasses', null, 2025)).toBeNull();
    expect(value('remontees', null, 2027)).toBeNull();
  });
  it('TF1 sur les mois échus, accidents de l’effectif hors trajet', () => {
    expect(value('tf1', 'ville-a')).toBeCloseTo((1 * 1e6) / 900_000, 5);
    expect(value('tg', 'ville-a')).toBeCloseTo((10 * 1e3) / 900_000, 5);
  });
});

describe('CNF-05 : contexte', () => {
  it('traitement attendu des risques et opportunités', () => {
    expect(contextNeedsTreatment('risque')).toBe(true);
    expect(contextNeedsTreatment('opportunite')).toBe(true);
    expect(contextNeedsTreatment('enjeu_externe')).toBe(false);
  });
});
