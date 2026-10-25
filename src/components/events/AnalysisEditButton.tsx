'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Select, TextArea } from '@/components/form';
import { D8_STEPS, METHODS, type AnalysisMethod } from '@/lib/domain';
import { saveAnalysis } from '@/server/events';
import {
  FIVE_M, FIVE_M_HINTS, MAX_TREE_LEVEL, MAX_TREE_LINES, MAX_WHYS,
  normalizeTree, readD8, readFiveM, readTree, readWhys, type TreeLine,
} from './shared';

const WIDTH: Record<AnalysisMethod, number> = { '5m': 640, tree: 680, why: 600, '8d': 680 };

/** « Modifier l'analyse » : saisie du contenu de la méthode d'analyse courante. */
export function AnalysisEditButton({ eventId, method, content }: { eventId: string; method: AnalysisMethod; content: unknown }) {
  const label = METHODS.find(([k]) => k === method)?.[1] ?? method;
  return (
    <DialogButton label="Modifier l'analyse" icon="ph-pencil-simple" className="btn btn-ghost vg-btn-sm"
      title={`Analyse des causes · ${label}`} kicker={eventId} width={WIDTH[method]}>
      {(close) => (
        <ActionForm action={saveAnalysis} hidden={{ eventId, method }} onDone={close} onCancel={close}>
          {method === '5m' && <FiveMFields content={content} />}
          {method === 'tree' && <TreeFields content={content} />}
          {method === 'why' && <WhyFields content={content} />}
          {method === '8d' && <D8Fields content={content} />}
        </ActionForm>
      )}
    </DialogButton>
  );
}

function IconBtn({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-ghost btn-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      style={{ width: 26, height: 26, flex: 'none', color: 'var(--color-neutral-400)' }}>
      <i className={`ph ${icon}`} style={{ fontSize: 14 }} aria-hidden />
    </button>
  );
}

const Hint = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>{children}</p>
);

// ─── 5M ─────────────────────────────────────────────────────────────────────

function FiveMFields({ content }: { content: unknown }) {
  const values = readFiveM(content);
  return (
    <>
      <Hint>Une cause par famille (laisser vide si la famille n&apos;est pas en cause).</Hint>
      <FormRow>
        {FIVE_M.map((cat, i) => (
          <Field key={cat} name={`m${i}`} label={cat} hint={FIVE_M_HINTS[i]} wide={i === FIVE_M.length - 1}>
            <TextArea name={`m${i}`} defaultValue={values.get(cat) ?? ''} rows={2} maxLength={1000} style={{ minHeight: 56 }} />
          </Field>
        ))}
      </FormRow>
    </>
  );
}

// ─── Arbre des causes ───────────────────────────────────────────────────────

type Line = { key: number; level: number; text: string; main: boolean };

