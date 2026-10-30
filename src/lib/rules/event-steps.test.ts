import { describe, expect, it } from 'vitest';
import {
  AT_CLOSE_RESTRICTED, LOCATION_UNSPECIFIED, addActionBlocker, advanceBlocker, analysisChangeBlocker, analysisFilled, benignRegisterBlocker, cpamPending, declarationDuty,
  eventLockReason, mentionsInjury, missingQualification, needsCpam, neutralAccidentTitle, normalizeTree, qualificationInput, readD8, victimLabel, type DeclarationDuty, type QualifiableEvent,
} from './events';

// Parcours d'un événement (règles de src/lib/rules/events.ts, QUA-03) : passage d'étape, ajout d'action, verrou.

const ctx = { pilotId: 'sbenali' as string | null, hasAnalysis: true, dismissed: false, methodLabel: 'Arbre des causes', missing: [] };
// Avancements du plan d'actions QSE : Vérifiée (close), 40 % (ouverte), Abandonnée (non comptée), Terminée (à vérifier).
const done = { status: 'verifiee' }, open = { status: 'p40' }, cancelled = { status: 'abandonnee' };

describe('advanceBlocker : passage à l’étape suivante', () => {
  it('« Qualifié » exige un pilote', () => {
    expect(advanceBlocker(0, [], { ...ctx, pilotId: null })).toBe("Désignez un pilote (Modifier) avant le passage à l'étape « Qualifié ».");
    expect(advanceBlocker(0, [], ctx)).toBeNull();
  });
  it('« Actions » exige l’analyse des causes puis une action liée (abandonnées non comptées)', () => {
    expect(advanceBlocker(2, [done], { ...ctx, hasAnalysis: false })).toBe("Saisissez l'analyse des causes (méthode « Arbre des causes ») avant le passage à l'étape « Actions ».");
    expect(advanceBlocker(2, [cancelled], ctx)).toBe("Liez au moins une action avant le passage à l'étape « Actions ».");
    expect(advanceBlocker(2, [open], ctx)).toBeNull();
    // Rôle qui ne crée pas d'action (ACT-22) : rappel que les actions QSE sont créées par le service QHSE.
    expect(advanceBlocker(2, [], { ...ctx, canCreateActions: false })).toBe(
      "Liez au moins une action avant le passage à l'étape « Actions ». Les actions QSE sont créées par le service QHSE.",
    );
    expect(advanceBlocker(2, [], { ...ctx, canCreateActions: true })).toBe("Liez au moins une action avant le passage à l'étape « Actions ».");
  });
  it('« Efficacité vérifiée » et clôture : toutes les actions liées vérifiées (EVT-15)', () => {
    expect(advanceBlocker(3, [done, open, open, cancelled], ctx)).toBe(
      "2 actions liées ne sont pas encore vérifiées : vérifiez-les (ou abandonnez-les) dans le plan d'actions avant le passage à l'étape « Efficacité vérifiée ».",
    );
    // Terminée — à vérifier : réalisée, mais son efficacité n'est pas vérifiée ; Reportée : ouverte.
    expect(advanceBlocker(4, [done, { status: 'terminee' }], ctx)).toBe(
      "1 action liée n'est pas encore vérifiée : vérifiez-la (ou abandonnez-la) dans le plan d'actions avant le passage à l'étape « Clôturé ».",
    );
    expect(advanceBlocker(3, [done, { status: 'reportee' }], ctx)).toMatch(/^1 action liée n'est pas encore vérifiée/);
    expect(advanceBlocker(4, [cancelled], ctx)).toBe("Aucune action liée : l'efficacité ne peut pas être vérifiée.");
    expect(advanceBlocker(4, [done, cancelled], ctx)).toBeNull();
    expect(advanceBlocker(3, [{ status: 'a_faire' }, { status: 'initiee' }, { status: 'p80' }, done], ctx)).toMatch(/^3 actions liées ne sont pas encore vérifiées/);
  });
  it('classé sans suite ou déjà clôturé', () => {
    expect(advanceBlocker(1, [], { ...ctx, dismissed: true })).toBe('Événement classé sans suite.');
    expect(advanceBlocker(5, [done], ctx)).toBe('Événement déjà clôturé.');
  });
});

describe('ajout d’action et verrou de la fiche', () => {
  it('plus d’action à partir de « Efficacité vérifiée », ni sur un classé sans suite', () => {
    expect(addActionBlocker(3)).toBeNull();
    expect(addActionBlocker(4)).toMatch(/^Événement à l'étape « Efficacité vérifiée » : ramenez-le à l'étape « Actions »/);
    expect(addActionBlocker(1, true)).toBe('Événement classé sans suite : aucune action ne peut lui être ajoutée.');
  });
  it('fiche en lecture seule : classée sans suite ou clôturée', () => {
    expect(eventLockReason({ step: 3, dismissedAt: null })).toBeNull();
    expect(eventLockReason({ step: 5, dismissedAt: null })).toMatch(/^Événement clôturé/);
    expect(eventLockReason({ step: 2, dismissedAt: '2026-10-01T00:00:00Z' })).toMatch(/^Événement classé sans suite/);
  });
  it('déclaration CPAM : accident du travail de l’effectif, hors soins sans arrêt', () => {
    expect(needsCpam({ type: 'AT', injury: 'arret', victimKind: 'salarie' })).toBe(true);
    expect(needsCpam({ type: 'AT', injury: null, victimKind: null })).toBe(true);
    expect(needsCpam({ type: 'AT', injury: 'soins', victimKind: 'salarie' })).toBe(false);
    expect(needsCpam({ type: 'PA', injury: 'arret', victimKind: null })).toBe(false);
    // Intérimaire : l'ETT déclare ; personne extérieure : son employeur.
    expect(needsCpam({ type: 'AT', injury: 'arret', victimKind: 'interimaire' })).toBe(false);
    expect(needsCpam({ type: 'AT', injury: 'arret', victimKind: 'externe' })).toBe(false);
  });
  it('qui déclare selon la victime (declarationDuty)', () => {
    expect(declarationDuty({ victimKind: 'salarie' })).toBe('cpam');
    expect(declarationDuty({ victimKind: null })).toBe('cpam');
    expect(declarationDuty({ victimKind: 'interimaire' })).toBe('ett');
    expect(declarationDuty({ victimKind: 'externe' })).toBe('employer');
  });
});

describe('registre des accidents bénins : conditions d’inscription (EVT-04)', () => {
  const ev = {
    type: 'AT', location: 'Atelier montage', severity: 1, ncOrigin: null, victimKind: 'salarie' as string | null, victimId: 'amartin' as string | null,
    victimName: null, circumstances: 'Coupure en ébavurant une pièce.' as string | null, customer: null, customerRef: null, keystoneProject: null,
    envAspect: null, envMedium: null, injury: 'soins' as string | null, cpamDeclaredOn: null as string | null,
    lesionNature: 'Coupure superficielle' as string | null, lesionSite: 'Index gauche' as string | null,
  };
  it('premiers soins non déclarés, victime de l’effectif, mentions du registre saisies', () => {
    expect(benignRegisterBlocker(ev)).toBeNull();
    expect(benignRegisterBlocker({ ...ev, injury: 'sans_arret' })).toMatch(/^Seul un accident sans arrêt ni soins médicaux/);
    expect(benignRegisterBlocker({ ...ev, cpamDeclaredOn: '2026-10-09' })).toMatch(/^Accident déjà déclaré à la CPAM/);
    expect(benignRegisterBlocker({ ...ev, victimKind: 'interimaire', victimId: null, victimName: 'J. Martin' })).toMatch(/^Victime intérimaire .*R\. 412-2/);
    expect(benignRegisterBlocker({ ...ev, victimKind: 'externe', victimId: null, victimName: 'K. Weber' })).toMatch(/^Victime extérieure/);
    expect(benignRegisterBlocker({ ...ev, victimKind: null, victimId: null, circumstances: null, location: LOCATION_UNSPECIFIED, lesionNature: null, lesionSite: ' ' })).toBe(
      "Complétez la fiche (Modifier) avant l'inscription au registre : victime, circonstances, lieu, nature des lésions, siège des lésions.",
    );
  });
});

describe('qualification : données propres au type (EVT-05)', () => {
  const base: QualifiableEvent = {
    type: 'PA', location: 'Atelier montage', severity: 2, ncOrigin: null, victimKind: null, victimId: null, victimName: null, circumstances: null,
    customer: null, customerRef: null, keystoneProject: null, envAspect: null, envMedium: null,
  };
  it('par type', () => {
    expect(missingQualification(base)).toEqual([]);
    expect(missingQualification({ ...base, location: LOCATION_UNSPECIFIED })).toEqual(['location']);
    expect(missingQualification({ ...base, type: 'SD', location: ' ' })).toEqual(['location']);
    expect(missingQualification({ ...base, type: 'NC' })).toEqual(['ncOrigin']);
    expect(missingQualification({ ...base, type: 'NC', ncOrigin: 'Fabrication' })).toEqual([]);
    expect(missingQualification({ ...base, type: 'RC' })).toEqual(['customer', 'customerRef']);
    expect(missingQualification({ ...base, type: 'RC', customer: '[Client C]', keystoneProject: 'K-2024-097 · [Client C]' })).toEqual([]);
    expect(missingQualification({ ...base, type: 'ENV', envAspect: 'Déversement' })).toEqual(['envMedium']);
    expect(missingQualification({ ...base, type: 'AT' })).toEqual(['victim', 'circumstances']);
  });
  it('victime : de l’effectif (personne choisie) ou déclarée (nom)', () => {
    const at = { ...base, type: 'AT', circumstances: 'Faux pas sur la dernière marche.' };
    expect(missingQualification({ ...at, victimKind: 'salarie', victimName: 'J. Martin' })).toEqual(['victim']);
    expect(missingQualification({ ...at, victimKind: 'salarie', victimId: 'amartin' })).toEqual([]);
    expect(missingQualification({ ...at, victimKind: 'interimaire', victimName: 'J. Martin' })).toEqual([]);
    expect(qualificationInput('victim', { victimKind: null })).toBe('victimKind');
    expect(qualificationInput('victim', { victimKind: 'salarie' })).toBe('victimId');
    expect(qualificationInput('victim', { victimKind: 'externe' })).toBe('victimName');
    expect(qualificationInput('customerRef', { victimKind: null })).toBe('customerRef');
    const nameOf = (id: string) => `[${id}]`;
    expect(victimLabel({ victimKind: 'salarie', victimId: 'amartin', victimName: null, victimCompany: null }, nameOf)).toBe('[amartin]');
    expect(victimLabel({ victimKind: 'interimaire', victimId: null, victimName: 'J. Martin', victimCompany: 'Intérim Plus' }, nameOf)).toBe('J. Martin · intérimaire (Intérim Plus)');
    expect(victimLabel({ victimKind: 'externe', victimId: null, victimName: 'K. Weber', victimCompany: null }, nameOf)).toBe('K. Weber');
    expect(victimLabel({ victimKind: null, victimId: null, victimName: null, victimCompany: null }, nameOf)).toBe('—');
  });
  it('« Qualifié » : pilote, puis données manquantes listées', () => {
    expect(advanceBlocker(0, [], { ...ctx, missing: ['victim', 'circumstances'] })).toBe(
      "Complétez la fiche (Modifier) avant le passage à l'étape « Qualifié » : victime, circonstances.",
    );
    expect(advanceBlocker(0, [], { ...ctx, pilotId: null, missing: ['location'] })).toMatch(/^Désignez un pilote/);
    // Exigées au passage à « Qualifié » seulement (ensuite : à l'enregistrement de la fiche).
    expect(advanceBlocker(1, [], { ...ctx, missing: ['location'] })).toBeNull();
  });
});

describe('clôture d’un accident du travail (EVT-02)', () => {
  const at = (accident: { health: boolean; cpamPending: boolean; benign: boolean; duty?: DeclarationDuty }) => ({ ...ctx, accident });
  it('réservée aux rôles habilités, sans rien révéler de la déclaration', () => {
    const msg = advanceBlocker(4, [done], at({ health: false, cpamPending: true, benign: true }));
    expect(msg).toBe(AT_CLOSE_RESTRICTED);
    expect(msg).not.toMatch(/CPAM|bénin|registre|arrêt|blessure/i);
    expect(advanceBlocker(4, [done], at({ health: false, cpamPending: false, benign: false }))).toBe(AT_CLOSE_RESTRICTED);
  });
  it('déclaration à saisir ou à motiver ; accident bénin à inscrire au registre', () => {
    expect(advanceBlocker(4, [done], at({ health: true, cpamPending: true, benign: false }))).toBe(
      "Saisissez la date de déclaration à la CPAM, ou indiquez pourquoi l'entreprise ne la déclare pas, avant la clôture.",
    );
    expect(advanceBlocker(4, [done], at({ health: true, cpamPending: true, benign: true }))).toBe(
      "Accident bénin : inscrivez-le au registre des accidents bénins, ou indiquez pourquoi il n'est pas déclaré, avant la clôture.",
    );
    expect(advanceBlocker(4, [done], at({ health: true, cpamPending: false, benign: true }))).toBeNull();
    // Intérimaire ou victime extérieure : déclarée par l'ETT ou par l'employeur, motif tracé avant la clôture.
    expect(advanceBlocker(4, [done], at({ health: true, cpamPending: true, benign: false, duty: 'ett' }))).toMatch(/^Victime intérimaire : l'entreprise de travail temporaire déclare/);
    expect(advanceBlocker(4, [done], at({ health: true, cpamPending: true, benign: true, duty: 'employer' }))).toMatch(/^Victime extérieure : son employeur déclare/);
    expect(advanceBlocker(4, [done], at({ health: true, cpamPending: false, benign: false, duty: 'ett' }))).toBeNull();
    // Les autres étapes ne dépendent pas de la déclaration.
    expect(advanceBlocker(3, [done], at({ health: false, cpamPending: true, benign: false }))).toBeNull();
  });
  it('obligation ouverte : ni déclarée, ni motivée ; premiers soins sans inscription au registre', () => {
    const ev = { type: 'AT', injury: 'arret' as string | null, cpamDeclaredOn: null as string | null, cpamWaivedAt: null as Date | null };
    expect(cpamPending(ev, false)).toBe(true);
    expect(cpamPending({ ...ev, cpamDeclaredOn: '2026-09-09' }, false)).toBe(false);
    expect(cpamPending({ ...ev, cpamWaivedAt: new Date() }, false)).toBe(false);
    expect(cpamPending({ ...ev, injury: null }, false)).toBe(true);
    expect(cpamPending({ ...ev, injury: 'soins' }, false)).toBe(true);
    expect(cpamPending({ ...ev, injury: 'soins' }, true)).toBe(false);
    expect(cpamPending({ ...ev, type: 'PA' }, false)).toBe(false);
  });
});

describe('intitulés et signalement anonyme (SEC-06, SEC-09)', () => {
  it('avertissement de saisie : lésion ou donnée médicale dans un texte libre', () => {
    expect(mentionsInjury('Coupure à la main')).toBe(true);
    expect(mentionsInjury('Entorse')).toBe(true);
    expect(mentionsInjury('Transporté aux urgences')).toBe(true);
    expect(mentionsInjury('Arrêt du convoyeur')).toBe(false);
    expect(mentionsInjury('Chute de charge')).toBe(false);
  });
  it('intitulé neutre d’un accident signalé du terrain', () => {
    expect(neutralAccidentTitle('Atelier montage')).toBe('Accident · Atelier montage');
    expect(neutralAccidentTitle('x'.repeat(120))).toHaveLength(90);
  });
});

describe('analyse des causes', () => {
  it('arbre des causes : un niveau au plus sous la ligne précédente, fait ultime au niveau 0', () => {
    expect(normalizeTree([{ level: 2 }, { level: 3 }, { level: 1 }, { level: 9 }]).map((l) => l.level)).toEqual([0, 1, 1, 2]);
  });
  it('analyse saisie selon la méthode', () => {
    expect(analysisFilled('5m', [['Matière', 'Élingue usée']])).toBe(true);
    expect(analysisFilled('5m', [])).toBe(false);
    expect(analysisFilled('tree', [[0, 'Charge basculée', true]])).toBe(true);
    expect(analysisFilled('why', ['Pourquoi ?'])).toBe(true);
    expect(analysisFilled('8d', { current: 0, notes: ['', ''] })).toBe(false);
    expect(analysisFilled('8d', { current: 2 })).toBe(true);
    expect(analysisFilled('why', null)).toBe(false);
    expect(readD8({ current: 12, notes: ['a', 3] })).toEqual({ current: 8, notes: ['a', ''] });
  });
});

describe('EVT-11 : analyse des causes après l’étape « Actions »', () => {
  it('analyse retenue : ni vidée ni remplacée par une méthode vide à partir de « Actions »', () => {
    expect(analysisChangeBlocker(2, false, 'clear')).toBeNull();
    expect(analysisChangeBlocker(3, true, 'clear')).toBeNull();
    expect(analysisChangeBlocker(3, false, 'clear')).toBe("Événement à l'étape « Actions » : l'analyse des causes ne peut plus être vidée (modifiez-la plutôt).");
    expect(analysisChangeBlocker(4, true, 'method')).toBeNull();
    expect(analysisChangeBlocker(4, false, 'method')).toMatch(/^Événement à l'étape « Efficacité vérifiée » : la méthode d'analyse ne change que pour une méthode déjà renseignée/);
  });
  it('clôture : analyse exigée, après les autres contrôles', () => {
    expect(advanceBlocker(4, [done], { ...ctx, hasAnalysis: false })).toBe("Analyse des causes (méthode « Arbre des causes ») vide : saisissez-la avant la clôture.");
    expect(advanceBlocker(4, [open], { ...ctx, hasAnalysis: false })).toMatch(/n'est pas encore vérifiée/);
    expect(advanceBlocker(3, [done], { ...ctx, hasAnalysis: false })).toBeNull();
  });
});
