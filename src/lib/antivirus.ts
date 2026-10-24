// Analyse antivirus des pièces jointes par un service clamd (SEC-08), avant leur enregistrement : VIGIE_CLAMAV=hôte:port ou
// unix:/chemin/clamd.sock (src/lib/env.ts). Sans elle, aucune analyse. Service injoignable ou en erreur : le fichier est
// refusé (fermé par défaut), comme dans Keystone (R-175).
//
// Protocole clamd « zINSTREAM » : la commande terminée par un octet nul, puis le contenu par morceaux précédés de leur taille
// (4 octets, gros-boutiste), puis une taille nulle ; réponse « stream: OK », « stream: <signature> FOUND » ou « … ERROR ».
// Module sans 'server-only' (testé contre un faux clamd, src/lib/antivirus.test.ts).

import { connect } from 'node:net';

export type ClamavAddress = { host: string; port: number } | { socket: string };
export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'error'; reason: string };

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 30_000;

/** Réponse de clamd → résultat (pure). */
export function parseClamdReply(reply: string): ScanResult {
  const r = reply.replace(/\0/g, '').trim();
  if (/:\s*OK$/.test(r)) return { status: 'clean' };
  const found = /:\s*(.+)\s+FOUND$/.exec(r);
  if (found) return { status: 'infected', signature: found[1].trim() };
  return { status: 'error', reason: r.slice(0, 200) || 'réponse vide' };
}

/** Analyse un contenu ; ne lève jamais (erreur de connexion → status « error »). */
export function scanWithClamd(address: ClamavAddress, data: Uint8Array, timeoutMs = TIMEOUT_MS): Promise<ScanResult> {
  return new Promise((resolve) => {
    let reply = '';
    let settled = false;
    const finish = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    const socket = 'socket' in address ? connect(address.socket) : connect(address.port, address.host);
    socket.setTimeout(timeoutMs, () => finish({ status: 'error', reason: `pas de réponse en ${timeoutMs / 1000} s` }));
    socket.on('error', (err) => finish({ status: 'error', reason: err.message }));
    socket.on('data', (d) => { reply += d.toString('utf8'); if (reply.includes('\0') || reply.includes('\n')) finish(parseClamdReply(reply)); });
    socket.on('end', () => finish(parseClamdReply(reply)));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
