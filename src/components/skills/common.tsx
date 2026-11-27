import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Icon, ToneTag } from '@/components/ui';
import { actionHref } from '@/lib/action-rules';
import { fileIcon } from '@/lib/attachments';
import { daysBetween, fmtDate } from '@/lib/dates';
import { SKILL_SOON_DAYS } from '@/lib/horizons';
import { SKILL_STATES, type SkillState } from '@/lib/domain';
import type { ArchivedRecord, RenewalInfo, SkillCell, TrainingTitle } from '@/lib/data/skills';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

// Éléments partagés par les composants de l'écran Habilitations et formations.
// Plan d'actions : aucun recyclage ni formation ne donne lieu à une action QSE (réponses du service QHSE du 15/10/2026,
// le service RH gère cette partie) ; l'écran ne crée plus d'action et n'affiche, en consultation seule, que l'action
// de recyclage d'une base reprise encore rattachée à l'exigence (RenewalInfo).

export const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

/** Période d'une affectation (règle partagée avec le serveur, voir rules.ts). */
export { period } from '@/lib/rules/skills';

/** Un titre jamais suivi appelle une formation initiale, sinon un recyclage. */
export const renewalNoun = (state: SkillState, t: T) => (state === 'r' ? t('training#noun') : t('renewal#noun'));
export const plannedLabel = (state: SkillState, t: T) => (state === 'r' ? t('Training planned') : t('Renewal planned'));

export const validityLabel = (ti: Pick<TrainingTitle, 'validityMonths'>, t: T) => (ti.validityMonths ? fill(t('Validity {n} months'), { n: ti.validityMonths }) : t('No expiry'));

/** Pastille d'état de la matrice (cercle coloré + icône). */
export function SkillDot({ state, size = 22 }: { state: SkillState; size?: number }) {
  const s = SKILL_STATES[state];
  return (
    <span aria-hidden style={{ width: size, height: size, flex: 'none', borderRadius: '50%', display: 'inline-grid', placeItems: 'center', background: s.bg, color: s.fg, border: s.border }}>
      <Icon name={s.icon} size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Point d'accent signalant un recyclage planifié. */
export function PlannedMark({ size = 7, style }: { size?: number; style?: CSSProperties }) {
  return <span aria-hidden style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 0 2px var(--color-surface)', ...style }} />;
}

/** Précision de l'état : « expiré depuis le 28/09/2026 », « expire le 20/11/2026 · dans 44 j »… */
export function stateDetail(c: Pick<SkillCell, 'state' | 'expiresOn' | 'obtainedOn'>, now: string, t: T) {
  const days = c.expiresOn ? daysBetween(now, c.expiresOn) : null;
  switch (c.state) {
    case 'x': return c.expiresOn ? fill(t('Expired since {date} · {n} d'), { date: fmtDate(c.expiresOn), n: -days! }) : t('Expired');
    case 's': return c.expiresOn ? fill(t('Expires on {date} · in {n} d'), { date: fmtDate(c.expiresOn), n: days! }) : fill(t('Expires within {n} days'), { n: SKILL_SOON_DAYS });
    case 'v': return c.expiresOn ? fill(t('Valid until {date}'), { date: fmtDate(c.expiresOn) }) : t('Valid · no expiry');
    case 'r': return t('Required, never attended');
    case 'p': return c.expiresOn ? fill(t('Unusable according to Cursus · title expires on {date}'), { date: fmtDate(c.expiresOn) }) : t('Unusable according to Cursus');
    case 'u': return t('Titles held from Cursus unavailable: state not computed');
    default: return c.obtainedOn ? t('Not required for this employee · title held') : t('Not required for this employee');
  }
}

/** Libellé + valeur, comme dans la fiche événement. */
export function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vg-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12.5 }}>{children}</span>
    </div>
  );
}

/** Lien vers l'action de recyclage reprise dans le plan d'actions, avec son avancement (consultation seule). */
export function RenewalLink({ renewal, showDue = true }: { renewal: RenewalInfo; showDue?: boolean }) {
  const { t } = useI18n();
  // Action qu'on ne peut pas lire (canReadAction) : numéro seul, sans lien vers une fiche refusée.
  if (!renewal.readable) return <span style={{ fontSize: 12.5 }}>{renewal.id}</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Link href={actionHref(renewal.id)} className="vg-link" style={{ fontSize: 12.5 }}>{renewal.id}</Link>
      <ToneTag tone={renewal.tone} style={{ padding: '1px 7px' }}>{labelT(t)(renewal.statusLabel)}</ToneTag>
      {showDue && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fill(t('target date {date}'), { date: fmtDate(renewal.dueOn) })} · {renewal.pilot}</span>}
    </span>
  );
}

/** Étiquette « Recyclage planifié · A-xxx » (lien vers le plan d'actions). */
export function RenewalTag({ renewal, state }: { renewal: RenewalInfo; state: SkillState }) {
  const { t } = useI18n();
  const label = renewal.planned ? plannedLabel(state, t) : `${state === 'r' ? t('Training') : t('Renewal')} · ${lcfirst(renewal.statusLabel)}`;
  const target = `${renewal.label} — ${fill(t('target date {date}'), { date: fmtDate(renewal.dueOn) })}`;
  if (!renewal.readable) {
    return <span className="tag tag-accent" style={{ gap: 6 }}><Icon name="ph-calendar-check" size={13} />{label} · {renewal.id}</span>;
  }
  return (
    <Link href={actionHref(renewal.id)} className="tag tag-accent" style={{ textDecoration: 'none', gap: 6 }} title={target}>
      <Icon name="ph-calendar-check" size={13} />{label} · {renewal.id}<span className="vg-sr-only">{` (${target})`}</span>
    </Link>
  );
}

/** Tableau des titres conservés (consultation seule) : titre ou salarié, obtention, échéance, organisme, attestations reprises. */
export function ArchiveTable({ records, first }: { records: ArchivedRecord[]; first: 'title' | 'person' }) {
  const { t } = useI18n();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: 12 }}>
        <thead><tr><th>{first === 'title' ? t('Title#qualification') : t('Employee')}</th><th>{t('Obtained on')}</th><th>{t('Expiry')}</th><th>{t('Provider')}</th><th aria-label={t('Certificates')} /></tr></thead>
        <tbody>
          {records.map((r) => (
            <tr key={`${r.person.id}|${r.title.id}`}>
              <td>{first === 'title' ? r.title.label : r.person.name}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.obtainedOn ? fmtDate(r.obtainedOn) : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.expiresOn ? fmtDate(r.expiresOn) : r.obtainedOn ? t('No expiry') : '—'}</td>
              <td>{r.provider ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>
                {r.files.map((f) => (
                  <a key={f.id} href={f.url} target="_blank" rel="noopener" aria-label={fill(t('Certificate {name}'), { name: f.name })} className="vg-link"><Icon name={fileIcon(f.mime)} size={15} /></a>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

