import { describe, expect, it } from 'vitest';
import '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isClosedActionStatus } from '@/lib/domain';
import { loadMySpace } from '@/lib/data/my-space';

// EVT-22 : espace salarié mobile — mes actions, mes habilitations, mes signalements, pour tout rôle et sur ses seules
// données (jamais celles d'autrui, aucune donnée de santé). Jeu de démonstration au 09/10/2026 : Salarié = [T. Nguyen].

freshDemoDatabase();

const OTHER_NAMES = ['[M. Girard]', '[P. Roux]', '[A. Martin]', '[J. Petit]', '[R. Fontaine]', '[K. Bernard]', '[Y. Lambert]'];

describe('loadMySpace', () => {
  it('Salarié : ses actions ouvertes, sa ligne de la matrice, ses recyclages et ses signalements, rien d’autrui', async () => {
    actAs('Salarié', 'all');
    const space = await loadMySpace();
    expect(space.name).toBe('[T. Nguyen]');
    const db = await getDb();
    const own = (await db.select().from(t.actions).where(eq(t.actions.pilotId, 'tnguyen'))).filter((a) => !isClosedActionStatus(a.status));
    expect(space.actions.map((a) => a.id).sort()).toEqual(own.map((a) => a.id).sort());
    expect(space.actions.map((a) => a.id)).toContain('A-215');
    expect(space.actions.every((a) => a.href === `/actions?action=${a.id}`)).toBe(true);
    // Matrice : titres requis ou détenus de tnguyen (vvvnsxnv) ; hauteur expiré, SST bientôt.
    expect(space.skills?.map((s) => s.titleId)).toEqual(['accueil', 'elec', 'r484', 'sst', 'hauteur', 'conduite']);
    expect(space.skills?.find((s) => s.titleId === 'hauteur')?.state).toBe('x');
    expect(space.renewals.map((r) => r.titleId)).toEqual(expect.arrayContaining(['hauteur', 'sst']));
    expect(space.renewals.every((r) => r.personId === 'tnguyen')).toBe(true);
    expect(space.reports.total).toBe(6);
    const json = JSON.stringify(space);
    OTHER_NAMES.forEach((n) => expect(json).not.toContain(n));
    // Aucun champ de santé ni de responsable d'autrui dans la charge.
    expect(json).not.toMatch(/injury|lostDays|cpam|pilot"|ownerIds/i);
  });

  it('Chef de service : ses seules actions, pas le plan de son périmètre', async () => {
    actAs('Chef de service', 'ville-a');
    const space = await loadMySpace();
    const db = await getDb();
    const own = (await db.select().from(t.actions).where(eq(t.actions.pilotId, 'sbenali'))).filter((a) => !isClosedActionStatus(a.status));
    expect(space.actions.map((a) => a.id).sort()).toEqual(own.map((a) => a.id).sort());
    expect(space.name).toBe('[S. Benali]');
  });

  it('personne hors de la matrice : pas de ligne, aucun recyclage', async () => {
    actAs('Direction', 'all');
    // [H. Marchand] (direction) n'est pas suivi dans la matrice.
    const space = await loadMySpace();
    expect(space.skills).toBeNull();
    expect(space.renewals).toEqual([]);
  });
});
