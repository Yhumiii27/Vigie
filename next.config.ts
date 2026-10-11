import path from 'node:path';
import type { NextConfig } from 'next';
import { readConfig, standaloneBuild } from './src/lib/env';
import { STATIC_SECURITY_HEADERS } from './src/lib/security';

/**
 * Hôtes d'origine admis pour les server actions, en plus de l'hôte de la requête (SEC-04) : VIGIE_ALLOWED_HOSTS et
 * hôte de VIGIE_PUBLIC_URL, utiles quand le reverse proxy réécrit l'en-tête Host sans transmettre X-Forwarded-Host.
 * Lus au chargement de la configuration (démarrage de `next start`, ou construction pour une sortie standalone) ;
 * configuration absente ou invalide (construction générique) : même origine seulement.
 */
function serverActionOrigins(): string[] {
  try {
    return readConfig().allowedHosts;
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Image Docker (PRD-01) : serveur autonome .next/standalone (VIGIE_STANDALONE=1, npm run build:standalone), avec les
  // migrations drizzle/ (lues à l'exécution depuis le dossier du serveur). Sans la variable : sortie de `next start`
  // (npm start, démonstration, application Mac), inchangée.
  // Racine du projet fixée : un package-lock.json dans un dossier parent ne déplace pas le serveur dans le standalone.
  ...(standaloneBuild() ? {
    output: 'standalone' as const,
    outputFileTracingRoot: path.resolve('.'),
    turbopack: { root: path.resolve('.') },
    outputFileTracingIncludes: { '/*': ['./drizzle/**/*'] },
  } : {}),
  serverExternalPackages: ['@electric-sql/pglite'],
  experimental: {
    // Pièces jointes (photos, documents) jusqu'à 10 Mo, plus la marge multipart.
    serverActions: { bodySizeLimit: '11mb', allowedOrigins: serverActionOrigins() },
  },
  // En-têtes de sécurité fixes (SEC-05) ; CSP à nonce et HSTS : src/proxy.ts.
  async headers() {
    return [{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }];
  },
};

export default nextConfig;
