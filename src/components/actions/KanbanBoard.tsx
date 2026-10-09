'use client';

import { useState } from 'react';
import { Dot, Icon } from '@/components/ui';
import type { PlanAction } from '@/lib/data/actions';
import { TONE, type ActionColumn, type Tone } from '@/lib/domain';
import { ActionLink } from './ActionPlanProvider';

const MAX_CARDS = 8;

export type KanbanColumnData = { key: ActionColumn; label: string; tone: Tone; cards: PlanAction[] };

const dueColor = (a: PlanAction) => (a.late ? TONE.danger.dot : 'var(--color-neutral-300)');

/** Vue Kanban du plan d'actions : cinq colonnes, les huit premières cartes puis dépliage sur place. */
export function KanbanBoard({ columns }: { columns: KanbanColumnData[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(200px, 1fr))', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
      {columns.map((c) => <KanbanColumn key={c.key} column={c} />)}
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
      {cards.map((a) => <KanbanCard key={a.id} a={a} />)}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
          style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11.5, color: 'var(--color-neutral-500)', padding: '2px 4px' }}>
          <Icon name={expanded ? 'ph-caret-up' : 'ph-caret-down'} size={11} />
          {expanded ? 'Réduire' : hidden === 1 ? "Afficher l'autre action" : `Afficher les ${hidden} autres`}
        </button>
      )}
      {c.key === 'done' && (
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', padding: '8px 10px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)', textWrap: 'pretty' }}>
          Une action n&apos;est clôturée qu&apos;après vérification de son efficacité par l&apos;animateur QHSE ou la direction.
        </div>
      )}
    </div>
  );
}

function KanbanCard({ a }: { a: PlanAction }) {
  return (
    <ActionLink id={a.id} className="card elev-sm vg-kcard" style={{ gap: 7, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--color-neutral-500)', minWidth: 0 }}>
        <Icon name={a.origin.icon} size={12} style={{ flex: 'none' }} />
        <span style={{ whiteSpace: 'nowrap' }}>{a.origin.label}</span>
        <span style={{ flex: 1, minWidth: 0, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {a.originRef}</span>
        <span style={{ marginLeft: 'auto', flex: 'none', color: 'var(--color-neutral-600)' }}>{a.id}</span>
      </div>
      <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{a.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 11, color: 'var(--color-neutral-400)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--color-neutral-800)', display: 'grid', placeItems: 'center', fontSize: 9, color: 'var(--color-neutral-200)' }}>{a.pilotInitials}</span>{a.pilot}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: dueColor(a) }}><Icon name="ph-calendar-blank" size={12} />{a.due}</span>
      </div>
    </ActionLink>
  );
}
