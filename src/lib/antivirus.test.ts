import { createServer, type Server } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { parseClamdReply, scanWithClamd } from './antivirus';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Faux clamd : lit zINSTREAM et ses morceaux, répond FOUND si le contenu porte la chaîne EICAR. */
function fakeClamd(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const head = buf.indexOf(0);
        if (head < 0 || buf.subarray(0, head).toString() !== 'zINSTREAM') return;
        let i = head + 1;
        const parts: Buffer[] = [];
        while (i + 4 <= buf.length) {
          const n = buf.readUInt32BE(i);
          if (n === 0) {
            const content = Buffer.concat(parts).toString('latin1');
            socket.end(content.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
            return;
          }
          if (i + 4 + n > buf.length) return;
          parts.push(buf.subarray(i + 4, i + 4 + n));
          i += 4 + n;
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('antivirus clamd (SEC-08)', () => {
  let srv: { server: Server; port: number };
  afterAll(() => srv?.server.close());

  it('réponses de clamd', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'clean' });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR')).toMatchObject({ status: 'error' });
  });

  it('protocole zINSTREAM : propre, menace (EICAR), gros fichier en plusieurs morceaux, service injoignable', async () => {
    srv = await fakeClamd();
    const addr = { host: '127.0.0.1', port: srv.port };
    expect(await scanWithClamd(addr, Buffer.from('%PDF-1.4 propre'))).toEqual({ status: 'clean' });
    expect(await scanWithClamd(addr, Buffer.from(EICAR))).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
    expect(await scanWithClamd(addr, Buffer.alloc(300_000, 65))).toEqual({ status: 'clean' });
    const down = await scanWithClamd({ host: '127.0.0.1', port: 1 }, Buffer.from('x'), 2000);
    expect(down.status).toBe('error');
  });
});
