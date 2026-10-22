import { describe, expect, it } from 'vitest';
import { REPORT_SW_PATH, isPwaAsset } from './pwa';

// EVT-20 : seules les ressources statiques du signalement installable sont ouvertes sans session (src/proxy.ts).
describe('ressources publiques du signalement installable', () => {
  it('manifeste, service worker et icônes', () => {
    expect(isPwaAsset('/manifest.webmanifest')).toBe(true);
    expect(isPwaAsset(REPORT_SW_PATH)).toBe(true);
    expect(isPwaAsset('/pwa/icon-192.png')).toBe(true);
    expect(isPwaAsset('/pwa/icon.svg')).toBe(true);
  });
  it('rien d’autre : pages, plans du site, chemins détournés', () => {
    for (const p of ['/signaler', '/signaler/mes-signalements', '/plans/ville-a.svg', '/pwa/', '/pwa/../fichiers/x', '/pwa/icon.png/../../evenements', '/pwa/a/b.png', '/manifest.webmanifest/x', '/sw.js']) {
      expect(isPwaAsset(p)).toBe(false);
    }
  });
});
