import { describe, expect, it } from 'vitest';
import { acceptsServerFallback, aiStatus } from './ai';

describe('lecture des scans : état et options de l’appel (INT-13)', () => {
  it('désactivée sans VIGIE_AI_IMPORT, sinon prête avec une clé', () => {
    expect(aiStatus({ aiImport: false, anthropicEnv: { ANTHROPIC_API_KEY: 'x' } })).toBe('off');
    expect(aiStatus({ aiImport: true, anthropicEnv: { ANTHROPIC_API_KEY: 'x' } })).toBe('ready');
  });
  it('repli côté serveur pour les seuls modèles qui l’acceptent', () => {
    expect(acceptsServerFallback('claude-opus-5-5')).toBe(true);
    expect(acceptsServerFallback('claude-sonnet-5-5')).toBe(true);
    expect(acceptsServerFallback('claude-haiku-5-5')).toBe(false);
    expect(acceptsServerFallback('claude-opus-4-8')).toBe(false);
  });
});
