import { vi } from 'vitest';

// Remplacements de next/headers, next/cache et next/navigation pour appeler loaders et server actions hors de Next.js.
// À importer en tête d'un fichier de test, avant tout module applicatif :
//   import { cookieJar } from '../next-mocks';
// `redirect()` et `notFound()` lèvent une erreur « NEXT_REDIRECT:<url> » / « NEXT_NOT_FOUND » (comme Next.js).

/** Cookies de la requête simulée (rôle de démonstration, site sélectionné…). */
export const cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
    has: (name: string) => cookieJar.has(name),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers({ host: 'localhost:3200' }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

/** FormData à partir d'un objet (champs texte). */
export function form(fields: Record<string, string>) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  return fd;
}
