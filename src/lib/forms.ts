// Lecture et validation des formulaires soumis aux server actions.

import { REASON_MAX } from './domain';

/**
 * État renvoyé par une server action de formulaire (utilisé avec useActionState). `ids` : enregistrements créés en plus de
 * `id` (actions de suite d'une vérification, ACT-23) ; `warnings` : avertissements qui n'empêchent pas l'enregistrement
 * (vérification planifiée avant la date cible…) ; `message` : confirmation annoncée après l'enregistrement (UX-14, sinon celle
 * du formulaire).
 */
export type FormState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; id?: string; ids?: string[]; warnings?: string[]; message?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Nombre décimal à la française pour les messages : « 9 999 999 999,99 » (espaces insécables). */
export function fmtDecimal(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.');
  return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}${dec ? `,${dec}` : ''}`;
}

/**
 * Règle commune du motif (QUA-22) : annulation, archivage, classement sans suite, réouverture, restauration, retrait,
 * levée — obligatoire (non vide après suppression des espaces), REASON_MAX caractères au plus. Lu par
 * `formReader(fd).reason()` dans les server actions de formulaire, par reasonError pour une server action appelée avec le
 * motif en argument (retrait d'une pièce jointe) ; saisi par ReasonButton / ReasonForm (src/components/ReasonDialog.tsx).
 * Imposé par src/server/reason-usage.test.ts.
 */
export function reasonError(value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return 'Motif obligatoire.';
  if (v.length > REASON_MAX) return `${REASON_MAX} caractères au maximum.`;
  return null;
}

/** Lecteur de FormData qui accumule les erreurs par champ. */
export function formReader(fd: FormData) {
  const fieldErrors: Record<string, string> = {};
  const raw = (name: string) => {
    const v = fd.get(name);
    return typeof v === 'string' ? v.trim() : '';
  };
  const fail = (name: string, msg: string) => { fieldErrors[name] ??= msg; };
  return {
    fieldErrors,
    /** Texte ; `required` produit une erreur si vide. */
    str(name: string, opts: { required?: boolean; max?: number } = {}) {
      const v = raw(name);
      if (opts.required && !v) fail(name, 'Champ obligatoire.');
      if (opts.max && v.length > opts.max) fail(name, `${opts.max} caractères au maximum.`);
      return v;
    },
    /** Texte ou null si vide. */
    opt(name: string) {
      return raw(name) || null;
    },
    int(name: string, opts: { required?: boolean; min?: number; max?: number } = {}) {
      const v = raw(name);
      if (!v) { if (opts.required) fail(name, 'Champ obligatoire.'); return null; }
      const n = Number(v.replace(',', '.'));
      if (!Number.isInteger(n)) { fail(name, 'Nombre entier attendu.'); return null; }
      if (opts.min != null && n < opts.min) fail(name, `Minimum ${opts.min}.`);
      if (opts.max != null && n > opts.max) fail(name, `Maximum ${opts.max}.`);
      return n;
    },
    num(name: string, opts: { required?: boolean; min?: number } = {}) {
      const v = raw(name);
      if (!v) { if (opts.required) fail(name, 'Champ obligatoire.'); return null; }
      const n = Number(v.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) { fail(name, 'Nombre attendu.'); return null; }
      if (opts.min != null && n < opts.min) fail(name, `Minimum ${opts.min}.`);
      return n;
    },
    /**
     * Nombre décimal (heures, montants en euros, ACT-26) : virgule ou point, espaces de milliers admis ; au plus `scale`
     * décimales (2 par défaut, « 2 décimales au maximum. ») ; bornes `min` / `max` incluses.
     */
    decimal(name: string, opts: { required?: boolean; min?: number; max?: number; scale?: number } = {}) {
      const v = raw(name).replace(/\s/g, '').replace(',', '.');
      if (!v) { if (opts.required) fail(name, 'Champ obligatoire.'); return null; }
      if (!DECIMAL.test(v)) { fail(name, 'Nombre attendu.'); return null; }
      const scale = opts.scale ?? 2;
      const decimals = v.includes('.') ? v.split('.')[1].length : 0;
      if (decimals > scale) {
        fail(name, scale === 0 ? 'Nombre entier attendu.' : `${scale} décimale${scale > 1 ? 's' : ''} au maximum.`);
        return null;
      }
      const n = Number(v);
      if (opts.min != null && n < opts.min) fail(name, `Minimum ${fmtDecimal(opts.min)}.`);
      if (opts.max != null && n > opts.max) fail(name, `Maximum ${fmtDecimal(opts.max)}.`);
      return n;
    },
    /** Date « AAAA-MM-JJ » (champ <input type="date">). */
    date(name: string, opts: { required?: boolean } = {}) {
      const v = raw(name);
      if (!v) { if (opts.required) fail(name, 'Date obligatoire.'); return null; }
      if (!ISO_DATE.test(v)) { fail(name, 'Date invalide.'); return null; }
      return v;
    },
    /** Champ présent dans le formulaire (un champ absent garde la valeur enregistrée : formulaire antérieur, autre écran). */
    has(name: string) {
      return fd.has(name);
    },
    bool(name: string) {
      const v = fd.get(name);
      return v === 'on' || v === 'true' || v === '1';
    },
    /** Valeur parmi une liste autorisée. */
    oneOf<T extends string>(name: string, allowed: readonly T[], opts: { required?: boolean } = {}): T | null {
      const v = raw(name);
      if (!v) { if (opts.required) fail(name, 'Choix obligatoire.'); return null; }
      if (!(allowed as readonly string[]).includes(v)) { fail(name, 'Valeur non autorisée.'); return null; }
      return v as T;
    },
    /** Motif obligatoire (annulation, archivage, classement sans suite…) : champ `reason` de ReasonButton / ReasonForm. */
    reason(name = 'reason') {
      const v = raw(name);
      const error = reasonError(v);
      if (error) fail(name, error);
      return v;
    },
    /** Valeurs multiples (cases à cocher de même nom), nettoyées et non vides. */
    list(name: string) {
      return fd.getAll(name).filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
    },
    files(name: string) {
      return fd.getAll(name).filter((f): f is File => typeof f !== 'string' && f.size > 0);
    },
    fail,
    get ok() { return Object.keys(fieldErrors).length === 0; },
    state(): FormState { return { error: 'Certains champs sont à corriger.', fieldErrors }; },
  };
}

/** Plus grand numéro des références « PRÉFIXE + n » de `existing` (0 sans aucune) ; une suite non numérique est ignorée. */
export function maxRefNumber(existing: string[], prefix: string) {
  return Math.max(0, ...existing.filter((id) => id.startsWith(prefix)).map((id) => {
    const rest = id.slice(prefix.length);
    return /^\d{1,9}$/.test(rest) ? Number(rest) : 0;
  }));
}

/**
 * Prochaine référence séquentielle « PRÉFIXE + n » (ex. EV-2026-133, PP-2026-015) d'après les références connues : aperçu
 * côté navigateur seulement (référence proposée d'un document). À l'enregistrement, la référence est tirée sous verrou dans
 * la transaction de création (nextEntityReference, src/server/references.ts, PRD-08).
 */
export function nextRef(existing: string[], prefix: string, pad = 0) {
  return `${prefix}${String(maxRefNumber(existing, prefix) + 1).padStart(pad, '0')}`;
}
