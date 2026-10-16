import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests unitaires et d'intégration (npm test). Alias « @/… » repris de tsconfig.json ; « server-only » neutralisé.
// Intégration sur PGlite en mémoire ; sur PostgreSQL avec TEST_DATABASE_URL (une base neuve par fichier, test/setup-postgres.ts).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup-postgres.ts'],
    // Aucune tâche planifiée à l'ouverture des bases de test (PRD-12) : scheduler.test.ts la réactive pour son propre cas.
    env: { VIGIE_SCHEDULER: '0' },
    // Ouverture d'une base PGlite (migrations, jeu de démonstration) : plusieurs secondes.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
