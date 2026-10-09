// Lecture et validation des formulaires soumis aux server actions.

import { REASON_MAX } from './domain';

/** État renvoyé par une server action de formulaire (utilisé avec useActionState). */
export type FormState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; id?: string };

export const initialFormState: FormState = {};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    /** Date « AAAA-MM-JJ » (champ <input type="date">). */
    date(name: string, opts: { required?: boolean } = {}) {
      const v = raw(name);
      if (!v) { if (opts.required) fail(name, 'Date obligatoire.'); return null; }
      if (!ISO_DATE.test(v)) { fail(name, 'Date invalide.'); return null; }
      return v;
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
      if (!v) fail(name, 'Motif obligatoire.');
      else if (v.length > REASON_MAX) fail(name, `${REASON_MAX} caractères au maximum.`);
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

/** Prochaine référence séquentielle « PRÉFIXE + n » (ex. A-216, EV-2026-133, PP-2026-015). */
export function nextRef(existing: string[], prefix: string, pad = 0) {
  const max = Math.max(0, ...existing.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length)) || 0));
  return `${prefix}${String(max + 1).padStart(pad, '0')}`;
}
