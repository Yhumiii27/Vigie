import type { NextRequest } from 'next/server';
import { getDb } from '@/db';
import { hasAllSites, isCseMember, profileFromClaims, roleFromEntra, sitesFromGroups, tidMismatch } from '@/lib/auth/claims';
import { clavisGrant } from '@/lib/auth/clavis-access';
import { oidcCookieName, openTransaction, sealSession, sessionCookieName, sessionMaxAge, type SessionClaims } from '@/lib/auth/cookie';
import { finishLogin } from '@/lib/auth/oidc';
import { accessHref, type AccessMotif } from '@/lib/auth/paths';
import { signInPerson } from '@/lib/auth/person';
import { clearAuthCookie, redirectTo, setAuthCookie } from '@/lib/auth/responses';
import { config, entraMissing, secureCookies } from '@/lib/config';
import { today } from '@/lib/today';
import { log } from '@/lib/log';

// URI de retour OIDC (SEC-01, SEC-02) : <VIGIE_PUBLIC_URL>/auth/retour?code=…&state=…
// Code → jetons (PKCE), rôle Vigie (rôles applicatifs, le plus élevé ; ou clavis.pub_acces avec VIGIE_ACCESS_FROM_CLAVIS=on),
// sites (groupes Entra, quand le jeton en porte), fiche rapprochée ou créée,
// puis cookie de session chiffré (8 h glissantes, 12 h au plus). Aucun rôle Vigie : « Accès non autorisé » ; première
// connexion sans adresse vérifiée d'un domaine de l'entreprise (VIGIE_EMAIL_DOMAINS) : « Compte Microsoft non rattaché ».

export async function GET(req: NextRequest) {
  const c = config();
  if (c.demo) return redirectTo('/', req);
  if (entraMissing(c).length) return redirectTo(accessHref('configuration'), req);
  const secure = secureCookies(c);
  const sp = req.nextUrl.searchParams;
  const txCookie = oidcCookieName(secure, sp.get('state') ?? '');
  const fail = (motif: AccessMotif, detail: string) => {
    log.warn('auth.refused', 'Connexion refusée', { motif, detail });
    const res = redirectTo(accessHref(motif), req);
    clearAuthCookie(res, txCookie);
    return res;
  };

  // Erreur renvoyée par Microsoft (utilisateur non affecté à l'application, consentement refusé…).
  const error = sp.get('error');
  if (error) {
    const description = sp.get('error_description') ?? '';
    const denied = error === 'access_denied' || /AADSTS50105/.test(description);
    return fail(denied ? 'non-autorise' : 'echec', `${error} ${description.slice(0, 300)}`);
  }

  const tx = await openTransaction(req.cookies.get(txCookie)?.value, c.sessionSecret!);
  if (!tx) return fail('echec', 'connexion expirée ou state inconnu (cookie de transaction absent)');

  let claims: Record<string, unknown>;
  try {
    claims = await finishLogin(req.nextUrl.search, tx);
  } catch (err) {
    return fail('echec', `échange du code refusé (${err instanceof Error ? err.message : String(err)})`);
  }
  const profile = profileFromClaims(claims);
  if (!profile) return fail('echec', "jeton d'identité sans oid (portée profile ?)");
  // Émetteur remplacé (Clavis, fournisseur de test) avec ENTRA_TENANT_ID : l'annuaire du jeton doit être celui attendu.
  if (c.entra!.tenantId && !c.entra!.issuer.startsWith('https://login.microsoftonline.com/') && tidMismatch(claims, c.entra!.tenantId)) {
    return fail('echec', `annuaire du jeton (tid ${typeof claims.tid === 'string' ? claims.tid : 'absent'}) différent de ENTRA_TENANT_ID`);
  }
  // Rôle : lu dans Clavis (VIGIE_ACCESS_FROM_CLAVIS=on : clavis.pub_acces, les rôles du jeton ne sont pas lus ; accès
  // fermé = « Accès non autorisé », vue illisible = échec, jamais d'accès par défaut), sinon rôles applicatifs du jeton.
  let role;
  if (c.accessFromClavis) {
    const grant = await clavisGrant(profile.oid, { fresh: true });
    if (!grant.ok) return fail(grant.reason === 'unreadable' ? 'echec' : 'non-autorise', `droits de ${profile.oid} lus dans Clavis : ${grant.detail}`);
    role = grant.role;
  } else {
    role = roleFromEntra(profile.roles, c.entraRoles);
    if (!role) return fail('non-autorise', `aucun rôle applicatif Vigie pour ${profile.oid} (rôles reçus : ${profile.roles.join(', ') || 'aucun'})`);
  }
  if (profile.groupsOverage && !hasAllSites(role)) {
    log.warn('auth.groups-overage', "Jeton sans groupes (trop nombreux) : sites accordés par VIGIE_SITE_GROUPS ignorés. Limiter la revendication aux groupes affectés à l'application.", { oid: profile.oid });
  }

  let outcome;
  try {
    outcome = await signInPerson(await getDb(), {
      profile, role, groupSites: sitesFromGroups(profile.groups, c.siteGroups), today: today(), emailDomains: c.emailDomains,
    });
  } catch (err) {
    // Base indisponible, ou deux premières connexions simultanées du même compte (contrainte d'unicité) : réessayer.
    return fail('echec', `fiche de ${profile.oid} non enregistrée (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!outcome.ok) return fail(outcome.motif, outcome.reason);

  const now = Math.floor(Date.now() / 1000);
  const session: SessionClaims = {
    pid: outcome.personId, role, sites: outcome.siteIds, oid: profile.oid,
    ...(isCseMember(profile.groups, c.cseGroup) ? { cse: true } : {}),
    ...(profile.loginHint ? { hint: profile.loginHint } : {}), auth: now, seen: now,
  };
  const res = redirectTo(tx.retour, req);
  setAuthCookie(res, sessionCookieName(secure), await sealSession(session, c.sessionSecret!), sessionMaxAge(session, now));
  clearAuthCookie(res, txCookie);
  log.info('auth.login', 'Connexion', { personId: outcome.personId, role, created: outcome.created });
  return res;
}