function TreeFields({ content }: { content: unknown }) {
  const [lines, setLines] = useState<Line[]>(() => {
    const init = readTree(content);
    const base: TreeLine[] = init.length ? init : [[0, '', true]];
    return normalizeTree(base.map(([level, text, main], key) => ({ key, level, text, main })));
  });
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const seq = useRef(1000);

  const update = (next: Line[]) => setLines(normalizeTree(next.length ? next : [{ key: seq.current++, level: 0, text: '', main: true }]));
  const patch = (i: number, p: Partial<Line>) => update(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...lines];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    update(next);
  };
  const insertAfter = (i: number) => {
    if (lines.length >= MAX_TREE_LINES) return;
    const key = seq.current++;
    const level = i < 0 ? 0 : lines[i].level;
    update([...lines.slice(0, i + 1), { key, level, text: '', main: false }, ...lines.slice(i + 1)]);
    setFocusKey(key);
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); insertAfter(i); }
  };

  return (
    <>
      <Hint>Partez du fait ultime (premier niveau) puis remontez vers ses antécédents en indentant. Le point plein marque un fait principal ; Entrée ajoute une ligne.</Hint>
      <div className="vg-inset" style={{ display: 'grid', gap: 4, padding: 10 }}>
        {lines.map((l, i) => {
          const maxLevel = i === 0 ? 0 : Math.min(MAX_TREE_LEVEL, lines[i - 1].level + 1);
          return (
            <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: l.level * 18 }}>
              <button type="button" aria-pressed={l.main} onClick={() => patch(i, { main: !l.main })}
                aria-label={l.main ? 'Retirer le marquage « fait principal »' : 'Marquer comme fait principal'} title={l.main ? 'Fait principal' : 'Marquer comme fait principal'}
                style={{ width: 22, height: 22, flex: 'none', display: 'grid', placeItems: 'center', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1px solid var(--color-accent)', background: l.main ? 'var(--color-accent)' : 'transparent' }} />
              </button>
              <input type="hidden" name="tree_level" value={l.level} />
              <input type="hidden" name="tree_main" value={l.main ? '1' : '0'} />
              <input className="input" name="tree_text" value={l.text} maxLength={300} autoFocus={l.key === focusKey}
                aria-label={`Ligne ${i + 1}, niveau ${l.level + 1}`}
                placeholder={i === 0 ? 'Fait ultime (ex. Charge basculée à 1,5 m du monteur)' : 'Fait antécédent'}
                onChange={(e) => patch(i, { text: e.target.value })} onKeyDown={onKey(i)}
                style={{ flex: 1, minWidth: 0, minHeight: 30, padding: '4px 8px', fontSize: 12.5 }} />
              <IconBtn icon="ph-text-outdent" label="Remonter d'un niveau" disabled={l.level === 0} onClick={() => patch(i, { level: l.level - 1 })} />
              <IconBtn icon="ph-text-indent" label="Descendre d'un niveau" disabled={l.level >= maxLevel} onClick={() => patch(i, { level: l.level + 1 })} />
              <IconBtn icon="ph-arrow-up" label="Monter la ligne" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconBtn icon="ph-arrow-down" label="Descendre la ligne" disabled={i === lines.length - 1} onClick={() => move(i, 1)} />
              <IconBtn icon="ph-trash" label="Supprimer la ligne" onClick={() => update(lines.filter((_, j) => j !== i))} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="vg-text-btn" disabled={lines.length >= MAX_TREE_LINES} onClick={() => insertAfter(lines.length - 1)}>
          <i className="ph ph-plus" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />Ajouter une ligne
        </button>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{lines.length}/{MAX_TREE_LINES} lignes · {MAX_TREE_LEVEL + 1} niveaux au plus</span>
      </div>
    </>
  );
}

// ─── 5 pourquoi ─────────────────────────────────────────────────────────────

function WhyFields({ content }: { content: unknown }) {
  const [lines, setLines] = useState<{ key: number; text: string }[]>(() => {
    const init = readWhys(content);
    return (init.length ? init : Array<string>(5).fill('')).map((text, key) => ({ key, text }));
  });
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const seq = useRef(1000);
  const add = (at: number) => {
    if (lines.length >= MAX_WHYS) return;
    const key = seq.current++;
    setLines([...lines.slice(0, at), { key, text: '' }, ...lines.slice(at)]);
    setFocusKey(key);
  };

  return (
    <>
      <Hint>Chaque ligne répond au « pourquoi » de la précédente, jusqu&apos;à la cause racine ({MAX_WHYS} lignes au plus). Les lignes vides sont ignorées.</Hint>
      <div style={{ display: 'grid', gap: 6 }}>
        {lines.map((l, i) => (
          <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 26px', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>{i + 1}.</span>
            <input className="input" name="why" value={l.text} maxLength={300} autoFocus={l.key === focusKey}
              aria-label={`Pourquoi n° ${i + 1}`}
              placeholder={i === 0 ? 'Pourquoi … ? — Parce que …' : 'Pourquoi ? — Parce que …'}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(i + 1); } }}
              style={{ minHeight: 32, padding: '5px 8px', fontSize: 12.5 }} />
            <IconBtn icon="ph-trash" label="Supprimer la ligne" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="vg-text-btn" disabled={lines.length >= MAX_WHYS} onClick={() => add(lines.length)}>
          <i className="ph ph-plus" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />Ajouter un pourquoi
        </button>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{lines.length}/{MAX_WHYS}</span>
      </div>
    </>
  );
}

// ─── 8D ─────────────────────────────────────────────────────────────────────

const D8_CURRENT = [...D8_STEPS.map((s, i) => [String(i), `${s} — en cours`] as const), [String(D8_STEPS.length), 'Démarche terminée (D1 à D8)'] as const];

function D8Fields({ content }: { content: unknown }) {
  const init = readD8(content);
  const [current, setCurrent] = useState(init.current);
  return (
    <>
      <Field name="current" label="Discipline en cours" hint="Les disciplines précédentes sont considérées comme terminées.">
        <Select name="current" options={D8_CURRENT} value={String(current)} onChange={(e) => setCurrent(Number(e.target.value))} />
      </Field>
      <FormRow>
        {D8_STEPS.map((s, i) => {
          const state = i < current ? 'ph-check-circle' : i === current ? 'ph-circle-half' : 'ph-circle';
          return (
            <Field key={s} htmlFor={`note-${i}`} label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: i === current ? 'var(--color-accent)' : undefined }}>
                <i className={`ph ${state}`} style={{ fontSize: 12 }} aria-hidden />{s}
              </span>
            }>
              <TextArea name="note" id={`note-${i}`} aria-label={s} defaultValue={init.notes[i] ?? ''} rows={2} maxLength={1000} placeholder="Note facultative" style={{ minHeight: 56 }} />
            </Field>
          );
        })}
      </FormRow>
    </>
  );
}
