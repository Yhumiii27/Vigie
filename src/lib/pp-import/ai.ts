// État de la lecture des scans par l'API Claude, côté serveur (module node pur, sans 'server-only' : testable avec node).
// La lecture n'est possible qu'avec une activation explicite (VIGIE_AI_IMPORT=1, le document étant transmis à Anthropic)
// et des identifiants que le SDK Anthropic sait trouver : clé ou jeton d'API, profil `ant auth login`, fédération d'identité.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStatus } from './types';

type Env = Record<string, string | undefined>;

/** Dossier de configuration du SDK Anthropic (profils et identifiants enregistrés par `ant auth login`). */
function configDir(env: Env): string | null {
  if (env.ANTHROPIC_CONFIG_DIR) return env.ANTHROPIC_CONFIG_DIR;
  if (process.platform === 'win32') return env.APPDATA ? join(env.APPDATA, 'Anthropic') : null;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'anthropic');
  return env.HOME ? join(env.HOME, '.config', 'anthropic') : null;
}

/** Identifiants d'API Anthropic présents sur le serveur (mêmes sources que le SDK, sans les lire). */
export function hasAnthropicCredentials(env: Env = process.env): boolean {
  if (env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim()) return true;
  if (env.ANTHROPIC_FEDERATION_RULE_ID && (env.ANTHROPIC_IDENTITY_TOKEN_FILE || env.ANTHROPIC_IDENTITY_TOKEN)) return true;
  // Profils (ANTHROPIC_PROFILE ou profil actif) : fichiers du dossier de configuration.
  const dir = configDir(env);
  try {
    return !!dir && (existsSync(join(dir, 'credentials')) || existsSync(join(dir, 'configs')));
  } catch {
    return false;
  }
}

/** Lecture des scans : désactivée, prête, ou activée sans identifiants. */
export function aiStatus(env: Env = process.env): AiStatus {
  if (env.VIGIE_AI_IMPORT !== '1') return 'off';
  return hasAnthropicCredentials(env) ? 'ready' : 'no_credentials';
}
