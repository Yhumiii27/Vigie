import { describe, expect, it } from 'vitest';
import '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { insertAction } from './actions-helpers';
import { loadActionDetail } from '@/lib/data/actions';

// ACT-12 : action reprise d'une situation de coactivité sans plan de prévention (ancienne origine Prévention, référence
// « Coactivité JJ/MM/AAAA ») : la référence d'origine mène à la carte du site de l'action à cette date, plus à /prevention.

freshDemoDatabase();

const sourcesOf = async (id: string) => (await loadActionDetail(id)).payload!.detail.sources;

describe('origine « Coactivité JJ/MM/AAAA » (ACT-12)', () => {
  it('lien vers la carte du site de l’action à la date de la référence', async () => {
    await insertAction('A-901', { source: null, legacyOrigin: 'prevention', originRef: 'Coactivité 08/10/2026', siteId: 'ville-b' });
    actAs('Animateur QHSE', 'all');
    expect(await sourcesOf('A-901')).toEqual([{ kind: 'reference', label: 'Coactivité 08/10/2026', href: '/prevention/carte?site=ville-b&date=2026-10-08' }]);
  });

  it('source complétée ensuite : même lien ; autre référence de Prévention : aucun lien vers la carte', async () => {
    await insertAction('A-902', { source: 'analyse_risque', legacyOrigin: 'prevention', originRef: 'Coactivité 01/10/2026', siteId: 'ville-a' });
    await insertAction('A-903', { source: null, legacyOrigin: 'prevention', originRef: 'Réunion chantier', siteId: 'ville-a' });
    actAs('Animateur QHSE', 'ville-a');
    expect((await sourcesOf('A-902'))[0].href).toBe('/prevention/carte?site=ville-a&date=2026-10-01');
    expect((await sourcesOf('A-903'))[0].href).toBeNull();
  });

  it('écran Prévention fermé au rôle : référence seule, sans lien', async () => {
    await insertAction('A-904', { source: null, legacyOrigin: 'prevention', originRef: 'Coactivité 08/10/2026', siteId: 'ville-a', pilotId: 'tnguyen' });
    actAs('Salarié', 'ville-a');
    expect((await sourcesOf('A-904'))[0]).toMatchObject({ label: 'Coactivité 08/10/2026', href: null });
  });
});
