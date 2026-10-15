import { describe, expect, it } from 'vitest';
import { actionRights, VERIFY_BEFORE_DUE_WARNING } from '@/lib/action-rules';
import type { ActionDetailView, ActionTargetOption } from '@/lib/action-view';
import { MAX_FILE_BYTES, MAX_FILES_PER_BATCH } from '@/lib/attachments';
import { ACTION_SOURCES, SOURCE_KEYS } from '@/lib/domain';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, type Option } from '@/lib/form-options';
import {
  ABANDONED_READER_READ_ONLY, ABANDONED_READ_ONLY, READER_READ_ONLY, RESPONSIBLE_READ_ONLY, commentMeta, creationSourceChoices, defaultMoveTarget, defaultSiteId,
  detailButtons, editDefaults, editSourceChoices, kindSources, linkKind, editOptions, fmtEuros, fmtHours, followUpPrefill, initialSource, linkStillAdmitted, lockedSource, missingSummary,
  moveFields, numberField, pickedFilesError, planningWarnings, readOnlyNotice, showPreviousVerification, showVerification,
  sourceHasElement, sourceHint, sourceOptions, targetChoices, targetSiteId, threadWritable, writesBlocked,
} from './form-helpers';

const SITES: Option[] = [['ville-a', 'Ville A'], ['ville-b', 'Ville B']];
const PEOPLE: Option[] = [['clefevre', 'C. Lefèvre'], ['tnguyen', 'T. Nguyen']];

const TARGETS: ActionTargetOption[] = [
  { value: 'event:EV-2026-130', label: 'EV-2026-130 · Chute de plain-pied', siteId: 'ville-a', sources: ['evenement'], healthWarning: true },
  { value: 'event:EV-2026-140', label: 'EV-2026-140 · Réclamation', siteId: 'ville-b', sources: ['reclamation_client'] },
  { value: 'finding:3', label: 'Constat · audit fournisseur', siteId: null, sources: ['audit_fournisseur'] },
  { value: 'finding:4', label: 'Constat · audit interne', siteId: null, sources: ['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain'] },
];

/** Fiche minimale : seuls les champs lus par les aides comptent. */
const detail = (over: Partial<ActionDetailView> = {}): ActionDetailView => ({
  id: 'A-215', status: 'p40', pilotId: 'tnguyen', pilot: 'T. Nguyen', priority: 'urgent', domain: 'securite', riskLevel: 3,
  siteId: 'ville-a', site: 'Ville A', source: 'evenement', originRef: 'EV-2026-130', problem: 'Problème', detail: 'Remplacer les élingues',
  dueOn: '2026-11-15', verifyDueOn: '2026-12-15', openedOn: '2026-10-01', doneOn: null, verifyMethod: null, efficacyNote: null,
  hours: null, estimatedCost: 120.5, actualCost: null, healthWarning: false, previousVerification: null,
  ...over,
} as ActionDetailView);

