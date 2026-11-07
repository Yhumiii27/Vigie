import { describe, expect, it } from 'vitest';
import { CURSUS_LEFT_REASON, companyKey, cursusPersonSync, followedSite, newCachedPerson, shouldCreate, type CachedPerson, type CursusPersonRow } from './people-sync';

// D01 (décision CV-10) : écart entre une fiche de Vigie et sa ligne de cursus.pub_salaries.

const followed = new Set(['site_a', 'site_b']);
const label = (id: string | null) => (id ? `Site ${id}` : null);
const local: CachedPerson = {
  name: '[T. Nguyen]', job: 'Monteur', siteId: 'site_a', leftOn: null, leftReason: null, cursusState: 'actif', category: 'salarie', company: null,
  cursusEmail: 't.nguyen@epc2i.example',
};
const src: CursusPersonRow = { matricule: 'EMP-9001', name: '[T. Nguyen]', job: 'Monteur', siteCode: 'site_a', leftOn: null, category: 'salarie', company: null, email: 't.nguyen@epc2i.example' };

describe('cursusPersonSync', () => {
  it('rien à écrire quand la fiche suit Cursus', () => {
    expect(cursusPersonSync(local, src, followed, label)).toEqual({ patch: {}, entries: [] });
  });

  it('nom, poste et site repris ; site non suivi → aucun site ; journal sans donnée en clair pour l’e-mail', () => {
    const r = cursusPersonSync(local, { ...src, name: '[T. Nguyen-Durand]', job: 'Chef d’équipe', siteCode: 'site_x', email: 'autre@epc2i.example' }, followed, label);
    expect(r.patch).toEqual({ name: '[T. Nguyen-Durand]', job: 'Chef d’équipe', siteId: null, cursusEmail: 'autre@epc2i.example' });
    expect(r.entries).toEqual([{ action: 'sync', summary: 'Fiche mise à jour depuis Cursus (référentiel du personnel)', details: [
      { field: 'Nom', from: '[T. Nguyen]', to: '[T. Nguyen-Durand]' }, { field: 'Poste', from: 'Monteur', to: 'Chef d’équipe' },
      { field: 'Site de rattachement', from: 'Site site_a', to: null }, { field: 'E-mail publié par Cursus', from: 'adresse publiée', to: 'adresse publiée' },
    ] }]);
    expect(JSON.stringify(r.entries)).not.toContain('@');
  });

  it('contrat v1 (colonnes v2 absentes) : catégorie, entreprise et e-mail de Vigie gardés', () => {
    const v1: CursusPersonRow = { matricule: 'EMP-9001', name: '[T. Nguyen]', job: 'Monteur', siteCode: 'site_a', leftOn: null };
    expect(cursusPersonSync(local, v1, followed, label)).toEqual({ patch: {}, entries: [] });
  });

  it('sortie enregistrée dans Cursus, puis annulée', () => {
    const left = cursusPersonSync(local, { ...src, leftOn: '2026-10-09' }, followed, label);
    expect(left.patch).toEqual({ leftOn: '2026-10-09', leftReason: CURSUS_LEFT_REASON });
    expect(left.entries).toEqual([{ action: 'archive', summary: 'Sortie enregistrée dans Cursus (le 09/10/2026)', reason: CURSUS_LEFT_REASON }]);
    const back = cursusPersonSync({ ...local, leftOn: '2026-10-09', leftReason: CURSUS_LEFT_REASON }, src, followed, label);
    expect(back.patch).toEqual({ leftOn: null, leftReason: null });
    expect(back.entries[0]).toMatchObject({ action: 'restore', summary: 'Sortie annulée dans Cursus' });
  });

  it('même date de sortie : motif saisi avant D01 gardé', () => {
    expect(cursusPersonSync({ ...local, leftOn: '2026-09-30', leftReason: 'Fin de contrat' }, { ...src, leftOn: '2026-09-30' }, followed, label).patch).toEqual({});
  });

  it('personne retirée de la vue : état « absent », une seule fois', () => {
    const r = cursusPersonSync(local, undefined, followed, label);
    expect(r.patch).toEqual({ cursusState: 'absent' });
    expect(r.entries[0]).toMatchObject({ action: 'sync', details: [{ field: 'État dans Cursus', from: 'Publiée par Cursus', to: 'Absente de Cursus' }] });
    expect(cursusPersonSync({ ...local, cursusState: 'absent' }, undefined, followed, label)).toEqual({ patch: {}, entries: [] });
    // De retour dans la vue : « publiée » journalisé.
    expect(cursusPersonSync({ ...local, cursusState: 'absent' }, src, followed, label).entries[0].details).toEqual([{ field: 'État dans Cursus', from: 'Absente de Cursus', to: 'Publiée par Cursus' }]);
  });

  it('première lecture : catégorie, entreprise et e-mail posés sans journal', () => {
    const r = cursusPersonSync({ ...local, cursusState: null, category: null, cursusEmail: null }, src, followed, label);
    expect(r.patch).toEqual({ cursusState: 'actif', category: 'salarie', cursusEmail: 't.nguyen@epc2i.example' });
    expect(r.entries).toEqual([]);
  });
});

describe('création et rapprochement', () => {
  it('personne créée si présente ou sortie depuis moins d’un an', () => {
    expect(shouldCreate({ leftOn: null }, '2026-10-09')).toBe(true);
    expect(shouldCreate({ leftOn: '2025-10-09' }, '2026-10-09')).toBe(true);
    expect(shouldCreate({ leftOn: '2025-10-08' }, '2026-10-09')).toBe(false);
  });
  it('valeurs d’une nouvelle fiche', () => {
    expect(newCachedPerson({ ...src, category: 'interimaire', company: '[Agence]', siteCode: 'site_z', leftOn: '2026-10-01' }, followed)).toEqual({
      name: '[T. Nguyen]', job: 'Monteur', siteId: null, leftOn: '2026-10-01', leftReason: CURSUS_LEFT_REASON, cursusState: 'actif', category: 'interimaire',
      company: '[Agence]', cursusEmail: 't.nguyen@epc2i.example',
    });
    expect(followedSite('site_b', followed)).toBe('site_b');
  });
  it('nom d’entreprise normalisé (casse, accents, crochets, ponctuation)', () => {
    expect(companyKey('[Entreprise Élec Industrie]')).toBe(companyKey('entreprise elec-industrie'));
    expect(companyKey(null)).toBe('');
  });
});
