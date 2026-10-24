'use client';

import { useState } from 'react';
import { Dot, Icon } from '@/components/ui';
import type { KanbanKey } from '@/lib/action-rules';
import type { ActionListItem } from '@/lib/action-view';
import { TONE, type Tone } from '@/lib/domain';
import { ActionLink } from './ActionPlanProvider';

const MAX_CARDS = 8;

/** `label` : libellé de la colonne (« Vérifiées · toutes » en historique complet). */
export type KanbanColumnData = { key: KanbanKey; label: string; tone: Tone; cards: ActionListItem[] };

const NOTE = { fontSize: 11, color: 'var(--color-neutral-500)', padding: '8px 10px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)', textWrap: 'pretty' } as const;

/**
 * Vue Kanban du plan d'actions (spec § 16) : six colonnes (À faire · En cours · En retard · Reportée · Terminée — à
 * vérifier · Vérifiée), les huit premières cartes puis dépliage sur place ; le défilement horizontal reste dans le tableau.
 */
export function KanbanBoard({ columns }: { columns: KanbanColumnData[] }) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4, maxWidth: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))`, gap: 10, minWidth: columns.length * 200 }}>
        {columns.map((c) => <KanbanColumn key={c.key} column={c} />)}
      </div>
    </div>
  );
}

function KanbanColumn({ column: c }: { column: KanbanColumnData }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = c.cards.length - MAX_CARDS;
  const cards = expanded ? c.cards : c.cards.slice(0, MAX_CARDS);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 2px 4px' }}>
        <Dot color={TONE[c.tone].dot} /><span style={{ fontSize: 12, fontWeight: 500 }}>{c.label}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{c.cards.length}</span>
      </div>
      {cards.map((a) => <KanbanCard key={a.id} a={a} step={c.key === 'en_cours' || c.key === 'en_retard'} />)}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
          style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11.5, color: 'var(--color-neutral-500)', padding: '2px 4px' }}>
          <Icon name={expanded ? 'ph-caret-up' : 'ph-caret-down'} size={11} />
          {expanded ? 'Réduire' : hidden === 1 ? "Afficher l'autre action" : `Afficher les ${hidden} autres`}
        </button>
      )}
      {c.cards.length === 0 && <div style={NOTE}>Aucune action</div>}
      {c.key === 'terminee' && (
        <div style={NOTE}>Une action Terminée n&apos;est close qu&apos;après la vérification de son efficacité par le service QHSE.</div>
      )}
    </div>
  );
}

/** Carte : source et référence, numéro, libellé, palier (En cours, En retard), responsable, date cible, vérification. */
function KanbanCard({ a, step }: { a: ActionListItem; step: boolean }) {
  return (
    <ActionLink id={a.id} className="card elev-sm vg-kcard" style={{ gap: 7, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-neutral-500)', minWidth: 0 }}>
        <Icon name={a.sourceIcon} size={12} style={{ flex: 'none' }} />
        <span style={{ whiteSpace: 'nowrap' }}>{a.sourceLabel}</span>
        {a.originRef && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {a.originRef}</span>}
        <span style={{ marginLeft: 'auto', flex: 'none', color: 'var(--vg-text-muted)' }}>{a.id}</span>
      </div>
      <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{a.label}</div>
      {(step || a.toComplete || a.priorityLabel) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: 'var(--color-neutral-400)' }}>
          {step && <span title="Avancement">{a.avancement}</span>}
          {a.priorityLabel && <span>{step ? '· ' : ''}{a.priorityLabel}</span>}
          {a.toComplete && <span style={{ color: TONE.warn.dot }}>{step || a.priorityLabel ? '· ' : ''}À compléter</span>}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '4px 6px', fontSize: 11, color: 'var(--color-neutral-400)' }}>
        {/* Responsable : jamais plus étroit que ses initiales ; deux dates d'une Terminée : les dates passent à la ligne. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 18, overflow: 'hidden' }} title={a.pilot}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--color-neutral-800)', display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--color-neutral-200)', flex: 'none' }}>{a.pilotInitials}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.pilot}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <span title={`Date cible : ${a.due}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: a.late ? TONE.danger.dot : 'var(--color-neutral-300)' }}>
            <Icon name="ph-calendar-blank" size={12} />{a.due}
          </span>
          {a.status === 'terminee' && a.verifyDue && (
            <span title={`Vérification d'efficacité le ${a.verifyDue}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: a.verifyLate ? TONE.danger.dot : TONE.warn.dot }}>
              <Icon name="ph-seal-check" size={12} />{a.verifyDue}
            </span>
          )}
        </span>
      </div>
    </ActionLink>
  );
}
