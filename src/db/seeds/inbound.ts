import { eq } from 'drizzle-orm';
import * as t from '../schema';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration des demandes reçues de Keystone (D13, décision CV-08, migration 0026), comme si Keystone les avait
// déposées par vigie.pub_signaler_avancement_nc puis que Vigie les avait traitées (src/server/inbound.ts) :
// - références projet de la NC EV-2026-130 (article Keystone), appliquée ;
// - passage de la NC EV-2026-121 à « Efficacité vérifiée » demandé alors que ses actions ne sont pas vérifiées,
//   refusée par les règles de Vigie (échéance « demande refusée » du responsable QHSE du site).

const CALLER = 'keystone_app';
const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`);

export async function seedInbound(tx: SeedTx) {
  const [first] = await tx.insert(t.inboundRequests).values([
    {
      caller: CALLER, tool: 'keystone', kind: 'nc_references', externalId: 'demo-keystone-0001', targetRef: 'EV-2026-130', projectCode: 'K-2025-042',
      payload: { kind: 'references', partRef: 'ARB-MAL-045', actor: { name: '[G. Comte]', role: 'quality' }, comment: 'Article de l’arbre de malaxeur dans la nomenclature du projet.' },
      receivedAt: at(rel(-5), '09:12'), status: 'applied', processedAt: at(rel(-5), '09:20'), result: 'Références enregistrées : Article Keystone.', eventId: 'EV-2026-130',
    },
    {
      caller: CALLER, tool: 'keystone', kind: 'nc_step', externalId: 'demo-keystone-0002', targetRef: 'EV-2026-121', projectCode: 'K-2025-042',
      payload: { kind: 'step', fromStatus: 'corrective_action', targetStatus: 'verification', actor: { name: '[G. Comte]', role: 'quality' }, comment: 'Lot de remplacement reçu et contrôlé.' },
      receivedAt: at(rel(-2), '15:40'), status: 'rejected', processedAt: at(rel(-2), '15:50'), resultCode: 'refused', eventId: 'EV-2026-121',
      result: 'Actions liées pas encore vérifiées : vérifiez-les (ou abandonnez-les) dans le plan d’actions avant le passage à l’étape « Efficacité vérifiée ».',
    },
  ]).returning({ id: t.inboundRequests.id });
  await tx.update(t.events).set({ partRef: 'ARB-MAL-045' }).where(eq(t.events.id, 'EV-2026-130'));
  await tx.insert(t.changeLog).values({
    entityType: 'event', entityId: 'EV-2026-130', action: 'update', summary: `Keystone (keystone_app) : références du projet renseignées (demande n° ${first.id})`,
    details: [{ field: 'Article Keystone', from: null, to: 'ARB-MAL-045' }, { field: 'Demande reçue', from: null, to: `Keystone (keystone_app) · n° ${first.id} · Références Keystone` }],
    byId: null, at: at(rel(-5), '09:20'),
  });
}
