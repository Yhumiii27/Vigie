'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm } from '@/components/form';
import {
  BUILT_IN_LAYOUT, CARD_PERIODS, CARD_SCOPES, CARD_SCOPE_KEYS, DASHBOARD_CARDS, MAX_CARDS, cardDefaults,
  type CardConfig, type CardId, type CardPeriod, type CardScope, type DashboardRole,
} from '@/lib/dashboard-cards';
import { resetDashboardLayout, saveDashboardLayout } from '@/server/dashboard-layouts';

// Éditeur du tableau de bord configurable (TDB-19) : choix des cartes dans le catalogue fermé, ordre par boutons « Monter » /
// « Descendre » (jamais par glisser-déposer seulement), période et périmètre de chaque carte ; disposition personnelle, ou
// disposition par défaut d'un rôle pour l'animateur QHSE. Contrôles et journal côté serveur (src/server/dashboard-layouts.ts).

type Target = 'personne' | DashboardRole;
const muted = { fontSize: 12, color: 'var(--vg-text-muted)' } as const;

function Editor({ initial, allowed, target, onDone }: { initial: readonly CardConfig[]; allowed: readonly CardId[]; target: Target; onDone: () => void }) {
  const [cards, setCards] = useState<CardConfig[]>([...initial]);
  const [adding, setAdding] = useState<CardId | ''>('');
  const free = allowed.filter((id) => !cards.some((c) => c.id === id));
  const move = (i: number, d: -1 | 1) => setCards((list) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const patch = (i: number, p: Partial<CardConfig>) => setCards((list) => list.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <ol aria-label="Cartes du tableau de bord, dans l’ordre d’affichage" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {cards.map((c, i) => {
          const def = DASHBOARD_CARDS[c.id];
          return (
            <li key={c.id} className="vg-inset" style={{ display: 'grid', gap: 6, padding: '8px 10px' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1, minWidth: 160 }}>{i + 1}. {def.label}</span>
                <button type="button" className="btn btn-ghost vg-btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter « ${def.label} »`}>
                  <i className="ph ph-arrow-up" aria-hidden />
                </button>
                <button type="button" className="btn btn-ghost vg-btn-sm" disabled={i === cards.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre « ${def.label} »`}>
                  <i className="ph ph-arrow-down" aria-hidden />
                </button>
                <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setCards((list) => list.filter((_, j) => j !== i))} aria-label={`Retirer « ${def.label} »`}>
                  <i className="ph ph-x" aria-hidden />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={muted}>{def.hint}</span>
                {def.periods && (
                  <select className="input" aria-label={`Période de « ${def.label} »`} value={c.period ?? 'annee'} style={{ fontSize: 12.5, padding: '4px 8px' }}
                    onChange={(e) => patch(i, { period: e.target.value as CardPeriod })}>
                    {def.periods.map((p) => <option key={p} value={p}>{CARD_PERIODS[p].label}</option>)}
                  </select>
                )}
                {def.scoped && (
                  <select className="input" aria-label={`Périmètre de « ${def.label} »`} value={c.scope ?? 'site'} style={{ fontSize: 12.5, padding: '4px 8px' }}
                    onChange={(e) => patch(i, { scope: e.target.value as CardScope })}>
                    {CARD_SCOPE_KEYS.map((s) => <option key={s} value={s}>{CARD_SCOPES[s]}</option>)}
                  </select>
                )}
              </div>
            </li>
          );
        })}
        {cards.length === 0 && <li style={muted}>Aucune carte : ajoutez-en depuis le catalogue.</li>}
      </ol>
      {free.length > 0 && cards.length < MAX_CARDS && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label htmlFor="vg-card-add" style={muted}>Ajouter une carte</label>
          <select id="vg-card-add" className="input" value={adding} onChange={(e) => setAdding(e.target.value as CardId | '')} style={{ fontSize: 12.5, padding: '4px 8px', flex: 1, minWidth: 180 }}>
            <option value="">Choisir…</option>
            {free.map((id) => <option key={id} value={id}>{DASHBOARD_CARDS[id].label}</option>)}
          </select>
          <button type="button" className="btn btn-secondary vg-btn-sm" disabled={!adding} onClick={() => { if (adding) { setCards((l) => [...l, cardDefaults(adding)]); setAdding(''); } }}>
            Ajouter
          </button>
        </div>
      )}
      <ActionForm action={saveDashboardLayout} hidden={{ target, cards: JSON.stringify(cards) }} onDone={onDone} onCancel={onDone} submitLabel="Enregistrer la disposition">
        <span style={muted}>Les indicateurs sont recalculés à chaque affichage ; seule la disposition est enregistrée.</span>
      </ActionForm>
      <ActionForm action={resetDashboardLayout} hidden={{ target }} onDone={onDone} submitLabel="Revenir à la disposition par défaut" submitIcon="ph-arrow-counter-clockwise">
        <span style={muted}>{target === 'personne' ? 'Votre disposition est retirée : celle de votre rôle (ou de Vigie) s’applique.' : 'La disposition par défaut du rôle est retirée : celle de Vigie s’applique.'}</span>
      </ActionForm>
    </div>
  );
}

export function DashboardCustomizer({ layout, allowed, roleLayouts }: {
  layout: readonly CardConfig[];
  allowed: readonly CardId[];
  /** Animateur QHSE : dispositions par défaut des rôles (null : celle de Vigie). */
  roleLayouts: Record<DashboardRole, CardConfig[] | null> | null;
}) {
  const [target, setTarget] = useState<Target>('personne');
  const initial = target === 'personne' ? layout : roleLayouts?.[target] ?? BUILT_IN_LAYOUT;
  return (
    <DialogButton label="Personnaliser" icon="ph-sliders-horizontal" className="btn btn-secondary vg-btn-sm" title="Personnaliser le tableau de bord" kicker="Cartes, ordre, période et périmètre" width={640}>
      {(close) => (
        <div style={{ display: 'grid', gap: 10 }}>
          {roleLayouts && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="vg-layout-target" style={muted}>Disposition</label>
              <select id="vg-layout-target" className="input" value={target} onChange={(e) => setTarget(e.target.value as Target)} style={{ fontSize: 12.5, padding: '4px 8px' }}>
                <option value="personne">Mon tableau de bord</option>
                {Object.keys(roleLayouts).map((r) => <option key={r} value={r}>Par défaut du rôle : {r}</option>)}
              </select>
            </div>
          )}
          <Editor key={target} initial={initial} allowed={allowed} target={target} onDone={close} />
        </div>
      )}
    </DialogButton>
  );
}
