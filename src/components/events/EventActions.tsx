'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionFields, NewActionButton, type ActionDefaults } from '@/components/ActionFormDialog';
import { Dialog } from '@/components/Dialog';
import type { FormOptions } from '@/lib/data/options';
import { TONE, type Tone } from '@/lib/domain';

/** Action liée à l'événement, telle que la fiche l'affiche et la modifie. */
export type EventActionItem = {
  id: string; title: string; description: string | null; origin: string; originRef: string; eventId: string | null;
  siteId: string | null; pilotId: string; dueOn: string; kind: 'C' | 'P'; verifyDueOn: string | null;
  kindLabel: string; pilot: string; due: string; late: boolean; tone: Tone; statusLabel: string;
};

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;

const planHref = (id: string) => `/actions?action=${encodeURIComponent(id)}`;

/** Section « Actions correctives et préventives » de la fiche événement. */
export function EventActions({ items, options, canManage, newDefaults, emptyNote, addBlocked }: {
  items: EventActionItem[]; options: Opts; canManage: boolean; newDefaults: ActionDefaults; emptyNote: string;
  /** Raison pour laquelle l'ajout d'action est fermé (étape « Efficacité vérifiée » atteinte). */
  addBlocked?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EventActionItem | null>(null);
  const close = () => setEditing(null);
  const open = (a: EventActionItem) => (canManage ? setEditing(a) : router.push(planHref(a.id)));

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h6 className="vg-h6">Actions correctives et préventives</h6>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canManage && (
            // Le bouton désactivé ne reçoit pas le survol : l'infobulle est portée par son conteneur.
            <span title={addBlocked ?? undefined} style={{ display: 'inline-flex' }}>
              <NewActionButton options={options} defaults={newDefaults} label="Ajouter une action" className="btn btn-secondary vg-btn-sm"
                disabled={!!addBlocked} tooltip={addBlocked ?? undefined} />
            </span>
          )}
          <Link href="/actions" className="vg-link">Plan d&apos;actions →</Link>
        </span>
      </div>
      {items.length > 0 ? (
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Réf.</th><th>Action</th><th>Type</th><th>Pilote</th><th>Échéance</th><th>Statut</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="is-clickable" tabIndex={0} title={canManage ? `Modifier ${a.id}` : `Voir ${a.id} dans le plan d'actions`}
                onClick={() => open(a)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(a); } }}>
                <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.id}</td>
                <td>{a.title}</td>
                <td style={{ color: 'var(--color-neutral-400)' }}>{a.kindLabel}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
                <td style={{ whiteSpace: 'nowrap', color: a.late ? TONE.danger.dot : 'var(--color-neutral-300)' }}>{a.due}</td>
                <td><span className="tag" style={{ background: TONE[a.tone].bg, color: TONE[a.tone].fg }}>{a.statusLabel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '10px 12px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
          {emptyNote}
        </div>
      )}

      <Dialog open={!!editing} onClose={close} title={editing ? `Modifier ${editing.id}` : ''} kicker="Plan d'actions unique" width={560}>
        {editing && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-neutral-400)' }}>
              <span className="tag" style={{ background: TONE[editing.tone].bg, color: TONE[editing.tone].fg }}>{editing.statusLabel}</span>
              <span>L&apos;avancement et la clôture se font dans le plan d&apos;actions.</span>
              <Link href={planHref(editing.id)} className="vg-link" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>Ouvrir →</Link>
            </div>
            <ActionFields options={options} onDone={close} onCancel={close} defaults={{
              id: editing.id, title: editing.title, description: editing.description, origin: editing.origin, originRef: editing.originRef,
              eventId: editing.eventId, siteId: editing.siteId, pilotId: editing.pilotId, dueOn: editing.dueOn, kind: editing.kind,
              verifyDueOn: editing.verifyDueOn, lockOrigin: true,
            }} />
          </>
        )}
      </Dialog>
    </div>
  );
}
