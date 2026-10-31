import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../domain';
import { backgroundRole, todoByPerson, type PersonTodoPerson } from './person-todo';

const TODAY = '2026-10-09';
const people: PersonTodoPerson[] = [
  { id: 'qhse', name: 'Animatrice', email: 'a@x', lastRole: 'Animateur QHSE', leftOn: null },
  { id: 'cs', name: 'Chef', email: null, lastRole: 'Chef de service', leftOn: null },
  { id: 'sal', name: 'Salarié', email: null, lastRole: null, leftOn: null },
  { id: 'parti', name: 'Parti', email: null, lastRole: 'Direction', leftOn: '2026-10-01' },
];
const item = (over: Partial<TodoItem>): TodoItem => ({ date: TODAY, kind: 'Contrôle', tone: 'warn', title: 'x', who: '', siteId: 'ville-a', href: '/veille?onglet=controles&controle=1', ...over });

describe('PRD-12 : échéances par personne hors requête', () => {
  it('rôle inconnu : Salarié (le plus restreint)', () => {
    expect(backgroundRole(null)).toBe('Salarié');
    expect(backgroundRole('Inconnu')).toBe('Salarié');
    expect(backgroundRole('Direction')).toBe('Direction');
  });

  it('responsables désignés seulement (ownerIds), présents, tous sites ; retards et horizon des notifications comptés', () => {
    const items = [
      item({ title: 'retard', ownerIds: ['qhse', 'cs'], overdue: true, siteId: 'ville-b' }),
      item({ title: 'dans 20 j', ownerIds: ['qhse'], date: '2026-10-29' }),
      item({ title: 'sans responsable' }),
      item({ title: 'du parti', ownerIds: ['parti'] }),
    ];
    const r = todoByPerson(items, people, TODAY);
    expect(r.map((p) => p.personId)).toEqual(['qhse', 'cs']);
    expect(r[0]).toMatchObject({ role: 'Animateur QHSE', late: 1, notify: 1, email: 'a@x' });
    expect(r[0].items.map((i) => i.title)).toEqual(['retard', 'dans 20 j']);
    expect(r[1].items.map((i) => i.title)).toEqual(['retard']);
  });

  it('donnée de santé retirée pour un rôle non habilité, même responsable ; lien retiré sur un écran fermé', () => {
    const items = [
      item({ title: 'santé', ownerIds: ['cs', 'qhse'], health: true, href: '/evenements?sel=EV-1' }),
      item({ title: 'veille', ownerIds: ['sal'], href: '/veille?exigence=1' }),
    ];
    const r = todoByPerson(items, people, TODAY);
    expect(r.find((p) => p.personId === 'cs')).toBeUndefined();
    expect(r.find((p) => p.personId === 'qhse')!.items.map((i) => i.title)).toEqual(['santé']);
    const sal = r.find((p) => p.personId === 'sal')!;
    expect(sal.role).toBe('Salarié');
    expect(sal.items[0].href).toBeUndefined();
  });
});
