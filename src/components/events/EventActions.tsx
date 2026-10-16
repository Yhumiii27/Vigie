'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionFields, NewActionButton } from '@/components/ActionFormDialog';
import { Dialog } from '@/components/Dialog';
import { editOptions } from '@/components/actions/detail/form-helpers';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { TONE, type Tone } from '@/lib/domain';

/** Action liée à l'événement, telle que la fiche l'affiche (plan d'actions QSE : libellé court, avancement, priorité). */
export type EventActionItem = {
  id: string; label: string; pilot: string; due: string; late: boolean; tone: Tone; statusLabel: string;
  priority: { label: string; tone: Tone } | null;
  /**
   * Valeurs actuelles du formulaire de modification : service QHSE seulement, action non abandonnée (ACT-22 : toute
   * modification d'une action appartient au QHSE). Absent : la ligne ouvre la fiche du plan d'actions (lecture seule).
   */
  edit?: ActionDefaults;
  /** Libellé du site de l'action (gardé comme choix s'il est archivé, comme la fiche du plan : editOptions). */
  site?: string;
};

/**
 * Section « Actions » de la fiche événement. Création et modification réservées au service QHSE (canCreateAction) : les
 * autres rôles lisent les actions liées et ouvrent leur fiche dans le plan ; tant que l'événement attend une action, ils
 * lisent QHSE_ONLY_CREATE_MESSAGE à la place du bouton.
 */
export function EventActions({ eventId, items, options, canCreate, newDefaults, emptyNote, addBlocked }: {
  eventId: string; items: EventActionItem[]; options: ActionFormOptions; canCreate: boolean; newDefaults: ActionDefaults; emptyNote: string;
  /** Raison pour laquelle l'ajout d'action est fermé (étape « Efficacité vérifiée » atteinte, classé sans suite). */
  addBlocked?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EventActionItem | null>(null);
  const close = () => setEditing(null);
  const open = (a: EventActionItem) => (a.edit ? setEditing(a) : router.push(actionHref(a.id)));
  // Toutes les actions de l'événement, closes comprises (EVT-26).
  const planHref = `/actions?q=${encodeURIComponent(eventId)}&etat=historique`;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h6 className="vg-h6">Actions</h6>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {canCreate ? (
            // Le bouton désactivé ne reçoit pas le survol : l'infobulle est portée par son conteneur.
            <span title={addBlocked ?? undefined} style={{ display: 'inline-flex' }}>
              <NewActionButton options={options} defaults={newDefaults} label="Créer l'action" className="btn btn-secondary vg-btn-sm"
                disabled={!!addBlocked} tooltip={addBlocked ?? undefined} />
            </span>
          ) : !addBlocked && (
            <span className="vg-muted" style={{ fontSize: 12 }}>{QHSE_ONLY_CREATE_MESSAGE}</span>
          )}
          <Link href={planHref} className="vg-link">Plan d&apos;actions →</Link>
        </span>
      </div>
      {items.length > 0 ? (
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>N°</th><th>Action</th><th>Priorité</th><th>Responsable</th><th>Date cible</th><th>Avancement</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="is-clickable" tabIndex={0} title={a.edit ? `Modifier ${a.id}` : `Voir ${a.id} dans le plan d'actions`}
                onClick={() => open(a)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(a); } }}>
                <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.id}</td>
                <td>{a.label}</td>
                <td style={{ whiteSpace: 'nowrap', color: a.priority ? TONE[a.priority.tone].fg : 'var(--color-neutral-500)' }}>{a.priority?.label ?? '—'}</td>
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

      <Dialog open={!!editing} onClose={close} title={editing ? `Modifier ${editing.id}` : ''} kicker="Plan d'actions unique" width={720}>
        {editing?.edit && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--color-neutral-400)' }}>
              <span className="tag" style={{ background: TONE[editing.tone].bg, color: TONE[editing.tone].fg }}>{editing.statusLabel}</span>
              <span>L&apos;avancement, la vérification et le fil de commentaires sont sur la fiche du plan d&apos;actions.</span>
              <Link href={actionHref(editing.id)} className="vg-link" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>Ouvrir →</Link>
            </div>
            <ActionFields options={editOptions(options, { pilotId: editing.edit.pilotId ?? '', pilot: editing.pilot, siteId: editing.edit.siteId ?? null, site: editing.site ?? editing.edit.siteId ?? '' })}
              defaults={editing.edit} onDone={close} onCancel={close} />
          </>
        )}
      </Dialog>
    </div>
  );
}