describe('source et élément lié (D20)', () => {
  it('liste des 24 sources dans l’ordre du QHSE, ou les seules sources admises', () => {
    expect(sourceOptions().map(([k]) => k)).toEqual([...SOURCE_KEYS]);
    expect(sourceOptions().length).toBe(24);
    expect(sourceOptions(['audit_terrain', 'audit_certification'])).toEqual([
      ['audit_certification', ACTION_SOURCES.audit_certification.label], ['audit_terrain', ACTION_SOURCES.audit_terrain.label],
    ]);
    expect(sourceOptions([])).toHaveLength(24);
  });
  it('précision sous la liste : AST-EST et Réserves', () => {
    expect(sourceHint('analyse_risque')).toMatch(/AST/);
    expect(sourceHint('reserves')).toMatch(/réception/);
    expect(sourceHint('comex')).toBeUndefined();
    expect(sourceHint('inconnue')).toBeUndefined();
    expect(sourceHint(null)).toBeUndefined();
  });
  it('source initiale : celle de l’écran si admise, sinon la seule admise, sinon à choisir', () => {
    expect(initialSource({ source: 'duerp' })).toBe('duerp');
    expect(initialSource({ source: 'duerp', sourceChoices: ['veille'] })).toBe('veille');
    expect(initialSource({ sourceChoices: ['veille', 'dechets'] })).toBe('');
    expect(initialSource({})).toBe('');
  });
  it('source verrouillée : lockSource ou une seule source admise', () => {
    expect(lockedSource({ source: 'evenement', lockSource: true })).toBe('evenement');
    expect(lockedSource({ sourceChoices: ['audit_fournisseur'] })).toBe('audit_fournisseur');
    expect(lockedSource({ source: 'veille', sourceChoices: ['veille', 'dechets'] })).toBeNull();
    expect(lockedSource({ lockSource: true })).toBeNull();
  });
  it('sélecteur d’élément : seulement pour une source à cible', () => {
    expect(sourceHasElement('evenement')).toBe(true);
    expect(sourceHasElement('dechets')).toBe(true);
    expect(sourceHasElement('comex')).toBe(false);
    expect(sourceHasElement('analyse_environnementale')).toBe(false);
    expect(sourceHasElement('')).toBe(false);
  });
  it('éléments filtrés par la source choisie (RC / non-RC, piste d’audit)', () => {
    expect(targetChoices(TARGETS, 'evenement').map((t) => t.value)).toEqual(['event:EV-2026-130']);
    expect(targetChoices(TARGETS, 'reclamation_client').map((t) => t.value)).toEqual(['event:EV-2026-140']);
    expect(targetChoices(TARGETS, 'audit_fournisseur').map((t) => t.value)).toEqual(['finding:3', 'finding:4']);
    expect(targetChoices(TARGETS, 'audit_interne').map((t) => t.value)).toEqual(['finding:4']);
    expect(targetChoices(TARGETS, '')).toEqual([]);
    expect(targetChoices(undefined, 'evenement')).toEqual([]);
  });
  it('l’élément choisi reste admis ou le sélecteur revient à « Aucun »', () => {
    expect(linkStillAdmitted(TARGETS, 'audit_fournisseur', 'finding:4')).toBe(true);
    expect(linkStillAdmitted(TARGETS, 'audit_interne', 'finding:3')).toBe(false);
    expect(linkStillAdmitted(TARGETS, 'comex', '')).toBe(true);
  });
});

describe('sources d’un élément imposé ou d’une action reprise (aucune source libre)', () => {
  it('sources que le type d’élément admet, toutes variantes de faits', () => {
    expect(kindSources('event')).toEqual(['evenement', 'reclamation_client']);
    expect(kindSources('risk')).toEqual(['duerp']);
    expect(kindSources('requirement')).toEqual(['dechets', 'veille']);
    expect(kindSources('wastestream')).toEqual(['dechets']);
    expect(kindSources('reviewdecision')).toEqual(['objectif', 'revue_direction']);
    expect(kindSources('finding')).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
    expect(kindSources('plan')).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain', 'revue_direction']);
    // Habilitation, plan de prévention, permis, type inconnu : aucune action QSE (amendements A2/A3).
    for (const k of ['qualification', 'preventionplan', 'permit', 'inconnu', 'constructor']) expect(kindSources(k)).toEqual([]);
    expect(linkKind('event:EV-2026-130')).toBe('event');
  });
  it('création : choix de l’écran, sinon d’après le type de l’élément imposé, sinon les 24', () => {
    expect(creationSourceChoices({ link: 'risk:12' })).toEqual(['duerp']);
    expect(creationSourceChoices({ link: 'event:EV-1' })).toEqual(['evenement', 'reclamation_client']);
    expect(creationSourceChoices({ link: 'permit:PT-1' })).toEqual([]);
    expect(creationSourceChoices({ link: 'finding:3', sourceChoices: ['audit_fournisseur'] })).toEqual(['audit_fournisseur']);
    expect(creationSourceChoices({ link: 'event:EV-1', source: 'reclamation_client', lockSource: true })).toEqual(['reclamation_client']);
    expect(creationSourceChoices({})).toBeUndefined();
    // Élément imposé à une seule source admise : source verrouillée.
    expect(lockedSource({ sourceChoices: creationSourceChoices({ link: 'control:3' }) })).toBe('controle_reglementaire');
  });
  it('modification d’une source vide : bornée par l’événement et les éléments d’audit de l’action', () => {
    const base = { source: null, eventId: null, sources: [] };
    expect(editSourceChoices(base)).toBeUndefined();
    expect(editSourceChoices({ ...base, eventId: 'EV-2026-130' })).toEqual(['evenement', 'reclamation_client']);
    expect(editSourceChoices({ ...base, sources: [{ kind: 'finding', label: 'Constat', href: null }, { kind: 'risk', label: 'Risque', href: null }] }))
      .toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
    // Repli d'affichage sur la référence d'origine (kind « event » sans event_id) : pas de contrainte.
    expect(editSourceChoices({ ...base, sources: [{ kind: 'event', label: 'EV-2026-001', href: null }] })).toBeUndefined();
    expect(editSourceChoices({ source: 'evenement', eventId: 'EV-1', sources: [] })).toBeUndefined();
    expect(editDefaults(detail({ source: null, eventId: 'EV-2026-130', sources: [] })).sourceChoices).toEqual(['evenement', 'reclamation_client']);
  });
});

