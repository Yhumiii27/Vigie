import { describe, expect, it } from 'vitest';
import { SKILL_LINK_MISSING, coversNeed, heldState, isBlocking, lapseFor, period, renewalDue, renewalForecast, skillIndicators, skillLinkTarget } from './rules';

// Règles des habilitations (QUA-03) : manque au regard d'une affectation Keystone, recyclage à planifier.

const NOW = '2026-10-09';
const span = (startOn: string, endOn: string) => ({ startOn, endOn });

describe('période d’une affectation', () => {
  it('même mois, deux mois, un seul jour', () => {
    expect(period('2026-10-13', '2026-10-17')).toBe('du 13 au 17 octobre');
    expect(period('2026-09-28', '2026-10-02')).toBe('du 28 septembre au 2 octobre');
    expect(period('2026-10-13', '2026-10-13')).toBe('le 13 octobre');
  });
});

describe('lapseFor : manque du titre pour une affectation', () => {
  const a = span('2026-10-20', '2026-10-30');
  it('non requis ou couvrant toute l’affectation : aucun manque', () => {
    expect(lapseFor('n', null, a, NOW)).toBeNull();
    expect(lapseFor('v', null, a, NOW)).toBeNull();
    expect(lapseFor('v', '2026-10-30', a, NOW)).toBeNull(); // valide jusqu'au dernier jour inclus
    expect(lapseFor('s', '2026-11-30', a, NOW)).toBeNull();
  });
  it('jamais suivi, déjà expiré, expire avant le début, expire pendant', () => {
    expect(lapseFor('r', null, a, NOW)).toBe('missing');
    expect(lapseFor('x', '2026-10-01', a, NOW)).toBe('expired');
    expect(lapseFor('s', '2026-10-15', a, NOW)).toBe('before');
    expect(lapseFor('s', '2026-10-25', a, NOW)).toBe('during');
  });
  it('seul un manque « pendant » laisse intervenir le salarié au début de l’affectation', () => {
    expect([null, 'during', 'before', 'expired', 'missing'].map((l) => isBlocking(l as Parameters<typeof isBlocking>[0]))).toEqual([false, false, true, true, true]);
  });
});

describe('heldState', () => {
  it('même règle que la matrice : expiré, sous 60 jours, valide', () => {
    expect(heldState(null, NOW)).toBe('v');
    expect(heldState('2026-10-08', NOW)).toBe('x');
    expect(heldState('2026-12-08', NOW)).toBe('s');
    expect(heldState('2026-12-09', NOW)).toBe('v');
  });
});

describe('renewalDue : échéance proposée pour le recyclage à prévoir', () => {
  it('rien à planifier pour un titre valide sans affectation non couverte, ou non requis', () => {
    expect(renewalDue('v', '2027-06-01', [], NOW)).toBeNull();
    expect(renewalDue('v', '2027-06-01', [span('2026-11-02', '2026-11-06')], NOW)).toBeNull();
    expect(renewalDue('n', null, [span('2026-11-02', '2026-11-06')], NOW)).toBeNull();
  });
  it('échéance du titre, ou dans 30 jours pour une formation initiale', () => {
    expect(renewalDue('s', '2026-11-15', [], NOW)).toBe('2026-11-15');
    expect(renewalDue('r', null, [], NOW)).toBe('2026-11-08');
  });
  it('la veille de la première affectation non couverte, jamais avant aujourd’hui', () => {
    expect(renewalDue('v', '2026-12-31', [span('2026-12-20', '2027-01-10')], NOW)).toBe('2026-12-19');
    // Première affectation couverte, seconde non : l'échéance suit la seconde.
    expect(renewalDue('v', '2026-12-01', [span('2026-10-15', '2026-10-20'), span('2026-11-25', '2026-12-05')], NOW)).toBe('2026-11-24');
    expect(renewalDue('r', null, [span('2026-10-20', '2026-10-22')], NOW)).toBe('2026-10-19');
    expect(renewalDue('r', null, [span(NOW, '2026-10-12')], NOW)).toBe(NOW);
    expect(renewalDue('x', '2026-10-01', [], NOW)).toBe(NOW);
  });
});

describe('coversNeed : la formation règle-t-elle le besoin ?', () => {
  it('valide au-delà de 60 jours et couvrant les affectations à venir', () => {
    expect(coversNeed('2027-10-08', [], NOW)).toBe(true);
    expect(coversNeed(null, [], NOW)).toBe(true); // titre sans échéance
    expect(coversNeed('2026-11-30', [], NOW)).toBe(false); // expire sous 60 jours
    expect(coversNeed('2027-06-01', [span('2027-05-25', '2027-07-01')], NOW)).toBe(false);
    expect(coversNeed('2027-06-01', [span('2027-05-01', '2027-05-10')], NOW)).toBe(true);
  });
});

