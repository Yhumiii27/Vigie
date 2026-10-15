import 'server-only';
import { readConfig } from './env';

// Configuration du serveur (variables d'environnement validées par src/lib/env.ts), pour le code applicatif.
// proxy.ts, instrumentation.ts, les scripts et les tests importent src/lib/env.ts directement.

export { ConfigError, entraMissing, isLoopbackHost, secureCookies, type AnthropicEnv, type MailTransportKind, type VigieConfig } from './env';

/** Configuration validée du processus (mémorisée). */
export const config = readConfig;

/** Mode démonstration (VIGIE_DEMO=1). */
export const isDemo = () => readConfig().demo;