describe('site proposé (§ 13)', () => {
  it('site de l’élément d’abord, puis celui de l’écran, puis le seul site, jamais « Tous les sites »', () => {
    expect(defaultSiteId(SITES, { elementSiteId: 'ville-b', siteId: 'ville-a' })).toBe('ville-b');
    expect(defaultSiteId(SITES, { elementSiteId: 'archive', siteId: 'ville-a' })).toBe('ville-a');
    expect(defaultSiteId(SITES, { elementSiteId: null, siteId: null })).toBe('');
    expect(defaultSiteId(SITES, { siteId: 'all' })).toBe('');
    expect(defaultSiteId([['ville-a', 'Ville A']], {})).toBe('ville-a');
  });
  it('site de l’élément choisi dans le sélecteur', () => {
    expect(targetSiteId(TARGETS, 'event:EV-2026-140')).toBe('ville-b');
    expect(targetSiteId(TARGETS, 'finding:3')).toBeNull();
    expect(targetSiteId(TARGETS, '')).toBeNull();
    expect(targetSiteId(TARGETS, 'event:inconnu')).toBeNull();
  });
});

describe('modification depuis la fiche', () => {
  it('valeurs actuelles de l’action', () => {
    const d = editDefaults(detail({ problem: null }));
    expect(d).toMatchObject({ id: 'A-215', status: 'p40', source: 'evenement', pilotId: 'tnguyen', pilotName: 'T. Nguyen', problem: '', estimatedCost: 120.5 });
    expect(d.link).toBeUndefined();
  });
  it('personne sortie et site archivé conservés comme choix, signalés', () => {
    const o = editOptions({ people: PEOPLE, sites: SITES, today: '2026-10-15' }, { pilotId: 'jdupont', pilot: 'J. Dupont', siteId: 'vieux', site: 'Vieux site' });
    expect(o.people.at(-1)).toEqual(['jdupont', `J. Dupont${LEFT_SUFFIX}`]);
    expect(o.sites.at(-1)).toEqual(['vieux', `Vieux site${ARCHIVED_SITE_SUFFIX}`]);
    const same = editOptions({ people: PEOPLE, sites: SITES, today: '2026-10-15' }, { pilotId: 'tnguyen', pilot: 'T. Nguyen', siteId: null, site: 'Site à compléter' });
    expect(same.people).toEqual(PEOPLE);
    expect(same.sites).toEqual(SITES);
  });
});

