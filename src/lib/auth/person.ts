import 'server-only';
import { randomUUID } from 'node:crypto';
import { asc, eq, max, sql } from 'drizzle-orm';
import { schema as t, type Db } from '@/db';
import { logChange } from '@/server/changelog';
import type { Role } from '../domain';
import { hasLeft } from '../people';
import { TRUSTED_EMAIL_REFUSALS, hasAllSites, trustedEmail, type EntraProfile } from './claims';

// Fiche de la personne qui se connecte (SEC-03, décision § 5 ; réserve SEC-01/03 du lot 1) : rapprochement par objectId
// Entra ; sinon, à la première connexion, par une adresse de confiance seulement (revendication email vérifiée par
// Microsoft, xms_edov, d'un domaine de VIGIE_EMAIL_DOMAINS : trustedEmail) — l'objectId est alors enregistré —, ou
// création de la fiche avec cette adresse (nom et objectId du jeton ; site = premier site autorisé). Sans adresse de
// confiance, la première connexion est refusée (motif « adresse ») : une adresse non vérifiée ne devient jamais la clé de
// rapprochement d'une fiche. Jamais de rapprochement par le nom.

export type SignIn =
  | { ok: true; personId: string; created: boolean; siteIds: string[] | null }
  | { ok: false; motif: 'non-autorise' | 'adresse'; reason: string };

export async function signInPerson(db: Db, input: {
  profile: EntraProfile;
  role: Role;
  /** Sites accordés par les groupes Entra. */
  groupSites: string[];
  /** Date du jour (AAAA-MM-JJ), pour une fiche sortie de l'effectif. */
  today: string;
  /** Domaines de messagerie de l'entreprise (VIGIE_EMAIL_DOMAINS). */
  emailDomains: readonly string[];
  now?: Date;
}): Promise<SignIn> {
  const { profile, role, groupSites, today } = input;
  const trusted = trustedEmail(profile, input.emailDomains);
  const now = input.now ?? new Date();
  const all = hasAllSites(role);
  return db.transaction(async (tx): Promise<SignIn> => {
    const sites = await tx.select({ id: t.sites.id, archivedAt: t.sites.archivedAt }).from(t.sites).orderBy(asc(t.sites.sort));
    const activeIds = sites.filter((s) => !s.archivedAt).map((s) => s.id);
    const knownIds = new Set(sites.map((s) => s.id));
    const granted = groupSites.filter((id) => knownIds.has(id));
    const cols = { id: t.people.id, siteId: t.people.siteId, email: t.people.email, entraObjectId: t.people.entraObjectId, leftOn: t.people.leftOn };
    const byEmail = (email: string) => tx.select(cols).from(t.people).where(sql`lower(${t.people.email}) = ${email}`);

    const [linked] = await tx.select(cols).from(t.people).where(eq(t.people.entraObjectId, profile.oid));
    if (linked) {
      if (hasLeft(linked, today)) return { ok: false, motif: 'non-autorise', reason: `fiche ${linked.id} sortie de l'effectif` };
      // Adresse du compte Microsoft (source de vérité du compte professionnel) : reprise seulement si elle est de confiance
      // et n'est pas portée par une autre fiche ; une adresse non vérifiée ne remplace jamais celle de la fiche.
      let email = linked.email;
      if (trusted.ok && trusted.email !== linked.email?.toLowerCase()) {
        const [taken] = await byEmail(trusted.email);
        if (!taken) email = trusted.email;
      }
      await tx.update(t.people).set({ email, lastRole: role, lastLoginAt: now }).where(eq(t.people.id, linked.id));
      return { ok: true, personId: linked.id, created: false, siteIds: all ? null : unique([...granted, linked.siteId]) };
    }

    // Première connexion de ce compte : adresse de confiance exigée (rapprochement comme création).
    if (!trusted.ok) {
      return { ok: false, motif: 'adresse', reason: `première connexion de ${profile.oid} (${profile.email ?? 'sans adresse'}) : ${TRUSTED_EMAIL_REFUSALS[trusted.reason]}` };
    }
    const [person] = await byEmail(trusted.email);
    if (person) {
      if (person.entraObjectId) {
        return { ok: false, motif: 'non-autorise', reason: `la fiche ${person.id} (${trusted.email}) est déjà associée à un autre compte Microsoft` };
      }
      if (hasLeft(person, today)) return { ok: false, motif: 'non-autorise', reason: `fiche ${person.id} sortie de l'effectif` };
      await tx.update(t.people).set({ entraObjectId: profile.oid, lastRole: role, lastLoginAt: now }).where(eq(t.people.id, person.id));
      await logChange(tx, { entityType: 'person', entityId: person.id, action: 'link', summary: 'Fiche associée au compte Microsoft Entra ID', byId: person.id });
      return { ok: true, personId: person.id, created: false, siteIds: all ? null : unique([...granted, person.siteId]) };
    }

    // Première connexion sans fiche : création, rattachée au premier site autorisé.
    const homeSite = (all ? activeIds : activeIds.filter((id) => granted.includes(id)))[0] ?? null;
    const id = randomUUID();
    const [{ last }] = await tx.select({ last: max(t.people.sort) }).from(t.people);
    await tx.insert(t.people).values({
      id, name: profile.name, email: trusted.email, entraObjectId: profile.oid, siteId: homeSite,
      sort: (last ?? -1) + 1, lastRole: role, lastLoginAt: now,
    });
    await logChange(tx, { entityType: 'person', entityId: id, action: 'create', summary: 'Fiche créée à la première connexion (Microsoft Entra ID)', byId: id });
    return { ok: true, personId: id, created: true, siteIds: all ? null : unique([...granted, homeSite]) };
  });
}

const unique = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => !!id))];
