import { Icon, ToneTag } from '@/components/ui';
import type { ActionListItem } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import { fmtDecimal } from '@/lib/forms';
import { ActionLink, ActionTableRow } from '../ActionPlanProvider';

// Vue Liste (vue générale par défaut, spec § 16) : N°, Date, Responsable, Avancement (retard signalé), Priorité, Date
// cible, Source, Domaine, libellé, Site ; pied : pointage et coûts des actions affichées. Vue des Abandonnées : motif et
// date d'abandon à la place de l'avancement.

const MUTED = { color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' } as const;
const EMPTY = { color: 'var(--color-neutral-500)', fontSize: 12, padding: '14px 8px' } as const;

/** Numéro : vrai lien (nouvel onglet possible), la ligne entière ouvre la fiche. */
function NumberCell({ a }: { a: ActionListItem }) {
  return (
    <td style={{ ...MUTED, color: 'var(--color-neutral-300)' }}>
      <ActionLink id={a.id} style={{ color: 'inherit', textDecoration: 'none' }}>{a.id}</ActionLink>
      {a.toComplete && <span title={`À compléter : ${a.missing.length} champ${a.missing.length > 1 ? 's' : ''} manquant${a.missing.length > 1 ? 's' : ''}`} style={{ marginLeft: 5, color: TONE.warn.dot }}><Icon name="ph-question" size={12} /></span>}
    </td>
  );
}

function SourceCell({ a }: { a: ActionListItem }) {
  return (
    <td style={{ ...MUTED, maxWidth: 220 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: a.source ? undefined : TONE.warn.dot }}><Icon name={a.sourceIcon} size={12} />{a.sourceLabel}</span>
      {a.originRef && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-600)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.originRef}</span>}
    </td>
  );
}

function ResponsableCell({ a }: { a: ActionListItem }) {
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      {a.pilot}
      {a.pilotLeft && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>personne sortie</span>}
    </td>
  );
}

function DueCell({ a }: { a: ActionListItem }) {
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: a.late ? TONE.danger.dot : 'var(--color-neutral-300)' }} title={a.rescheduled ? 'Date cible replanifiée' : 'Date cible'}>{a.due}</span>
      {a.late && <span style={{ display: 'block', fontSize: 11, color: TONE.danger.dot }}>{a.lateDays} j de retard</span>}
      {a.status === 'terminee' && a.verifyDue && (
        <span style={{ display: 'block', fontSize: 11, color: a.verifyLate ? TONE.danger.dot : 'var(--color-neutral-500)' }} title={`Vérification d'efficacité le ${a.verifyDue}`}>
          Vérif. {a.verifyDue}
        </span>
      )}
    </td>
  );
}

const money = (n: number) => `${fmtDecimal(n)} €`;

/** Liste des actions de l'affichage courant. */
export function ActionList({ items, totals, filtered }: { items: ActionListItem[]; totals: { hours: number; estimatedCost: number; actualCost: number }; filtered: boolean }) {
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 1100 }}>
          <thead>
            <tr><th>N°</th><th>Date</th><th>Responsable</th><th>Avancement</th><th>Priorité</th><th>Date cible</th><th>Source</th><th>Domaine</th><th>Action</th><th>Site</th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <ActionTableRow key={a.id} id={a.id}>
                <NumberCell a={a} />
                <td style={MUTED}>{a.opened}</td>
                <ResponsableCell a={a} />
                <td>
                  <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.statusLabel}</ToneTag>
                  {a.late && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 2 }}>{a.avancement}</span>}
                </td>
                <td style={MUTED}>{a.priorityLabel ?? '—'}</td>
                <DueCell a={a} />
                <SourceCell a={a} />
                <td style={MUTED}>{a.domainLabel ?? '—'}</td>
                <td style={{ minWidth: 220, textWrap: 'pretty' }}>{a.label}</td>
                <td style={{ ...MUTED, color: a.siteId ? MUTED.color : TONE.warn.dot }}>{a.siteShort}</td>
              </ActionTableRow>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={10} style={EMPTY}>{filtered ? 'Aucune action ne correspond à ces critères.' : 'Aucune action à afficher.'}</td></tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={10} style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', paddingTop: 10 }}>
                  {items.length} action{items.length > 1 ? 's' : ''} affichée{items.length > 1 ? 's' : ''} · Pointage : {fmtDecimal(totals.hours)} h ·
                  Coût estimé : {money(totals.estimatedCost)} · Coût réel : {money(totals.actualCost)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** Affichage « Abandonnées » : date et motif d'abandon. */
export function AbandonedList({ items, filtered }: { items: ActionListItem[]; filtered: boolean }) {
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 900 }}>
          <thead><tr><th>N°</th><th>Action</th><th>Source</th><th>Responsable</th><th>Site</th><th>Abandonnée le</th><th>Motif</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <ActionTableRow key={a.id} id={a.id}>
                <NumberCell a={a} />
                <td style={{ minWidth: 200, textWrap: 'pretty' }}>{a.label}</td>
                <SourceCell a={a} />
                <ResponsableCell a={a} />
                <td style={MUTED}>{a.siteShort}</td>
                <td style={MUTED}>{a.cancelledOn ? fmtDate(a.cancelledOn) : '—'}</td>
                <td style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty', minWidth: 220 }}>{a.cancelReason ?? '—'}</td>
              </ActionTableRow>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} style={EMPTY}>{filtered ? 'Aucune action abandonnée ne correspond à ces critères.' : 'Aucune action abandonnée.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