describe('boutons et mentions de la fiche (droits)', () => {
  it('QHSE : boutons selon l’avancement', () => {
    expect(detailButtons(actionRights('Animateur QHSE', 'clefevre', { pilotId: 'tnguyen', status: 'p40' }))).toEqual(['edit', 'abandon', 'move']);
    expect(detailButtons(actionRights('Animateur QHSE', 'clefevre', { pilotId: 'tnguyen', status: 'terminee' }))).toEqual(['edit', 'abandon', 'move', 'verify']);
    expect(detailButtons(actionRights('Direction', 'clefevre', { pilotId: 'tnguyen', status: 'verifiee' }))).toEqual(['edit', 'reopen']);
    expect(detailButtons(actionRights('Animateur QHSE', 'clefevre', { pilotId: 'tnguyen', status: 'abandonnee' }))).toEqual([]);
  });
  it('responsable et encadrement : aucun bouton d’écriture', () => {
    expect(detailButtons(actionRights('Salarié', 'tnguyen', { pilotId: 'tnguyen', status: 'p40' }))).toEqual([]);
    expect(detailButtons(actionRights('Chef de service', 'sbenali', { pilotId: 'tnguyen', status: 'terminee' }))).toEqual([]);
  });
  it('fil : QHSE sur le site de l’action, responsable de tout site (D19)', () => {
    const qhse = actionRights('Animateur QHSE', 'clefevre', { pilotId: 'tnguyen', status: 'p40' });
    expect(threadWritable(qhse)).toBe(true);
    expect(writesBlocked(qhse)).toBe(false);
    const elsewhere = actionRights('Animateur QHSE', 'clefevre', { pilotId: 'tnguyen', status: 'p40' }, { elsewhere: 'Ville B' });
    expect(writesBlocked(elsewhere)).toBe(true);
    expect(threadWritable(elsewhere)).toBe(false);
    const own = actionRights('Salarié', 'tnguyen', { pilotId: 'tnguyen', status: 'p40' }, { elsewhere: 'Ville B' });
    expect(threadWritable(own)).toBe(true);
    expect(threadWritable(actionRights('Chef de service', 'sbenali', { pilotId: 'tnguyen', status: 'p40' }))).toBe(false);
  });
  it('mention de lecture seule', () => {
    expect(readOnlyNotice(actionRights('Animateur QHSE', 'clefevre', { pilotId: 'x', status: 'p40' }), 'p40')).toBeNull();
    expect(readOnlyNotice(actionRights('Salarié', 'tnguyen', { pilotId: 'tnguyen', status: 'p40' }), 'p40')).toBe(RESPONSIBLE_READ_ONLY);
    expect(readOnlyNotice(actionRights('Chef de projet', 'x', { pilotId: 'tnguyen', status: 'p40' }), 'p40')).toBe(READER_READ_ONLY);
    expect(readOnlyNotice(actionRights('Animateur QHSE', 'clefevre', { pilotId: 'x', status: 'abandonnee' }), 'abandonnee')).toBe(ABANDONED_READ_ONLY);
    expect(readOnlyNotice(actionRights('Salarié', 'tnguyen', { pilotId: 'tnguyen', status: 'abandonnee' }), 'abandonnee')).toBe(ABANDONED_READ_ONLY);
    expect(readOnlyNotice(actionRights('Chef de service', 'x', { pilotId: 'tnguyen', status: 'abandonnee' }), 'abandonnee')).toBe(ABANDONED_READER_READ_ONLY);
  });
});

describe('bloc Vérification (D17)', () => {
  it('montré à l’état Vérifiée seulement', () => {
    expect(showVerification('verifiee')).toBe(true);
    for (const s of ['terminee', 'p40', 'abandonnee', 'reportee']) expect(showVerification(s)).toBe(false);
  });
  it('constat d’une vérification précédente sur une ligne reprise rouverte', () => {
    expect(showPreviousVerification({ status: 'p40', previousVerification: { note: 'Insuffisant', by: 'C. Lefèvre' } })).toBe(true);
    expect(showPreviousVerification({ status: 'verifiee', previousVerification: { note: 'x', by: null } })).toBe(false);
    expect(showPreviousVerification({ status: 'p40', previousVerification: null })).toBe(false);
  });
});

describe('changer l’avancement', () => {
  it('palier suivant proposé', () => {
    expect(defaultMoveTarget('a_faire')).toBe('initiee');
    expect(defaultMoveTarget('p40')).toBe('p60');
    expect(defaultMoveTarget('p80')).toBe('terminee');
    expect(defaultMoveTarget('reportee')).toBe('');
    expect(defaultMoveTarget('terminee')).toBe('');
  });
  it('champs selon la transition', () => {
    expect(moveFields('p80', 'terminee', { verifyDueOn: null })).toMatchObject({ kind: 'finish', doneOn: true, verifyDueOn: true, dueOn: false });
    expect(moveFields('p80', 'terminee', { verifyDueOn: '2026-12-01' })).toMatchObject({ kind: 'finish', verifyDueOn: false });
    expect(moveFields('reportee', 'p40', { verifyDueOn: null })).toMatchObject({ kind: 'resume', dueOn: true, doneOn: false });
    expect(moveFields('p40', 'reportee', { verifyDueOn: null }).kind).toBe('report');
    expect(moveFields('terminee', 'p80', { verifyDueOn: null }).notice).toMatch(/effacée/);
    expect(moveFields('p40', '', { verifyDueOn: null })).toMatchObject({ kind: null, notice: null });
  });
});

