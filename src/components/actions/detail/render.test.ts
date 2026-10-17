// Rendu serveur de la fiche et du formulaire d'action (flux B) : ce que chaque lecteur reçoit dans le HTML — boutons
// d'écriture selon les droits, texte d'un commentaire retiré jamais affiché, bloc Vérification à l'état Vérifiée seulement,
// source imposée par l'élément lié (jamais libre), aucun « Tous les sites ». Les server actions sont simulées : on ne
// vérifie que le rendu (les droits côté serveur sont testés par le flux A).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/plan', () => ({ saveAction: vi.fn(), addActionFiles: vi.fn(), removeActionFile: vi.fn() }));
vi.mock('@/server/plan-ui', () => ({ moveAction: vi.fn(), verifyAction: vi.fn(), reopenAction: vi.fn(), abandonAction: vi.fn() }));
vi.mock('@/server/action-comments', () => ({ addActionComment: vi.fn(), withdrawActionComment: vi.fn() }));
vi.mock('@/app/actions', () => ({ setSite: vi.fn() }));
vi.mock('@/server/links', () => ({ linkAction: vi.fn(), unlinkAction: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }));

const { ActionDetail } = await import('../ActionDetail');
const { ActionFields } = await import('../../ActionFormDialog');
const { actionRights, NON_QSE_LINK_MESSAGE } = await import('@/lib/action-rules');
const { RESPONSIBLE_READ_ONLY, READER_READ_ONLY, NO_HEALTH_REMINDER } = await import('./form-helpers');
type Detail = import('@/lib/action-view').ActionDetailView;
type Options = import('@/lib/action-view').ActionFormOptions;
type Role = import('@/lib/domain').Role;

const OPTIONS: Options = { people: [['clefevre', 'C. Lefèvre'], ['tnguyen', 'T. Nguyen']], sites: [['ville-a', 'Ville A']], today: '2026-10-15' };
const NONE: Options = { people: [], sites: [], today: '2026-10-15' };

const detail = (over: Partial<Detail> = {}): Detail => ({
  id: 'A-215', label: 'Remplacer les élingues', openedOn: '2026-10-01', opened: '01/10/2026',
  status: 'p40', avancement: '40 %', statusLabel: '40 %', tone: 'accent', group: 'ouverte', kanban: null, late: false, lateDays: 0, verifyLate: false,
  priority: 'urgent', priorityLabel: 'Urgent', domain: 'securite', domainLabel: 'Sécurité',
  source: 'evenement', sourceLabel: 'Évènement QSE', sourceIcon: 'ph-warning', originRef: 'EV-2026-130',
  siteId: 'ville-a', site: 'Ville A', siteShort: 'VA', pilotId: 'tnguyen', pilot: 'T. Nguyen', pilotInitials: 'TN', pilotLeft: false,
  dueOn: '2026-11-15', due: '15/11/2026', initialDueOn: '2026-11-15', rescheduled: false, verifyDueOn: '2026-12-15', verifyDue: '15/12/2026',
  doneOn: null, closedOn: null, cancelledOn: null, cancelReason: null, hours: null, estimatedCost: null, actualCost: null,
  followsActionId: null, followReason: null, missing: [], toComplete: false, mine: false, elsewhere: false,
  problem: 'Élingues usées', detail: 'Remplacer les élingues', riskLevel: null, riskLevelLabel: null,
  verifyMethod: null, verifyMethodLabel: null, efficacyNote: null, effective: null, newRisk: false, verifiedById: null, verifiedBy: null,
  previousVerification: null, cancelledBy: null, legacyOriginLabel: null, eventId: 'EV-2026-130', sources: [],
  follows: null, followUps: [], comments: [], files: [], history: [], linkTargets: [], healthWarning: false,
  ...over,
});

const fiche = (role: Role, userId: string, d: Detail, opts: { elsewhere?: string } = {}) => renderToStaticMarkup(createElement(ActionDetail, {
  detail: d, rights: actionRights(role, userId, d, opts), options: role === 'Animateur QHSE' ? OPTIONS : NONE,
  currentUserId: userId, today: '2026-10-15', verifyDefault: '2026-11-14',
}));

