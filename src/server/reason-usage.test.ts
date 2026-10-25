import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// QUA-22 : motif unifié. Balayage du code :
// - toute server action d'annulation, d'archivage, de classement sans suite, de réouverture, de restauration, de retrait,
//   de levée, de report ou de retour arrière lit son motif par formReader(fd).reason() (FormData), ou le contrôle par
//   reasonError (motif reçu en argument) — mêmes longueurs, même message ; jamais une lecture du champ `reason` à la main
//   ni une règle de longueur locale ;
// - le champ `reason` n'est saisi que par ReasonButton / ReasonForm (src/components/ReasonDialog.tsx).
// Exceptions sans motif, justifiées ci-dessous (toute nouvelle exception doit y être ajoutée et justifiée).

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const list = (dir: string, ext: RegExp): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = path.join(dir, e.name);
  if (e.isDirectory()) return list(rel, ext);
  return ext.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
});

/** Server actions à motif, d'après leur nom. */
const MOTIF_NAME = /^(cancel|archive|reopen|restore|reinstate|withdraw|release|dismiss|abandon|suspend|remove|revert|reschedule)[A-Z]|^setPersonLeft$/;

/** Server actions de ce type sans motif, avec la raison. */
const WITHOUT_MOTIF: Record<string, string> = {
  removeCertificationFile: 'retrait d’un fichier de certificat, journalisé (detach) — motif à décider (QUA-22, choix à valider)',
  removePlanItemReport: 'retrait d’un rapport d’audit, journalisé (detach) — motif à décider (QUA-22, choix à valider)',
  removeEventFile: 'retrait d’une pièce d’un événement non clos, journalisé (detach) — motif à décider (QUA-22, choix à valider)',
  removeActionFile: 'retrait d’une preuve avant « Vérifiée » (canRemoveProof, § 8 de la spécification des actions) : sans motif',
  removePlanAttachment: 'retrait d’une pièce d’un plan modifiable, journalisé (detach) — motif à décider (QUA-22, choix à valider)',
  removeQualificationFile: 'retrait d’une attestation ajoutée par erreur, journalisé (detach) — motif à décider (QUA-22, choix à valider)',
  removeProgramAction: 'retrait d’une ligne du programme de prévention en préparation (avant son arrêt), journalisé',
};

type ServerAction = { file: string; name: string; params: string; body: string };

function serverActions(): ServerAction[] {
  return list('src/server', /\.ts$/).filter((f) => /^'use server';/.test(read(f))).flatMap((file) => {
    const src = read(file);
    const parts = src.split(/\nexport async function /).slice(1);
    return parts.map((part) => {
      const m = /^(\w+)\(([^)]*)\)/.exec(part);
      return { file, name: m?.[1] ?? '?', params: m?.[2] ?? '', body: part };
    });
  });
}

describe('motif unifié (QUA-22)', () => {
  const actions = serverActions();

  it('les server actions à motif le lisent par formReader(fd).reason() ou reasonError', () => {
    const motif = actions.filter((a) => MOTIF_NAME.test(a.name));
    expect(motif.length).toBeGreaterThan(40);
    const problems = motif.filter((a) => !Object.hasOwn(WITHOUT_MOTIF, a.name)).flatMap((a) => {
      // Lecture directe, ou par une aide commune du fichier qui appelle formReader(fd).reason() (healthEvent, benignEntry).
      if (/FormData/.test(a.params)) return /\.reason\(|\{ reason: true \}/.test(a.body) ? [] : [`${a.file} ${a.name} : motif non lu par formReader(fd).reason()`];
      if (/\breason\b/.test(a.params)) return /reasonError\(/.test(a.body) ? [] : [`${a.file} ${a.name} : motif non contrôlé par reasonError`];
      return [`${a.file} ${a.name} : sans motif (ajouter le motif, ou une exception justifiée)`];
    });
    expect(problems).toEqual([]);
  });

  it('exceptions à jour : chacune existe et ne lit aucun motif', () => {
    for (const name of Object.keys(WITHOUT_MOTIF)) {
      const a = actions.find((x) => x.name === name);
      expect(a, name).toBeDefined();
      expect(/\.reason\(|reasonError\(/.test(a!.body), name).toBe(false);
    }
  });

  it('aucune lecture du motif à la main, aucune règle de longueur locale', () => {
    const files = [...list('src/server', /\.ts$/), ...list('src/lib', /\.ts$/)].filter((f) => f !== path.join('src', 'lib', 'forms.ts'));
    const problems = files.flatMap((file) => read(file).split('\n').flatMap((line, i) => {
      const at = `${file}:${i + 1}`;
      const hits: string[] = [];
      if (/(?:\.str|\.opt|\.get)\(\s*'reason'/.test(line)) hits.push(`${at} : champ « reason » lu sans formReader(fd).reason()`);
      if (/\breason\.length\b/.test(line)) hits.push(`${at} : règle de longueur locale du motif`);
      if (/'Motif obligatoire\.'/.test(line)) hits.push(`${at} : message du motif recopié (reasonError)`);
      return hits;
    }));
    expect(problems).toEqual([]);
  });

  it('le champ « reason » n’est saisi que par ReasonButton / ReasonForm', () => {
    // Exception : motif facultatif d'une modification de date dans le formulaire complet du plan de prévention (savePlan).
    const allowed = new Set([path.join('src', 'components', 'ReasonDialog.tsx'), path.join('src', 'components', 'prevention', 'PlanDialogs.tsx')]);
    const files = [...list('src/components', /\.tsx$/), ...list('src/app', /\.tsx$/)];
    const problems = files.filter((f) => !allowed.has(f) && /name="reason"/.test(read(f)));
    expect(problems).toEqual([]);
  });
});
