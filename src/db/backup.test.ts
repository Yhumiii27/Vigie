import { describe, expect, it } from 'vitest';
import { withoutNewerSettings } from './backup';

describe('withoutNewerSettings', () => {
  it('retire le réglage transaction_timeout écrit par pg_restore 17, inconnu d’un serveur 16', () => {
    const script = 'SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET idle_in_transaction_session_timeout = 0;\nSET transaction_timeout = 0;\nSET client_encoding = \'UTF8\';\n';
    expect(withoutNewerSettings(script)).toBe('SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET idle_in_transaction_session_timeout = 0;\nSET client_encoding = \'UTF8\';\n');
  });

  it('laisse intact un script de pg_restore 16 et le contenu des données', () => {
    const script = 'SET lock_timeout = 0;\nCOPY vigie.notes (id, body) FROM stdin;\n1\tSET transaction_timeout = 0;\n\\.\n';
    expect(withoutNewerSettings(script)).toBe(script);
  });
});
