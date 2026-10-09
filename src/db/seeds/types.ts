import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type * as t from '../schema';

/** Transaction Drizzle passée aux fonctions de jeu de données. */
export type SeedTx = Parameters<Parameters<PgliteDatabase<typeof t>['transaction']>[0]>[0];