describe('renewalForecast (HAB-09)', () => {
  const title = (id: string) => ({ id, label: `Titre ${id}` });
  const rows = [
    { person: { id: 'p1', name: 'Alice' }, cells: [
      { title: title('A'), state: 's' as const, expiresOn: '2026-11-20', required: true },
      { title: title('B'), state: 'x' as const, expiresOn: '2026-09-01', required: true },
      { title: title('C'), state: 'v' as const, expiresOn: '2028-01-01', required: true },
    ] },
    { person: { id: 'p2', name: 'Bruno' }, cells: [
      { title: title('A'), state: 'v' as const, expiresOn: '2027-09-30', required: true },
      { title: title('B'), state: 'r' as const, expiresOn: null, required: true },
      { title: title('C'), state: 'n' as const, expiresOn: '2026-12-01', required: false },
    ] },
  ];
  it('rattrapage, mois d’échéance sur 12 mois, titres requis seulement', () => {
    const f = renewalForecast(rows, '2026-10-22');
    expect(f.months).toHaveLength(12);
    expect(f.months[0].month).toBe('2026-10');
    expect(f.months[11].month).toBe('2027-09');
    expect(f.overdue.map((i) => `${i.personId}:${i.titleId}`)).toEqual(['p2:B', 'p1:B']);
    expect(f.months.find((m) => m.month === '2026-11')?.items.map((i) => i.personId)).toEqual(['p1']);
    expect(f.months.find((m) => m.month === '2027-09')?.items.map((i) => i.personId)).toEqual(['p2']);
    // Titre valide au-delà de l'horizon, ou non requis : hors prévision.
    expect(f.months.flatMap((m) => m.items).some((i) => i.titleId === 'C')).toBe(false);
    expect(f.titles.map((t) => t.id)).toEqual(['A', 'B']);
  });
  it('passage d’année', () => {
    const f = renewalForecast([], '2026-12-05', 3);
    expect(f.months.map((m) => m.month)).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});

describe('skillLinkTarget : lien profond vers la matrice (HAB-17)', () => {
  const base = {
    self: false, selfId: 'moi', personId: 'p1', titleId: undefined as string | undefined,
    rowIds: new Set(['p1', 'moi']), otherIds: new Set(['enc']), departed: new Map([['parti', '2026-09-30']]), otherSite: false,
    activeTitleIds: new Set(['sst']), archivedTitles: new Map([['ancien', 'Habilitation ancienne']]),
  };
  it('case ouverte (titre actif) ou ligne mise en évidence', () => {
    expect(skillLinkTarget({ ...base, titleId: 'sst' })).toEqual({ select: { personId: 'p1', titleId: 'sst' } });
    expect(skillLinkTarget(base)).toEqual({ select: { personId: 'p1', titleId: undefined } });
  });
  it('titre archivé ou inconnu : ligne mise en évidence, message précis', () => {
    expect(skillLinkTarget({ ...base, titleId: 'ancien' })).toEqual({
      select: { personId: 'p1' },
      notice: "Titre « Habilitation ancienne » archivé : il n'est plus suivi dans la matrice ; ses formations restent consultables dans « Titres suivis ». La ligne du salarié est mise en évidence.",
    });
    expect(skillLinkTarget({ ...base, titleId: 'x' }).notice).toBe('Titre introuvable : la ligne du salarié est mise en évidence.');
  });
  it('salarié sorti, hors matrice, autre site du périmètre, inconnu ou hors périmètre', () => {
    expect(skillLinkTarget({ ...base, personId: 'parti' }).notice).toBe("Salarié sorti de l'effectif le 30/09/2026 : ses formations sont conservées en consultation seule (filtre « Sortis »).");
    expect(skillLinkTarget({ ...base, personId: 'enc' }).notice).toMatch(/personnel hors matrice/);
    expect(skillLinkTarget({ ...base, personId: 'ailleurs', otherSite: true }).notice).toMatch(/autre site que celui sélectionné/);
    expect(skillLinkTarget({ ...base, personId: 'inconnu' })).toEqual({ notice: SKILL_LINK_MISSING });
  });
  it('vue Salarié : la fiche d’autrui n’est jamais affichée', () => {
    expect(skillLinkTarget({ ...base, self: true, personId: 'p1' })).toEqual({ notice: 'Fiche non accessible : seules vos habilitations sont affichées.' });
    expect(skillLinkTarget({ ...base, self: true, personId: 'moi', titleId: 'sst' })).toEqual({ select: { personId: 'moi', titleId: 'sst' } });
  });
});

describe('skillIndicators : indicateurs de compétences de la revue (HAB-18)', () => {
  const entry = (obtainedOn: string, extra: { cancelled?: boolean; effectiveness?: string } = {}) =>
    ({ obtainedOn, cancelled: extra.cancelled ? { at: '', by: '', reason: 'x' } : null, effectiveness: extra.effectiveness ? { key: extra.effectiveness } : null });
  const rows = [
    { cells: [
      { state: 'v' as const, history: [entry('2026-03-01', { effectiveness: 'efficace' }), entry('2023-03-01')] },
      { state: 'x' as const, history: [entry('2021-01-01')] },
      { state: 'n' as const, history: [entry('2026-06-01', { effectiveness: 'partielle' })] },
    ] },
    { cells: [
      { state: 's' as const, history: [entry('2026-09-30', { cancelled: true }), entry('2025-11-01')] },
      { state: 'r' as const, history: [] },
      { state: 'p' as const, history: [entry('2025-10-10')] },
    ] },
  ];
  it('taux de conformité, formations sur 12 mois et efficacité, recyclages en retard', () => {
    expect(skillIndicators(rows, '2026-10-09')).toEqual({
      required: 5, compliant: 2, rate: 40, trainings12: 4, evaluated: 2, ineffective: 1, lateRenewals: 1,
    });
  });
  it('sans titre requis : taux non calculé', () => {
    expect(skillIndicators([], '2026-10-09')).toMatchObject({ required: 0, rate: null, trainings12: 0 });
  });
});
