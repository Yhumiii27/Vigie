// Transport des e-mails de Vigie (rappel du mercredi, ACT-33). Module sans 'server-only' : utilisé par la tâche planifiée
// (src/lib/action-reminder-job.ts, src/db/index.ts), les scripts et les tests.
//
// - « fichier » : chaque message est écrit en JSON dans VIGIE_MAIL_DIR (`<id>.json`), sans aucun envoi réel — démonstration,
//   recette et tests (docs/specs/actions-qse.md § 15.2) ;
// - « aucun » : pas de transport (createTransport → null), défaut hors démonstration : aucune tâche d'e-mail n'est inscrite.
// L'envoi réel (relais SMTP de la messagerie ou Microsoft Graph `Mail.Send`) viendra avec le compte d'envoi (ACT-34) : un
// nouveau `kind`, choisi par VIGIE_MAIL_TRANSPORT (src/lib/env.ts).

import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { VigieConfig } from '../env';

/** Message prêt à l'envoi : texte brut et HTML (déjà échappé), expéditeur VIGIE_MAIL_FROM. */
export type MailMessage = { id: string; to: string; from: string; subject: string; text: string; html: string };

export interface MailTransport {
  kind: 'fichier';
  /** Envoie (ou écrit) le message ; lève une erreur en cas d'échec (journal d'envoi « echec », nouvel essai). */
  send(m: MailMessage): Promise<void>;
}

/** Nom de fichier sûr tiré de l'identifiant du message (jamais de séparateur de chemin ni de fichier caché). */
export const mailFileName = (id: string) => `${id.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\./, '_') || 'message'}.json`;

/**
 * Transport « fichier » : `<dir>/<id>.json` = le message et sa date d'écriture (`writtenAt`), dossier créé au besoin,
 * écriture atomique (fichier temporaire puis renommage : jamais de message à moitié écrit), lisible du seul propriétaire.
 * Un même identifiant remplace le fichier précédent.
 */
export function fileTransport(dir: string): MailTransport {
  return {
    kind: 'fichier',
    async send(m) {
      await mkdir(dir, { recursive: true });
      const file = path.join(/*turbopackIgnore: true*/ dir, mailFileName(m.id));
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ ...m, writtenAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}

/** Transport de la configuration ; null pour « aucun » (aucun e-mail, aucune tâche d'envoi inscrite). */
export function createTransport(cfg: Pick<VigieConfig, 'mailTransport' | 'mailDir'>): MailTransport | null {
  return cfg.mailTransport === 'fichier' ? fileTransport(cfg.mailDir) : null;
}
