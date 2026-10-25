import 'server-only';
import { cache } from 'react';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { VACANT_QHSE_LEAD, type Role } from '../domain';
import { hasLeft, type Person } from '../people';
import { loadPeople } from '../queries';

// Destinataires des alertes (TDB-01), tirés des données : responsable QHSE de chaque site (sites.qhse_lead_id,
// « Gérer les sites »). Poste vacant ou responsable sorti de l'effectif : l'alerte va aux animateurs QHSE
// (dernier rôle connu people.last_role) et affiche « Responsable QHSE à désigner ».
// Éléments sans site (DUERP, certifications, revue de direction) : responsables des sites actifs.

/** Destinataires d'une alerte : `ownerIds` pour « Mes échéances » et la vue Salarié, `who` pour l'affichage. */
export type Recipients = { ownerIds: string[]; who: string; vacant: boolean };

export const loadQhseLeads = cache(async () => {
  const db = await getDb();
  const now = today();
  const [sites, people] = await Promise.all([
    db.select({ id: t.sites.id, qhseLeadId: t.sites.qhseLeadId, archivedAt: t.sites.archivedAt }).from(t.sites),
    loadPeople(),
  ]);
  const present = (id: string | null | undefined): Person | undefined => {
    const p = id ? people.get(id) : undefined;
    return p && !hasLeft(p, now) ? p : undefined;
  };
  /** Personnes présentes dont le dernier rôle connu est `role`, dans l'ordre de l'annuaire. */
  const withRole = (role: Role) => [...people.values()].filter((p) => p.lastRole === role && !hasLeft(p, now));
  const animators = withRole('Animateur QHSE');
  const directors = withRole('Direction');
  const vacant: Recipients = { ownerIds: animators.map((p) => p.id), who: VACANT_QHSE_LEAD, vacant: true };
  const leadOf = new Map(sites.map((s) => [s.id, present(s.qhseLeadId)]));
  const activeLeads = [...new Map(sites.filter((s) => !s.archivedAt).flatMap((s) => {
    const p = leadOf.get(s.id);
    return p ? [[p.id, p] as const] : [];
  })).values()];

  /** Responsable QHSE du site (fiche), ou undefined si le poste est vacant ; sans site : premier responsable des sites actifs. */
  function lead(siteId: string | null | undefined): Person | undefined {
    return siteId ? leadOf.get(siteId) : activeLeads[0] ?? animators[0];
  }

  /** Destinataires des alertes d'un élément du site `siteId` (null : élément commun à tous les sites). */
  function forSite(siteId: string | null | undefined): Recipients {
    if (siteId) {
      const p = leadOf.get(siteId);
      return p ? { ownerIds: [p.id], who: p.name, vacant: false } : vacant;
    }
    if (activeLeads.length) return { ownerIds: activeLeads.map((p) => p.id), who: activeLeads.map((p) => p.name).join(' · '), vacant: false };
    return animators.length ? { ownerIds: animators.map((p) => p.id), who: animators.map((p) => p.name).join(' · '), vacant: false } : vacant;
  }

  return {
    forSite,
    lead,
    /** Direction (dernier rôle connu), dans l'ordre de l'annuaire. */
    directors,
    /** Animateurs QHSE (dernier rôle connu). */
    animators,
    /** Approbateurs (validation documentaire…) : animateurs QHSE et direction. */
    approvers: [...animators, ...directors],
  };
});
