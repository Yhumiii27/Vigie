import 'server-only';
import { randomUUID } from 'node:crypto';
import { asc, eq, max, sql } from 'drizzle-orm';
import { schema as t, type Db } from '@/db';
import { logChange } from '@/server/changelog';
import type { Role } from '../domain';
import { hasLeft } from '../people';
import { hasAllSites, type EntraProfile } from './claims';

// Fiche de la personne qui se connecte (SEC-03, décision § 5) : rapprochement par objectId Entra, sinon par e-mail
// (l'objectId est alors enregistré), sinon création de la fiche (nom, e-mail, objectId du jeton ; site = premier site
// autorisé). Jamais de rapprochement par le nom.

export type SignIn =
  | { ok: true; personId: string; created: boolean; siteIds: string[] | null }
  | { ok: false; reason: string };

export async function signInPerson(db: Db, input: {
  profile: EntraProfile;
  role: Role;
  /** Sites accordés par les groupes Entra. */
  groupSites: string[];
  /** Date du jour (AAAA-MM-JJ), pour une fiche sortie de l'effectif. */
  today: string;
  now?: Date;
}): Promise<SignIn> {
  const { role, groupSites, today } = input;
  const profile = { ...input.profile, email: input.profile.email?.trim().toLowerCase() || null };
  const now = input.now ?? new Date();
  const all = hasAllSites(role);
  return db.transaction(async (tx) => {
    const sites = await tx.select({ id: t.sites.id, archivedAt: t.sites.archivedAt }).from(t.sites).orderBy(asc(t.sites.sort));
    const activeIds = sites.filter((s) => !s.archivedAt).map((s) => s.id);
    const knownIds = new Set(sites.map((s) => s.id));
    const granted = groupSites.filter((id) => knownIds.has(id));

    const cols = { id: t.people.id, siteId: t.people.siteId, email: t.people.email, entraObjectId: t.people.entraObjectId, leftOn: t.people.leftOn };
    let [person] = await tx.select(cols).from(t.people).where(eq(t.people.entraObjectId, profile.oid));
    if (!person && profile.email) {
      const [byEmail] = await tx.select(cols).from(t.people).where(sql`lower(${t.people.email}) = ${profile.email}`);
      if (byEmail?.entraObjectId) {
        return { ok: false, reason: `la fiche ${byEmail.id} (${profile.email}) est déjà associée à un autre compte Microsoft` };
      }
      person = byEmail;
    }

    if (person) {
      if (hasLeft(person, today)) return { ok: false, reason: `fiche ${person.id} sortie de l'effectif` };
      // E-mail du compte Microsoft (source de vérité du compte professionnel), s'il n'est pas porté par une autre fiche.
      let email = person.email;
      if (profile.email && profile.email !== person.email?.toLowerCase()) {
        const [taken] = await tx.select({ id: t.people.id }).from(t.people).where(sql`lower(${t.people.email}) = ${profile.email}`);
        if (!taken) email = profile.email;
      }
      await tx.update(t.people).set({ entraObjectId: profile.oid, email, lastRole: role, lastLoginAt: now }).where(eq(t.people.id, person.id));
      if (!person.entraObjectId) {
        await logChange(tx, { entityType: 'person', entityId: person.id, action: 'link', summary: 'Fiche associée au compte Microsoft Entra ID', byId: person.id });
      }
      return { ok: true, personId: person.id, created: false, siteIds: all ? null : unique([...granted, person.siteId]) };
    }

    // Première connexion sans fiche : création, rattachée au premier site autorisé.
    const homeSite = (all ? activeIds : activeIds.filter((id) => granted.includes(id)))[0] ?? null;
    const id = randomUUID();
    const [{ last }] = await tx.select({ last: max(t.people.sort) }).from(t.people);
    await tx.insert(t.people).values({
      id, name: profile.name, email: profile.email, entraObjectId: profile.oid, siteId: homeSite,
      sort: (last ?? -1) + 1, lastRole: role, lastLoginAt: now,
    });
    await logChange(tx, { entityType: 'person', entityId: id, action: 'create', summary: 'Fiche créée à la première connexion (Microsoft Entra ID)', byId: id });
    return { ok: true, personId: id, created: true, siteIds: all ? null : unique([...granted, homeSite]) };
  });
}

const unique = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => !!id))];
