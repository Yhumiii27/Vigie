// Fournisseur OpenID Connect factice, à la manière de Microsoft Entra ID (v2.0), pour tester la connexion de Vigie
// sans tenant réel (SEC-01). Tests et développement seulement : aucune authentification réelle.
//
//   node scripts/oidc-mock.mjs [--port 55480] [--tenant vigie-test] [--client-id vigie] [--client-secret secret-de-test]
//                              [--redirect http://localhost:3291] [--users users.json]
//
// Émetteur : http://127.0.0.1:<port>/<tenant>/v2.0 — à donner à Vigie dans ENTRA_ISSUER (avec ENTRA_TENANT_ID,
// ENTRA_CLIENT_ID et ENTRA_CLIENT_SECRET identiques). --redirect : origine(s) de Vigie admises pour /auth/retour et
// /auth/deconnecte (séparées par des virgules).
//
// Choix du compte (« session » du fournisseur, cookie mock_user) :
//   - navigateur : la page d'autorisation liste les comptes ;
//   - curl : GET /_mock/login?user=<clé> avec le même fichier de cookies, puis le parcours de connexion de Vigie ;
//   - ou paramètre login_hint=<clé> dans l'URL d'autorisation.
// Comptes par défaut (DEFAULT_USERS ci-dessous) calqués sur le jeu de démonstration ; groupes d'exemple grp-ville-a,
// grp-ville-b (VIGIE_SITE_GROUPS=grp-ville-a:ville-a,grp-ville-b:ville-b). GET /_mock/users les liste.
// Revendications email et xms_edov (adresse vérifiée, vraie sauf « edov: false ») comme les revendications facultatives
// d'Entra ; « noEmail: true » les retire (VIGIE_EMAIL_DOMAINS=epc2i.example pour les comptes par défaut).

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const PORT = Number(args.port ?? 55480);
const TENANT = args.tenant ?? 'vigie-test';
const CLIENT_ID = args['client-id'] ?? 'vigie';
const CLIENT_SECRET = args['client-secret'] ?? 'secret-de-test';
const REDIRECT_ORIGINS = (args.redirect ?? 'http://localhost:3291').split(',').map((s) => s.trim().replace(/\/$/, ''));
const ISSUER = `http://127.0.0.1:${PORT}/${TENANT}/v2.0`;
const BASE = `/${TENANT}`;

