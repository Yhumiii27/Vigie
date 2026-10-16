import { describe, expect, it } from 'vitest';
import { admissibleSources } from '@/lib/action-rules';
import { entryActionDefaults, streamActionDefaults } from './action-defaults';

// Valeurs proposées par l'écran Environnement au formulaire d'action (plan du paquet 1, flux E2, amendement A4) : source
// « Déchets » imposée et admise pour l'élément lié (D20 révisée), domaine Environnement, site de l'élément.

const TODAY = '2026-10-09';
const kindOf = (link: string | undefined) => link?.split(':')[0] ?? null;

describe('actions de l’écran Environnement', () => {
  it('filière : source « Déchets » imposée, filière liée, site de la filière', () => {
    const d = streamActionDefaults({ id: 'FD-11', label: 'Huiles usagées', ewcCode: '13 02 05*', destination: '[Régénérateur]', siteId: 'ville-a' }, TODAY);
    expect(d).toMatchObject({
      source: 'dechets', lockSource: true, domain: 'environnement', link: 'wastestream:FD-11', linkLabel: 'Filière · FD-11 · Huiles usagées',
      originRef: 'FD-11', siteId: 'ville-a', dueOn: '2026-11-08', verifyDueOn: '2026-12-08',
      problem: 'Filière FD-11 · Huiles usagées (13 02 05*) · exutoire [Régénérateur].',
    });
    expect(admissibleSources(kindOf(d.link), {})).toEqual([d.source]);
  });

  it('enlèvement : enlèvement lié ; bordereau non finalisé : certificat de traitement à obtenir', () => {
    const entry = { id: 42, ref: 'FD-11 · 19/08/2026', siteId: 'ville-b', stream: 'Huiles usagées', removedOn: '2026-08-19', quantity: 400, unit: 'L', bsdNumber: 'BSD-2026-0042', staleBsd: true };
    const d = entryActionDefaults(entry, TODAY);
    expect(d).toMatchObject({
      source: 'dechets', lockSource: true, link: 'wasteentry:42', originRef: 'FD-11 · 19/08/2026', siteId: 'ville-b',
      detail: 'Obtenir le certificat de traitement du BSD-2026-0042',
    });
    expect(d.problem).toMatch(/^Enlèvement du 19\/08\/2026 · Huiles usagées · 400.L · BSD-2026-0042\.$/);
    expect(admissibleSources(kindOf(d.link), {})).toEqual([d.source]);
    expect(entryActionDefaults({ ...entry, staleBsd: false }, TODAY).detail).toBeUndefined();
  });
});
