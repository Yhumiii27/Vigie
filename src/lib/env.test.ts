import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { ConfigError, entraMissing, isWithinDir, parseConfig, parseStorageConfig, secureCookies } from './env';

describe('parseConfig', () => {
  it('démonstration : PGlite, secret de QR code de repli, VIGIE_TODAY admis', () => {
    const c = parseConfig({ VIGIE_DEMO: '1', VIGIE_TODAY: '2026-10-09' });
    expect(c.demo).toBe(true);
    expect(c.today).toBe('2026-10-09');
    expect(c.databaseUrl).toBeNull();
    expect(c.reportSecret).toBeTruthy();
    expect(c.entra).toBeNull();
  });
  it('application Mac (VIGIE_DESKTOP=1) : démonstration, même sans VIGIE_DEMO', () => {
    expect(parseConfig({ VIGIE_DESKTOP: '1' }).demo).toBe(true);
    expect(() => parseConfig({ VIGIE_DESKTOP: '1', VIGIE_DEMO: '0' })).toThrow(/VIGIE_PUBLIC_URL/);
  });
  it('production : VIGIE_TODAY refusée, VIGIE_PUBLIC_URL obligatoire', () => {
    expect(() => parseConfig({ VIGIE_TODAY: '2026-10-09' })).toThrow(ConfigError);
    try {
      parseConfig({ VIGIE_TODAY: '2026-10-09' });
    } catch (e) {
      expect((e as ConfigError).problems.map((p) => p.split(' :')[0])).toEqual(['VIGIE_TODAY', 'VIGIE_PUBLIC_URL']);
    }
  });
  it('production complète : hôtes admis, Entra, groupes de sites', () => {
    const c = parseConfig({
      VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr/', VIGIE_ALLOWED_HOSTS: 'Vigie.interne:8443',
      DATABASE_URL: 'postgres://vigie@db/vigie', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's',
      VIGIE_SESSION_SECRET: 'x'.repeat(32), VIGIE_SITE_GROUPS: 'g1:ville-a, g2:ville-b', VIGIE_UPLOAD_KEY: 'ab'.repeat(32),
    });
    expect(c.publicUrl).toBe('https://vigie.exemple.fr');
    expect(c.allowedHosts).toEqual(['vigie.interne:8443', 'vigie.exemple.fr']);
    expect(c.entra?.issuer).toBe('https://login.microsoftonline.com/t/v2.0');
    expect(c.siteGroups).toEqual([{ groupId: 'g1', siteId: 'ville-a' }, { groupId: 'g2', siteId: 'ville-b' }]);
    expect(c.uploadKey?.length).toBe(32);
    expect(c.reportSecret).toBeNull();
    expect(entraMissing(c)).toEqual([]);
  });
  it('valeurs invalides : une ligne par variable', () => {
    expect(() => parseConfig({ VIGIE_DEMO: 'peut-être', VIGIE_UPLOAD_KEY: 'court', ENTRA_TENANT_ID: 't' })).toThrow(/VIGIE_DEMO[\s\S]*VIGIE_UPLOAD_KEY[\s\S]*ENTRA_TENANT_ID/);
  });

  it('ENTRA_ISSUER : https, ou http vers un fournisseur local seulement ; Entra incomplet listé par entraMissing', () => {
    const base = { VIGIE_PUBLIC_URL: 'http://localhost:3291', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's' };
    expect(parseConfig({ ...base, ENTRA_ISSUER: 'http://127.0.0.1:55480/t/v2.0/' }).entra?.issuer).toBe('http://127.0.0.1:55480/t/v2.0');
    expect(parseConfig({ ...base, ENTRA_ISSUER: 'https://login.microsoftonline.us/t/v2.0' }).entra?.issuer).toBe('https://login.microsoftonline.us/t/v2.0');
    expect(() => parseConfig({ ...base, ENTRA_ISSUER: 'http://idp.attaquant.example/t/v2.0' })).toThrow(/ENTRA_ISSUER/);
    expect(entraMissing(parseConfig(base))).toEqual(['VIGIE_SESSION_SECRET']);
    expect(entraMissing(parseConfig({ VIGIE_DEMO: '1' }))).toEqual(['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'VIGIE_SESSION_SECRET', 'VIGIE_PUBLIC_URL']);
  });

  it('secrets trop courts, adresse publique avec chemin, listes mal formées : refusés', () => {
    const problems = (env: Record<string, string>) => {
      try {
        parseConfig(env);
        return [];
      } catch (e) {
        return (e as ConfigError).problems.map((p) => p.split(' :')[0]);
      }
    };
    expect(problems({ VIGIE_DEMO: '1', VIGIE_SESSION_SECRET: 'court', VIGIE_REPORT_SECRET: 'court' })).toEqual(['VIGIE_SESSION_SECRET', 'VIGIE_REPORT_SECRET']);
    expect(problems({ VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr/vigie' })).toEqual(['VIGIE_PUBLIC_URL']);
    expect(problems({ VIGIE_DEMO: '1', VIGIE_ALLOWED_HOSTS: 'https://vigie.exemple.fr/' })).toEqual(['VIGIE_ALLOWED_HOSTS']);
    expect(problems({ VIGIE_DEMO: '1', VIGIE_SITE_GROUPS: 'groupe-sans-site' })).toEqual(['VIGIE_SITE_GROUPS']);
    expect(problems({ VIGIE_DEMO: '1', VIGIE_TODAY: '2026-02-30' })).toEqual(['VIGIE_TODAY']);
    expect(problems({ VIGIE_DEMO: '1', DATABASE_URL: 'mysql://db/vigie' })).toEqual(['DATABASE_URL']);
    expect(problems({ VIGIE_DEMO: '1', VIGIE_UPLOAD_KEY_PREVIOUS: 'ab'.repeat(32) })).toEqual(['VIGIE_UPLOAD_KEY_PREVIOUS']);
  });

  it('stockage : chemins absolus, base en mémoire, clé base64 ou hexadécimale ; scripts sans Entra ni adresse publique', () => {
    const key = Buffer.alloc(32, 7);
    const s = parseStorageConfig({ VIGIE_DATA_DIR: 'memory://', VIGIE_UPLOAD_DIR: 'donnees/pieces', VIGIE_UPLOAD_KEY: key.toString('base64'), VIGIE_BACKUP_BEFORE_MIGRATE: '0' });
    expect(s.dataDir).toBe('memory://');
    expect(s.uploadDir).toBe(path.resolve('donnees/pieces'));
    expect(path.isAbsolute(s.backupDir)).toBe(true);
    expect(s.uploadKey?.equals(key)).toBe(true);
    expect(s.backupBeforeMigrate).toBe(false);
    expect(parseStorageConfig({ VIGIE_UPLOAD_KEY: key.toString('hex') }).uploadKey?.equals(key)).toBe(true);
    expect(() => parseStorageConfig({ VIGIE_UPLOAD_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/VIGIE_UPLOAD_KEY/);
  });

  it('stockage : pièces jointes et sauvegardes hors de VIGIE_DATA_DIR (vidé par la restauration PGlite)', () => {
    const problems = (env: Record<string, string>) => {
      try {
        parseStorageConfig(env);
        return [];
      } catch (err) {
        return (err as ConfigError).problems.map((p) => p.split(' : ')[0]);
      }
    };
    expect(problems({ VIGIE_DATA_DIR: '/data', VIGIE_UPLOAD_DIR: '/data/uploads', VIGIE_BACKUP_DIR: '/data/backups' })).toEqual(['VIGIE_UPLOAD_DIR', 'VIGIE_BACKUP_DIR']);
    expect(problems({ VIGIE_DATA_DIR: '/data/pglite', VIGIE_UPLOAD_DIR: '/data/pglite', VIGIE_BACKUP_DIR: '/data/backups' })).toEqual(['VIGIE_UPLOAD_DIR']);
    expect(problems({ VIGIE_DATA_DIR: 'donnees', VIGIE_BACKUP_DIR: 'donnees/sauvegardes/../../donnees/s' })).toEqual(['VIGIE_BACKUP_DIR']);
    expect(() => parseConfig({ VIGIE_DEMO: '1', VIGIE_DATA_DIR: '/data', VIGIE_UPLOAD_DIR: '/data/uploads' })).toThrow(/VIGIE_UPLOAD_DIR : à placer hors de VIGIE_DATA_DIR \(\/data\)/);
    // Dossiers voisins (image Docker, défauts), parent commun, nom proche ou base en mémoire : admis.
    expect(problems({ VIGIE_DATA_DIR: '/data/pglite', VIGIE_UPLOAD_DIR: '/data/uploads', VIGIE_BACKUP_DIR: '/data/backups' })).toEqual([]);
    expect(problems({})).toEqual([]);
    expect(problems({ VIGIE_DATA_DIR: '/data/pglite', VIGIE_UPLOAD_DIR: '/data', VIGIE_BACKUP_DIR: '/data/pglite-sauvegardes' })).toEqual([]);
    expect(problems({ VIGIE_DATA_DIR: '/data/pg', VIGIE_UPLOAD_DIR: '/data/pg..pieces' })).toEqual([]);
    expect(problems({ VIGIE_DATA_DIR: 'memory://', VIGIE_UPLOAD_DIR: '/data/uploads' })).toEqual([]);
    expect(isWithinDir('/data', '/data')).toBe(true);
    expect(isWithinDir('/data', '/data/a/b')).toBe(true);
    expect(isWithinDir('/data/a', '/data')).toBe(false);
    expect(isWithinDir('/data', '/data2')).toBe(false);
  });

  it('VIGIE_PUBLIC_URL : https:// hors démonstration, http:// pour localhost seulement (SEC-05)', () => {
    expect(() => parseConfig({ VIGIE_PUBLIC_URL: 'http://vigie.interne' })).toThrow(/VIGIE_PUBLIC_URL : https:\/\/ obligatoire hors démonstration/);
    expect(parseConfig({ VIGIE_DEMO: '1', VIGIE_PUBLIC_URL: 'http://vigie.interne' }).publicUrl).toBe('http://vigie.interne');
    expect(parseConfig({ VIGIE_PUBLIC_URL: 'http://localhost:3291' }).publicUrl).toBe('http://localhost:3291');
    expect(parseConfig({ VIGIE_PUBLIC_URL: 'http://127.0.0.1' }).publicUrl).toBe('http://127.0.0.1');
    expect(parseConfig({ VIGIE_PUBLIC_URL: 'https://vigie.interne:8443' }).publicUrl).toBe('https://vigie.interne:8443');
  });

  it('VIGIE_EMAIL_DOMAINS : liste de domaines en minuscules, sans « @ » ni doublon ; vide par défaut', () => {
    expect(parseConfig({ VIGIE_DEMO: '1' }).emailDomains).toEqual([]);
    expect(parseConfig({ VIGIE_DEMO: '1', VIGIE_EMAIL_DOMAINS: '@EPC2I.fr, epc2i.com,epc2i.fr' }).emailDomains).toEqual(['epc2i.fr', 'epc2i.com']);
    for (const bad of ['a@b', 'https://x', 'epc2i', ',']) {
      expect(() => parseConfig({ VIGIE_DEMO: '1', VIGIE_EMAIL_DOMAINS: bad })).toThrow(/VIGIE_EMAIL_DOMAINS : liste de noms de domaine attendue/);
    }
    // Facultative pour la configuration Entra : sans elle, seules les premières connexions sont refusées.
    expect(entraMissing(parseConfig({ VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's', VIGIE_SESSION_SECRET: 'x'.repeat(32) }))).toEqual([]);
  });

  it('VIGIE_TRUSTED_PROXIES : entier de 1 à 10, 1 par défaut', () => {
    expect(parseConfig({ VIGIE_DEMO: '1' }).trustedProxies).toBe(1);
    expect(parseConfig({ VIGIE_DEMO: '1', VIGIE_TRUSTED_PROXIES: '2' }).trustedProxies).toBe(2);
    expect(() => parseConfig({ VIGIE_DEMO: '1', VIGIE_TRUSTED_PROXIES: '0' })).toThrow(/VIGIE_TRUSTED_PROXIES : entre 1 et 10/);
    expect(() => parseConfig({ VIGIE_DEMO: '1', VIGIE_TRUSTED_PROXIES: '11' })).toThrow(/VIGIE_TRUSTED_PROXIES : entre 1 et 10/);
    expect(() => parseConfig({ VIGIE_DEMO: '1', VIGIE_TRUSTED_PROXIES: 'deux' })).toThrow(/VIGIE_TRUSTED_PROXIES : nombre entier attendu \(1 par défaut\)$/m);
  });

  it('cookies Secure dès que l’adresse publique est en HTTPS', () => {
    expect(secureCookies(parseConfig({ VIGIE_DEMO: '1' }))).toBe(false);
    expect(secureCookies(parseConfig({ VIGIE_DEMO: '1', VIGIE_PUBLIC_URL: 'http://localhost:3200' }))).toBe(false);
    expect(secureCookies(parseConfig({ VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr' }))).toBe(true);
  });
});