/** Comptes : clé → revendications (assigned: false = utilisateur non affecté à l'application, erreur AADSTS50105). */
const DEFAULT_USERS = {
  animateur: { name: '[C. Lefèvre]', email: 'c.lefevre@epc2i.example', roles: ['Vigie.AnimateurQHSE'], groups: [] },
  direction: { name: '[H. Marchand]', email: 'h.marchand@epc2i.example', roles: ['Vigie.Salarie', 'Vigie.Direction'], groups: [] },
  chefservice: { name: '[S. Benali]', email: 'S.Benali@EPC2I.example', roles: ['Vigie.ChefService'], groups: [] },
  salarie: { name: '[T. Nguyen]', email: 't.nguyen@epc2i.example', roles: ['Vigie.Salarie'], groups: ['grp-ville-b'] },
  essais: { name: '[A. Martin]', email: 'a.martin@epc2i.example', roles: ['Vigie.ChefProjet'], groups: [] },
  nouveau: { name: 'Nina Rousseau', email: 'n.rousseau@epc2i.example', roles: ['Vigie.Salarie'], groups: ['grp-ville-b', 'grp-inconnu'] },
  sansrole: { name: '[P. Roux]', email: 'p.roux@epc2i.example', roles: [], groups: [] },
  parti: { name: '[Y. Lambert]', email: 'y.lambert@epc2i.example', roles: ['Vigie.Salarie'], groups: [] },
  nonaffecte: { name: 'Externe Non Affecté', email: 'externe@autre.example', roles: [], groups: [], assigned: false },
  // Première connexion refusée (motif « adresse ») : adresse d'une fiche existante non vérifiée par Microsoft (xms_edov
  // faux), ou adresse vérifiée d'un domaine hors de VIGIE_EMAIL_DOMAINS (epc2i.example dans les essais).
  nonverifie: { name: 'Compte Adresse Non Vérifiée', email: 'm.girard@epc2i.example', edov: false, roles: ['Vigie.Salarie'], groups: [] },
  horsdomaine: { name: 'P. Durand (prestataire)', email: 'p.durand@prestataire.example', roles: ['Vigie.ChefProjet'], groups: [] },
};
const USERS = args.users ? JSON.parse(readFileSync(args.users, 'utf8')) : DEFAULT_USERS;
// objectId stable par compte (dérivé de la clé) : les connexions successives retrouvent la même fiche.
const oidOf = (key) => {
  const h = createHash('sha256').update(`oid:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'mock-1', use: 'sig', alg: 'RS256' };
/** Codes d'autorisation à usage unique (2 min). */
const codes = new Map();

const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `http://127.0.0.1:${PORT}${BASE}/oauth2/v2.0/authorize`,
  token_endpoint: `http://127.0.0.1:${PORT}${BASE}/oauth2/v2.0/token`,
  end_session_endpoint: `http://127.0.0.1:${PORT}${BASE}/oauth2/v2.0/logout`,
  jwks_uri: `http://127.0.0.1:${PORT}${BASE}/discovery/v2.0/keys`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  subject_types_supported: ['pairwise'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  code_challenge_methods_supported: ['S256'],
  claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'oid', 'tid', 'name', 'email', 'xms_edov', 'preferred_username', 'roles', 'groups', 'login_hint'],
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
const redirect = (res, url, headers = {}) => send(res, 302, '', { Location: String(url), ...headers });
const cookieOf = (req, name) => (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const registered = (uri, path) => REDIRECT_ORIGINS.some((o) => uri === `${o}${path}`);
const log = (...m) => console.log('[oidc-mock]', ...m);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function authorize(req, res, url) {
  const p = url.searchParams;
  const redirectUri = p.get('redirect_uri') ?? '';
  if (p.get('client_id') !== CLIENT_ID) return send(res, 400, 'AADSTS700016: client_id inconnu');
  if (!registered(redirectUri, '/auth/retour')) return send(res, 400, `AADSTS50011: redirect_uri non inscrite (${redirectUri})`);
  const back = new URL(redirectUri);
  const state = p.get('state');
  const fail = (error, description) => {
    back.searchParams.set('error', error);
    back.searchParams.set('error_description', description);
    if (state) back.searchParams.set('state', state);
    return redirect(res, back);
  };
  if (p.get('response_type') !== 'code') return fail('unsupported_response_type', 'AADSTS70005: response_type=code attendu');
  if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) return fail('invalid_request', 'AADSTS9002325: PKCE S256 requis');
  if (!(p.get('scope') ?? '').split(' ').includes('openid')) return fail('invalid_scope', 'AADSTS650053: portée openid requise');

  const key = p.get('login_hint') && USERS[p.get('login_hint')] ? p.get('login_hint') : cookieOf(req, 'mock_user');
  const user = key && USERS[key];
  if (!user) {
    // Pas de compte choisi : page de sélection (navigateur).
    const items = Object.entries(USERS).map(([k, u]) =>
      `<li><a href="/_mock/login?user=${encodeURIComponent(k)}&next=${encodeURIComponent(url.pathname + url.search)}">${escape(k)}</a> — ${escape(u.name)} · ${escape(u.roles.join(', ') || 'aucun rôle')}${u.groups.length ? ` · groupes ${escape(u.groups.join(', '))}` : ''}</li>`).join('');
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Fournisseur OIDC factice</title><h1>Choisir un compte (test)</h1><ul>${items}</ul>`, { 'Content-Type': 'text/html; charset=utf-8' });
  }
  if (user.assigned === false) return fail('access_denied', `AADSTS50105: l'utilisateur ${user.email} n'est pas affecté à l'application.`);
  const code = randomBytes(24).toString('base64url');
  codes.set(code, { key, redirectUri, nonce: p.get('nonce'), challenge: p.get('code_challenge'), exp: Date.now() + 120_000 });
  back.searchParams.set('code', code);
  if (state) back.searchParams.set('state', state);
  back.searchParams.set('session_state', randomUUID());
  log(`autorisation : ${key} → ${back.origin}${back.pathname}`);
  return redirect(res, back);
}

async function token(req, res) {
  const body = await readBody(req);
  let clientId = body.get('client_id');
  let secret = body.get('client_secret');
  const basic = req.headers.authorization?.match(/^Basic (.+)$/i);
  if (basic) [clientId, secret] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent);
  if (clientId !== CLIENT_ID || secret !== CLIENT_SECRET) return json(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: secret invalide' });
  if (body.get('grant_type') !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });
  const entry = codes.get(body.get('code') ?? '');
  codes.delete(body.get('code') ?? '');
  if (!entry || entry.exp < Date.now()) return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70008: code expiré ou déjà utilisé' });
  if (body.get('redirect_uri') !== entry.redirectUri) return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70000: redirect_uri différente' });
  const verifier = body.get('code_verifier') ?? '';
  if (createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS501481: code_verifier invalide' });

  const u = USERS[entry.key];
  const oid = u.oid ?? oidOf(entry.key);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    oid, tid: TENANT, name: u.name, preferred_username: u.email, ...(u.noEmail ? {} : { email: u.email, xms_edov: u.edov ?? true }),
    ...(u.roles.length ? { roles: u.roles } : {}), ...(u.groups.length ? { groups: u.groups } : {}),
    login_hint: `hint-${entry.key}`, ...(entry.nonce ? { nonce: entry.nonce } : {}), ver: '2.0',
  };
  const idToken = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
    .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject(createHash('sha256').update(`sub:${entry.key}`).digest('base64url'))
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 3600).sign(privateKey);
  log(`jetons : ${entry.key} (rôles ${u.roles.join(', ') || 'aucun'})`);
  return json(res, 200, { token_type: 'Bearer', scope: 'openid profile email', expires_in: 3600, access_token: randomBytes(32).toString('base64url'), id_token: idToken });
}

function logout(req, res, url) {
  const post = url.searchParams.get('post_logout_redirect_uri');
  const clear = { 'Set-Cookie': 'mock_user=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' };
  log(`déconnexion (logout_hint=${url.searchParams.get('logout_hint') ?? '—'})`);
  if (post && registered(post, '/auth/deconnecte')) return redirect(res, post, clear);
  return send(res, 200, 'Vous êtes déconnecté (fournisseur factice).', { 'Content-Type': 'text/plain; charset=utf-8', ...clear });
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const route = `${req.method} ${url.pathname}`;
  (async () => {
    switch (route) {
      case `GET ${BASE}/v2.0/.well-known/openid-configuration`: return json(res, 200, discovery);
      case `GET ${BASE}/discovery/v2.0/keys`: return json(res, 200, { keys: [jwk] });
      case `GET ${BASE}/oauth2/v2.0/authorize`: return authorize(req, res, url);
      case `POST ${BASE}/oauth2/v2.0/token`: return token(req, res);
      case `GET ${BASE}/oauth2/v2.0/logout`: return logout(req, res, url);
      case 'GET /_mock/users': return json(res, 200, Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, { ...u, oid: u.oid ?? oidOf(k) }])));
      case 'GET /_mock/login': {
        const key = url.searchParams.get('user');
        if (!key || !USERS[key]) return send(res, 404, 'Compte inconnu');
        const next = url.searchParams.get('next');
        const cookie = { 'Set-Cookie': `mock_user=${encodeURIComponent(key)}; Path=/; HttpOnly; SameSite=Lax` };
        return next?.startsWith('/') ? redirect(res, next, cookie) : send(res, 200, `Compte choisi : ${key}`, { 'Content-Type': 'text/plain; charset=utf-8', ...cookie });
      }
      default: return send(res, 404, 'Not found');
    }
  })().catch((err) => { console.error(err); send(res, 500, 'Erreur'); });
}).listen(PORT, '127.0.0.1', () => log(`émetteur ${ISSUER} (client ${CLIENT_ID}, retour ${REDIRECT_ORIGINS.join(', ')})`));
