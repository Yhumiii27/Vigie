'use client';

import { useState } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import { addMonths, fmtDate } from '@/lib/dates';
import type { SkillRow, TrainingTitle } from '@/lib/data/skills';
import { SESSION_MAX_PARTICIPANTS } from '@/lib/rules/skills';
import { saveTrainingSession } from '@/server/skills';

/** Participant proposé : salarié de la matrice, ou salarié à recycler de la prévision (échéance du titre). */
export type SessionCandidate = { personId: string; person: string; expiresOn: string | null; preselected: boolean };

type Props = {
  titles: TrainingTitle[];
  /** Salariés de la matrice (session libre : tous proposés, aucun coché). */
  rows: SkillRow[];
  today: string;
  /**
   * Recyclage groupé (HAB-06, depuis la vue « À prévoir ») : titres de la prévision et, par titre, salariés à recycler
   * (cochés ou non, groupRenewalCandidates) ; le choix du titre propose ses salariés.
   */
  renewals?: Record<string, SessionCandidate[]>;
  onDone: () => void;
  onCancel?: () => void;
};

const expiryFor = (title: TrainingTitle | undefined, on: string) =>
  title && title.validityMonths > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on) ? addMonths(on, title.validityMonths) : '';

/**
 * « Session collective » (HAB-06) : un titre, une date, un organisme et les participants ; une formation est enregistrée
 * pour chacun, en une fois (saveTrainingSession). Recyclage groupé : `renewals` (titres et salariés de la prévision).
 * Attestations individuelles : ajoutées ensuite dans la case de chaque salarié.
 */
export function SessionForm({ titles, rows, today, renewals, onDone, onCancel }: Props) {
  const [titleId, setTitleId] = useState('');
  const title = titles.find((t) => t.id === titleId);
  const [heldOn, setHeldOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState(expiryFor(title, today));
  const offered = renewals ? titles.filter((t) => renewals[t.id]?.length) : titles;
  const candidates: SessionCandidate[] = renewals
    ? renewals[titleId] ?? []
    : rows.map((r) => ({ personId: r.person.id, person: r.person.name, expiresOn: r.cells.find((c) => c.title.id === titleId)?.expiresOn ?? null, preselected: false }));
  const [picked, setPicked] = useState(() => new Set<string>());
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const providers = [...new Set(rows.flatMap((r) => r.cells.map((c) => c.provider)).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, 'fr'));

  return (
    <ActionForm action={saveTrainingSession} onDone={onDone} onCancel={onCancel} submitLabel={`Enregistrer ${picked.size} formation${picked.size > 1 ? 's' : ''}`}>
      <FormRow>
        <Field name="titleId" label="Titre">
          <Select name="titleId" options={offered.map((t) => [t.id, t.label] as const)} placeholder="Choisir…" value={titleId}
            onChange={(e) => {
              const id = e.target.value;
              setTitleId(id);
              setExpiresOn(expiryFor(titles.find((t) => t.id === id), heldOn));
              // Recyclage groupé : salariés à rattraper ou expirant sous 3 mois cochés d'office.
              if (renewals) setPicked(new Set((renewals[id] ?? []).filter((c) => c.preselected).map((c) => c.personId)));
            }} autoFocus />
        </Field>
        <Field name="heldOn" label="Date de la session">
          <Input name="heldOn" type="date" max={today} value={heldOn} onChange={(e) => { setHeldOn(e.target.value); setExpiresOn(expiryFor(title, e.target.value)); }} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="expiresOn" label="Échéance" hint={!title ? undefined : title.validityMonths ? `Date + ${title.validityMonths} mois, modifiable.` : 'Titre sans échéance.'}>
          <Input name="expiresOn" type="date" min={heldOn || undefined} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
        <Field name="provider" label="Organisme de formation" hint="Facultatif.">
          <Input name="provider" list="vg-session-providers" maxLength={120} />
          <datalist id="vg-session-providers">{providers.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
      </FormRow>
      {title?.scopeLabel && (
        <Field key={title.id} name="scope" label={title.scopeLabel} hint="Catégories ou niveaux obtenus par tous les participants, séparés par des virgules.">
          <Input name="scope" maxLength={120} />
        </Field>
      )}
      <Field name="participants" group label={`Participants · ${picked.size} sur ${candidates.length}`}
        hint={`${SESSION_MAX_PARTICIPANTS} au plus. Le titre devient requis pour chacun ; les prérequis non valides sont signalés après l'enregistrement.`}>
        {candidates.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{titleId || !renewals ? 'Aucun salarié à proposer.' : 'Choisissez le titre à recycler.'}</span>
        ) : (
          <div style={{ display: 'grid', gap: 2, maxHeight: 260, overflowY: 'auto', padding: '2px 0' }}>
            {candidates.map((c) => (
              <Checkbox key={c.personId} name="participants" value={c.personId} checked={picked.has(c.personId)} onChange={(on) => toggle(c.personId, on)}
                label={<>{c.person}{titleId && <span style={{ color: 'var(--vg-text-muted)' }}> · {c.expiresOn ? `échéance ${fmtDate(c.expiresOn)}` : 'jamais suivi'}</span>}</>} />
            ))}
          </div>
        )}
      </Field>
    </ActionForm>
  );
}
