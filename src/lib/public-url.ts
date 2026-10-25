import 'server-only';
import { headers } from 'next/headers';
import { config } from './config';

// Adresse publique de Vigie (PRD-07) : QR codes imprimés, liens à ouvrir hors de l'application.

/**
 * Origine publique (https://vigie.exemple.fr) : VIGIE_PUBLIC_URL, jamais l'en-tête Host. Variable obligatoire hors
 * démonstration ; en démonstration sans elle, repli sur l'origine de la requête (application Mac ouverte au réseau local :
 * le téléphone qui scanne doit joindre la même adresse), dont l'hôte est contrôlé par src/proxy.ts.
 */
export async function publicOrigin(): Promise<string> {
  const c = config();
  if (c.publicUrl) return c.publicUrl;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3200';
  return `${h.get('x-forwarded-proto') ?? 'http'}://${host}`;
}
