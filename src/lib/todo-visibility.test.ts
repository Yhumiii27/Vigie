import { describe, expect, it } from 'vitest';
import { todoKey, type Role, type TodoItem } from './domain';
import { visibleTodo, type TodoViewer } from './todo-visibility';

// Visibilité des échéances (TDB-02, TDB-05, SEC-06) : responsable sans accès à l'écran, autres sites du périmètre,
// écrans en consultation seule, données de santé, vue Salarié.

const ME = { id: 'me', name: '[M. Moi]' };
const OTHER = { id: 'other', name: '[A. Autre]' };
const as = (role: Role, siteId: string | null = 'site-a'): TodoViewer => ({ role, user: ME, siteId });
const item = (over: Partial<TodoItem> = {}): TodoItem => ({
  date: '2026-10-12', kind: 'Action', tone: 'accent', title: 'A-001 · Échéance', who: OTHER.name, ownerIds: [OTHER.id],
  href: '/actions?action=A-001', siteId: 'site-a', ...over,
});
const mine = (over: Partial<TodoItem> = {}) => item({ who: ME.name, ownerIds: [ME.id], ...over });
const audit = (over: Partial<TodoItem> = {}) => item({ kind: 'Audit interne', title: 'Processus Conception BE', href: '/audits?annee=2026&element=4', siteId: null, ...over });

describe('responsable sans accès à l’écran source (TDB-02)', () => {
  it('le responsable garde l’échéance, sans lien, ou avec la vue en lecture', () => {
    // Salarié : écran Audits fermé.
    const [bare] = visibleTodo([mine({ href: '/audits?constat=3' })], as('Salarié'));
    expect(bare).toMatchObject({ title: 'A-001 · Échéance', source: 'audits', elsewhere: false });
    expect(bare.href).toBeUndefined();
    const [read] = visibleTodo([mine({ href: '/audits?constat=3', readHref: '/audits/contributions' })], as('Salarié'));
    expect(read.href).toBe('/audits/contributions');
    expect(read).not.toHaveProperty('readHref');
  });

  it('écran ouvert : lien d’origine, même avec une vue en lecture', () => {
    const [x] = visibleTodo([mine({ readHref: '/audits/contributions' })], as('Chef de service'));
    expect(x.href).toBe('/actions?action=A-001');
  });

  it('la clé d’état lu vient du lien d’origine', () => {
    const src = mine({ href: '/audits?constat=3' });
    const [x] = visibleTodo([src], as('Salarié'));
    expect(x.key).toBe(todoKey(src));
    expect(x.key).toContain('/audits?constat=3');
    const keyed = mine({ key: 'clé-propre' });
    expect(visibleTodo([keyed], as('Chef de service'))[0].key).toBe('clé-propre');
  });

  it('un non-responsable sans accès à l’écran ne la voit pas', () => {
    expect(visibleTodo([item({ href: '/audits?constat=3' })], as('Salarié'))).toEqual([]);
    expect(visibleTodo([item({ href: '/veille?exigence=1' })], as('Chef de projet'))).toEqual([]);
  });

  it('écran en consultation seule : le responsable la voit, pas les autres', () => {
    const doc = { href: '/documents?doc=PR-QHSE-002', kind: 'Document', siteId: null };
    expect(visibleTodo([item(doc)], as('Chef de service'))).toEqual([]);
    expect(visibleTodo([mine(doc)], as('Chef de service'))).toMatchObject([{ href: '/documents?doc=PR-QHSE-002', source: 'docs' }]);
    // Audits en consultation pour le chef de projet : son audit seulement, lien ouvert.
    expect(visibleTodo([audit()], as('Chef de projet'))).toEqual([]);
    expect(visibleTodo([audit({ ownerIds: [ME.id], who: ME.name })], as('Chef de projet'))).toMatchObject([{ href: '/audits?annee=2026&element=4' }]);
    // Écran modifiable : toutes les échéances du site.
    expect(visibleTodo([audit()], as('Animateur QHSE'))).toHaveLength(1);
  });

  it('le repli sur le nom ne contourne ni l’écran ni le site', () => {
    const byName = mine({ ownerIds: undefined, href: '/audits?constat=3' });
    expect(visibleTodo([byName], as('Salarié'))).toEqual([]);
    expect(visibleTodo([mine({ ownerIds: undefined, siteId: 'site-b' })], as('Salarié'))).toEqual([]);
    expect(visibleTodo([mine({ ownerIds: undefined })], as('Salarié'))).toHaveLength(1);
  });
});

describe('données de santé (SEC-06)', () => {
  it('retirée pour un rôle non habilité, responsable compris', () => {
    const cpam = mine({ kind: 'Déclaration AT à la CPAM', href: '/evenements?sel=EV-1', health: true });
    expect(visibleTodo([cpam], as('Chef de service'))).toEqual([]);
    expect(visibleTodo([cpam], as('Salarié'))).toEqual([]);
    expect(visibleTodo([cpam], as('Animateur QHSE'))).toHaveLength(1);
    expect(visibleTodo([cpam], as('Direction'))).toHaveLength(1);
  });
});

describe('sites du périmètre (TDB-05)', () => {
  it('Salarié : les siennes seulement, autres sites compris', () => {
    const list = [mine({ title: 'ici' }), mine({ title: 'ailleurs', siteId: 'site-b' }), item({ title: 'autre' })];
    expect(visibleTodo(list, as('Salarié')).map((x) => [x.title, x.elsewhere])).toEqual([['ici', false], ['ailleurs', true]]);
  });

  it('site A sélectionné : échéance de B retirée si elle n’est pas la sienne, gardée et signalée sinon', () => {
    expect(visibleTodo([item({ siteId: 'site-b' })], as('Animateur QHSE'))).toEqual([]);
    expect(visibleTodo([mine({ siteId: 'site-b' })], as('Chef de service'))).toMatchObject([{ elsewhere: true, href: '/actions?action=A-001' }]);
  });

  it('élément sans site : jamais d’un autre site ; « Tous les sites » : aucun élément d’un autre site', () => {
    expect(visibleTodo([item({ siteId: null })], as('Animateur QHSE'))).toMatchObject([{ elsewhere: false }]);
    const all = visibleTodo([item({ siteId: 'site-b' }), mine({ siteId: 'site-a' }), item({ siteId: null })], as('Animateur QHSE', null));
    expect(all).toHaveLength(3);
    expect(all.some((x) => x.elsewhere)).toBe(false);
  });

  it('ordre conservé ; écran source d’une échéance sans lien : tableau de bord', () => {
    const [x] = visibleTodo([item({ href: undefined })], as('Chef de service'));
    expect(x).toMatchObject({ source: 'dashboard', elsewhere: false });
    expect(x.href).toBeUndefined();
    const list = [item({ title: '1' }), item({ title: '2' }), item({ title: '3' })];
    expect(visibleTodo(list, as('Direction')).map((t) => t.title)).toEqual(['1', '2', '3']);
  });
});