describe('fiche d’action : boutons et mentions selon le lecteur', () => {
  it('QHSE sur le site de l’action : Modifier, Abandonner, Changer l’avancement', () => {
    const html = fiche('Animateur QHSE', 'clefevre', detail());
    for (const label of ['Modifier', 'Abandonner', 'Changer l’avancement']) expect(html).toContain(label);
    expect(html).not.toContain('Vérifier l’efficacité');
    expect(html).not.toContain(RESPONSIBLE_READ_ONLY);
  });
  it('QHSE responsable d’une action d’un autre site : écritures désactivées, sélection du site proposée, fil ouvert', () => {
    const html = fiche('Animateur QHSE', 'tnguyen', detail(), { elsewhere: 'Ville B' });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Modifier/);
    expect(html).toContain('Sélectionner Ville B');
    expect(html).toContain('Ajouter un commentaire');
  });
  it('responsable Salarié : lecture seule, fil et preuves ouverts, aide « aucune donnée de santé »', () => {
    const html = fiche('Salarié', 'tnguyen', detail());
    expect(html).toContain(RESPONSIBLE_READ_ONLY);
    expect(html).not.toMatch(/>Modifier</);
    expect(html).toContain('Ajouter un commentaire');
    expect(html).toContain(NO_HEALTH_REMINDER);
  });
  it('encadrement lecteur du plan : consultation seule, ni fil ni preuves en écriture', () => {
    const html = fiche('Chef de service', 'sbenali', detail());
    expect(html).toContain(READER_READ_ONLY);
    expect(html).not.toContain('Ajouter un commentaire');
    expect(html).not.toMatch(/>Modifier</);
  });
  it('commentaire retiré : mention seule, jamais de texte', () => {
    const html = fiche('Salarié', 'tnguyen', detail({
      comments: [
        { id: 1, authorId: 'tnguyen', author: 'T. Nguyen', authorRole: 'Salarié', byResponsible: true, at: '2026-10-14T07:12:00.000Z', atLabel: '14/10/2026 à 09:12', body: 'Texte visible', withdrawn: null, files: [] },
        { id: 2, authorId: 'tnguyen', author: 'T. Nguyen', authorRole: 'Salarié', byResponsible: true, at: '2026-10-14T08:00:00.000Z', atLabel: '14/10/2026 à 10:00', body: null, withdrawn: { atLabel: '14/10/2026 à 10:05', by: 'T. Nguyen', reason: 'Erreur' }, files: [] },
      ],
    }));
    expect(html).toContain('Texte visible');
    expect(html).toContain('Commentaire retiré le 14/10/2026 à 10:05 par T. Nguyen : Erreur');
    expect(html).toContain('14/10/2026 à 09:12 · T. Nguyen · Salarié · responsable');
  });
  it('bloc Vérification à l’état Vérifiée seulement ; ancien constat d’une ligne reprise rouverte', () => {
    const verified = fiche('Animateur QHSE', 'clefevre', detail({ status: 'verifiee', closedOn: '2026-10-10', effective: false, efficacyNote: 'Usure constatée', verifiedBy: 'C. Lefèvre' }));
    expect(verified).toContain('aria-label="Vérification"');
    expect(verified).toContain('Non efficace');
    expect(verified).toContain('Rouvrir');
    expect(verified).not.toContain('Vérifiée par son responsable');
    const reopened = fiche('Animateur QHSE', 'clefevre', detail({ status: 'terminee', previousVerification: { note: 'Ancien constat', by: 'C. Lefèvre' } }));
    expect(reopened).not.toContain('aria-label="Vérification"');
    expect(reopened).toContain('Constat d’une vérification précédente');
    expect(reopened).toContain('Vérifier l’efficacité');
  });
});

const form = (defaults: Parameters<typeof ActionFields>[0]['defaults'], options: Options = OPTIONS) =>
  renderToStaticMarkup(createElement(ActionFields, { options, defaults, onDone: () => {} }));

