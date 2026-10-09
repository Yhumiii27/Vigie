import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { ActionDefaults } from '@/components/ActionFormDialog';
import { Icon, ToneTag } from '@/components/ui';
import { daysBetween, fmtDate, monthName } from '@/lib/dates';
import { SKILL_STATES, type SkillState } from '@/lib/domain';
import type { Person } from '@/lib/queries';
import type { RenewalInfo, SkillCell, TrainingTitle } from '@/lib/data/skills';

// Éléments partagés par les composants de l'écran Habilitations et formations.

export const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

/** Animatrice QHSE : pilote par défaut des recyclages. */
export const RENEWAL_PILOT = 'clefevre';

/** « du 13 au 17 octobre » / « du 28 septembre au 2 octobre ». */
export function period(start: string, end: string) {
  const d1 = +start.slice(8, 10), d2 = +end.slice(8, 10), m1 = +start.slice(5, 7), m2 = +end.slice(5, 7);
  if (start === end) return `le ${d1} ${monthName(m1)}`;
  return m1 === m2 ? `du ${d1} au ${d2} ${monthName(m2)}` : `du ${d1} ${monthName(m1)} au ${d2} ${monthName(m2)}`;
}

/** Un titre jamais suivi appelle une formation initiale, sinon un recyclage. */
export const renewalNoun = (state: SkillState) => (state === 'r' ? 'formation' : 'recyclage');
export const planLabel = (state: SkillState) => (state === 'r' ? 'Planifier la formation' : 'Planifier le recyclage');
export const plannedLabel = (state: SkillState) => (state === 'r' ? 'Formation planifiée' : 'Recyclage planifié');
/**
 * Recyclage à planifier (échéance proposée par le serveur) et aucune action de recyclage rattachée.
 * Toute action non clôturée compte, y compris en « Efficacité à vérifier » : en créer une autre remplacerait
 * le rattachement de l'exigence (qualification_requirements.renewalActionId).
 */
export const canPlanRenewal = (c: Pick<SkillCell, 'renewalDueOn' | 'renewal'>) => c.renewalDueOn !== null && !c.renewal;

export const validityLabel = (t: Pick<TrainingTitle, 'validityMonths'>) => (t.validityMonths ? `Validité ${t.validityMonths} mois` : 'Sans échéance');

/** Valeurs de l'action « Planifier le recyclage » (plan d'actions unique, origine Habilitations). */
export function renewalDefaults(person: Pick<Person, 'id' | 'name' | 'siteId'>, title: Pick<TrainingTitle, 'id' | 'label'>, state: SkillState, dueOn: string | null): ActionDefaults {
  return {
    title: `${state === 'r' ? 'Formation initiale' : 'Recyclage'} ${lcfirst(title.label)} — ${person.name}`,
    origin: 'skills',
    originRef: `Habilitations · ${person.name}`,
    lockOrigin: true,
    pilotId: RENEWAL_PILOT,
    dueOn: dueOn ?? undefined,
    kind: 'P',
    siteId: person.siteId,
    link: `qualification:${person.id}:${title.id}`,
  };
}

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
export function stateDetail(c: Pick<SkillCell, 'state' | 'expiresOn' | 'obtainedOn'>, now: string) {
  const days = c.expiresOn ? daysBetween(now, c.expiresOn) : null;
  switch (c.state) {
    case 'x': return c.expiresOn ? `Expiré depuis le ${fmtDate(c.expiresOn)} · ${-days!} j` : 'Expiré';
    case 's': return c.expiresOn ? `Expire le ${fmtDate(c.expiresOn)} · dans ${days} j` : 'Expire sous 60 jours';
    case 'v': return c.expiresOn ? `Valide jusqu'au ${fmtDate(c.expiresOn)}` : 'Valide · sans échéance';
    case 'r': return 'Requis, jamais suivi';
    default: return c.obtainedOn ? 'Non requis pour ce salarié · formation enregistrée' : 'Non requis pour ce salarié';
  }
}

/** Libellé + valeur, comme dans la fiche événement. */
export function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{label}</span>
      <span style={{ fontSize: 12.5 }}>{children}</span>
    </div>
  );
}

/** Lien vers l'action de recyclage dans le plan d'actions, avec son statut. */
export function RenewalLink({ renewal, showDue = true }: { renewal: RenewalInfo; showDue?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Link href={`/actions?action=${encodeURIComponent(renewal.id)}`} className="vg-link" style={{ fontSize: 12.5 }}>{renewal.id}</Link>
      <ToneTag tone={renewal.tone} style={{ padding: '1px 7px' }}>{renewal.statusLabel}</ToneTag>
      {showDue && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>échéance {fmtDate(renewal.dueOn)} · {renewal.pilot}</span>}
    </span>
  );
}

/** Étiquette « Recyclage planifié · A-xxx » (lien vers le plan d'actions). */
export function RenewalTag({ renewal, state }: { renewal: RenewalInfo; state: SkillState }) {
  const label = renewal.planned ? plannedLabel(state) : `${state === 'r' ? 'Formation' : 'Recyclage'} · ${lcfirst(renewal.statusLabel)}`;
  return (
    <Link href={`/actions?action=${encodeURIComponent(renewal.id)}`} className="tag tag-accent" style={{ textDecoration: 'none', gap: 6 }} title={`${renewal.title} — échéance ${fmtDate(renewal.dueOn)}`}>
      <Icon name="ph-calendar-check" size={13} />{label} · {renewal.id}
    </Link>
  );
}
