import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// QUA-27 : AGENTS.md (racine) renvoie à CLAUDE.md sans le recopier et porte le bloc géré par `next dev` (agentRules) dans
// sa version courante : `next dev` ne réécrit donc pas le fichier (arbre de travail propre). Une montée de version de Next
// qui change le bloc fait échouer ce test : recopier le bloc (lancer `npm run dev` une fois suffit).

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const agentFiles = require('next/dist/server/lib/generate-agent-files.js') as { hasCurrentAgentRules: (dir: string) => boolean };
const text = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

describe('AGENTS.md (QUA-27)', () => {
  it('porte le bloc agentRules de la version installée de Next', () => {
    expect(agentFiles.hasCurrentAgentRules(ROOT)).toBe(true);
  });

  it('renvoie à CLAUDE.md, reste concis et ne le duplique pas', () => {
    expect(text).toContain('CLAUDE.md');
    const own = text.slice(0, text.indexOf('<!-- BEGIN:nextjs-agent-rules -->'));
    expect(own.split('\n').length).toBeLessThan(25);
    const claude = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
    const bullets = claude.split('\n').filter((l) => l.startsWith('- ') && l.length > 120);
    expect(bullets.filter((b) => own.includes(b))).toEqual([]);
  });
});
