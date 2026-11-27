// Service worker du signalement terrain installable (EVT-20), portée /signaler (src/lib/pwa.ts).
// Ne met rien en cache : ni page, ni donnée authentifiée, ni réponse de server action. Il n'intercepte que les
// navigations (ouverture d'une page) : en ligne, la réponse du serveur passe telle quelle ; hors ligne, une page
// « Vous êtes hors ligne » construite ici, sans script. Les envois du formulaire (server actions, POST) ne passent pas
// par lui : le formulaire signale l'échec et garde sa saisie. File d'attente hors ligne : EVT-21 (à venir).

const OFFLINE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// Langue de la page hors ligne (VG-N01) : paramètre `lang` de l'adresse d'enregistrement (/signaler-sw.js?lang=en,
// src/components/ReportWorker.tsx, d'après le cookie vigie-lang) ; le français par défaut. Le service worker ne lit pas
// les cookies : la page change de langue au prochain enregistrement.
const LANG = new URL(self.location.href).searchParams.get('lang') === 'en' ? 'en' : 'fr';
const TEXTS = {
  fr: {
    title: 'Hors ligne · Vigie',
    heading: 'Vous êtes hors ligne',
    body: "Le formulaire de signalement ne peut pas s'ouvrir sans réseau. Vérifiez la connexion (Wi-Fi, données mobiles), puis réessayez.",
    urgent: "En cas d'urgence, prévenez immédiatement votre responsable ou l'animateur QHSE.",
    retry: 'Réessayer',
  },
  en: {
    title: 'Offline · Vigie',
    heading: 'You are offline',
    body: 'The reporting form cannot open without a network. Check the connection (Wi-Fi, mobile data), then try again.',
    urgent: 'In an emergency, alert your manager or the QHSE coordinator immediately.',
    retry: 'Try again',
  },
};

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function offlinePage(url) {
  const retry = escapeHtml(new URL(url).pathname + new URL(url).search);
  const tx = TEXTS[LANG];
  const body = `<!doctype html>
<html lang="${LANG}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#161826">
<title>${escapeHtml(tx.title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #161826; color: #e9e9ed;
    font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: max(24px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); }
  main { max-width: 420px; display: grid; gap: 14px; justify-items: center; text-align: center; }
  .icon { width: 64px; height: 64px; border-radius: 50%; border: 1px solid #9184d9; color: #9184d9; display: grid; place-items: center; font-size: 28px; }
  h1 { margin: 0; font-size: 20px; font-weight: 500; }
  p { margin: 0; color: #a9aab5; text-wrap: pretty; }
  a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 20px; border-radius: 8px;
    background: #9184d9; color: #161826; font-weight: 500; text-decoration: none; }
</style>
</head>
<body>
<main>
  <span class="icon" aria-hidden="true">!</span>
  <h1>${escapeHtml(tx.heading)}</h1>
  <p>${escapeHtml(tx.body)}</p>
  <p>${escapeHtml(tx.urgent)}</p>
  <a href="${retry}">${escapeHtml(tx.retry)}</a>
</main>
</body>
</html>`;
  return new Response(body, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': OFFLINE_CSP },
  });
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Navigations seulement (GET d'une page) ; tout le reste — scripts, images, server actions — va au réseau sans détour.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(req);
    } catch {
      return offlinePage(req.url);
    }
  })());
});
