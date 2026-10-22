'use client';

import { useEffect } from 'react';
import { REPORT_SW_PATH, REPORT_SW_SCOPE } from '@/lib/pwa';

/**
 * Enregistre le service worker du signalement installable (EVT-20), portée /signaler : page « hors ligne » quand le réseau
 * manque, aucune mise en cache (public/signaler-sw.js). Contexte sécurisé exigé par le navigateur (HTTPS, ou localhost) ;
 * ailleurs, ou en cas d'échec, rien ne change : le formulaire fonctionne sans lui.
 */
export function ReportWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register(REPORT_SW_PATH, { scope: REPORT_SW_SCOPE, updateViaCache: 'none' }).catch(() => {});
  }, []);
  return null;
}