describe('actions de suite (§ 7)', () => {
  it('section non efficace pré-remplie d’après l’action vérifiée', () => {
    const p = followUpPrefill(detail(), 'non_efficace', { closedOn: '2026-10-15', note: ' Les élingues fuient encore. ', people: PEOPLE, sites: SITES });
    expect(p).toEqual({
      problem: 'Action A-215 jugée non efficace le 15/10/2026 : Les élingues fuient encore.',
      pilotId: 'tnguyen', priority: 'urgent', domain: 'securite', riskLevel: '3', siteId: 'ville-a',
    });
  });
  it('nouveau risque : problème à saisir ; responsable sorti et site archivé non repris', () => {
    const p = followUpPrefill(detail({ pilotId: 'parti', siteId: 'archive', riskLevel: null, priority: null }), 'nouveau_risque',
      { closedOn: '2026-10-15', note: 'x', people: PEOPLE, sites: SITES });
    expect(p).toEqual({ problem: '', pilotId: '', priority: '', domain: 'securite', riskLevel: '', siteId: '' });
  });
});

describe('dates, à compléter, fil, coûts', () => {
  it('avertissement : vérification planifiée avant la date cible (date du jour du serveur)', () => {
    expect(planningWarnings({ openedOn: '2026-10-15', dueOn: '2026-11-30', verifyDueOn: '2026-11-01' }, '2026-10-15')).toEqual([VERIFY_BEFORE_DUE_WARNING]);
    expect(planningWarnings({ openedOn: '2026-10-15', dueOn: '2026-11-30', verifyDueOn: '2026-12-30' }, '2026-10-15')).toEqual([]);
    expect(planningWarnings({ openedOn: '2026-10-15', dueOn: '', verifyDueOn: '2026-11-01' }, '2026-10-15')).toEqual([]);
  });
  it('résumé des champs à compléter', () => {
    expect(missingSummary(['source', 'siteId'])).toBe('À compléter : Source, Site');
    expect(missingSummary([])).toBeNull();
  });
  it('signature d’un commentaire', () => {
    expect(commentMeta({ atLabel: '14/10/2026 à 09:12', author: 'T. Nguyen', authorRole: 'Salarié', byResponsible: true }))
      .toBe('14/10/2026 à 09:12 · T. Nguyen · Salarié · responsable');
    expect(commentMeta({ atLabel: '14/10/2026 à 09:12', author: 'L. Moreau', authorRole: null, byResponsible: false })).toBe('14/10/2026 à 09:12 · L. Moreau');
  });
  it('fichiers choisis : mêmes limites que le serveur', () => {
    expect(pickedFilesError([{ name: 'a.jpg', size: 1000 }])).toBeNull();
    expect(pickedFilesError([{ name: 'gros.pdf', size: MAX_FILE_BYTES + 1 }])).toMatch(/gros\.pdf/);
    expect(pickedFilesError(Array.from({ length: MAX_FILES_PER_BATCH + 1 }, (_, i) => ({ name: `${i}.jpg`, size: 10 })))).toMatch(/au maximum/);
    expect(pickedFilesError([{ name: 'a', size: MAX_FILE_BYTES }, { name: 'b', size: 10 }])).toMatch(/plusieurs fois/);
  });
  it('pointage et coûts', () => {
    expect(fmtHours(3.5)).toBe('3,5 h');
    expect(fmtHours(null)).toBe('—');
    expect(fmtEuros(1200).replace(/\s/g, ' ')).toBe('1 200,00 € TTC');
    expect(fmtEuros(undefined)).toBe('—');
    expect(numberField(0)).toBe('0');
    expect(numberField(null)).toBe('');
  });
});