describe('fiche d’action : rattacher et détacher un lien complémentaire (ACT-02)', () => {
  const linked = detail({
    sources: [
      { kind: 'event', label: 'EV-2026-130', href: '/evenements?sel=EV-2026-130' },
      { kind: 'risk', label: 'Atelier · Chute', href: '/risques?risque=3', link: 'risk:3' },
    ],
    linkTargets: [{ value: 'control:2', label: 'VGP · Pont roulant', kind: 'control' }],
  });
  it('QHSE : « Détacher » sur le lien complémentaire seulement, « Rattacher un élément »', () => {
    const html = fiche('Animateur QHSE', 'clefevre', linked);
    expect(html.match(/Détacher<\/button>/g)).toHaveLength(1);
    expect(html).toContain('Rattacher un élément');
  });
  it('action d’un autre site : boutons désactivés', () => {
    const html = fiche('Animateur QHSE', 'clefevre', linked, { elsewhere: 'Ville B' });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Rattacher un élément/);
  });
  it('Vérifiée : détacher seulement ; Abandonnée : ni l’un ni l’autre', () => {
    const verified = fiche('Animateur QHSE', 'clefevre', { ...linked, status: 'verifiee' });
    expect(verified).toContain('Détacher');
    expect(verified).not.toContain('Rattacher un élément');
    const abandoned = fiche('Animateur QHSE', 'clefevre', { ...linked, status: 'abandonnee' });
    expect(abandoned).not.toContain('Détacher');
    expect(abandoned).not.toContain('Rattacher un élément');
  });
  it('responsable, encadrement : ni « Rattacher » ni « Détacher »', () => {
    for (const [role, user] of [['Salarié', 'tnguyen'], ['Chef de service', 'sbenali']] as const) {
      const html = fiche(role, user, linked);
      expect(html, role).not.toContain('Détacher');
      expect(html, role).not.toContain('Rattacher un élément');
    }
  });
});

describe('formulaire d’action : source et site', () => {
  it('élément imposé sans source indiquée : source déduite du type (DUERP), jamais la liste des 24', () => {
    const html = form({ link: 'risk:12', linkLabel: 'Risque · chute' });
    expect(html).toContain('<input type="hidden" name="source" value="duerp"/>');
    expect(html).not.toContain('<select id="source"');
    expect(html).toContain('<input type="hidden" name="link" value="risk:12"/>');
  });
  it('élément imposé à plusieurs sources possibles : seules celles-ci', () => {
    const html = form({ link: 'event:EV-2026-130' });
    const options = [...html.matchAll(/<select id="source"[\s\S]*?<\/select>/g)][0][0];
    expect(options.match(/<option value="[a-z_]+"/g)).toEqual(['<option value="evenement"', '<option value="reclamation_client"']);
  });
  it('habilitation, plan de prévention, permis : refusés (aucune action QSE)', () => {
    expect(form({ link: 'permit:PT-1' })).toContain(NON_QSE_LINK_MESSAGE.replace(/'/g, '&#x27;'));
  });
  it('plan, sans élément : les 24 sources ; « Tous les sites » jamais proposé', () => {
    const html = form({}, { ...OPTIONS, sites: [['all', 'Tous les sites'], ['ville-a', 'Ville A']] });
    const select = [...html.matchAll(/<select id="source"[\s\S]*?<\/select>/g)][0][0];
    expect(select.match(/<option value="[a-z_]+"/g)).toHaveLength(24);
    expect(html).not.toContain('Tous les sites');
  });
  it('modification d’une Vérifiée : vérification planifiée figée, pointage seul (nature et constat par « Rouvrir », D17)', () => {
    const html = form({ id: 'A-170', status: 'verifiee', source: 'duerp', siteId: 'ville-a', verifyDueOn: '2026-09-01', doneOn: '2026-09-05' });
    expect(html).toContain('Fixée : l’action est vérifiée.');
    expect(html).not.toContain('name="verifyDueOn"');
    expect(html).not.toContain('name="verifyMethod"');
    expect(html).not.toContain('name="efficacyNote"');
    expect(html).toContain('name="hours"');
    expect(html).toContain('<input type="hidden" name="from" value="verifiee"/>');
  });
});
