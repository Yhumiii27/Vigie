'use client';

import { useState } from 'react';
import { ActionForm, Field, FormRow, Input, Select } from '@/components/form';
import { FILES_HINT, FileError, checkPickedFiles } from '@/components/watch/parts';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { addMonths, fmtDate } from '@/lib/dates';
import type { SkillRow, TrainingTitle } from '@/lib/data/skills';
import { saveQualification } from '@/server/skills';
import { period } from './common';
import { coversNeed, heldState, lapseFor, type Span } from './rules';

type Props = {
  rows: SkillRow[];
  titles: TrainingTitle[];
  /** Date de référence (serveur). */
  today: string;
  /** Salarié et titre imposés (ouverture depuis une case de la matrice). */
  fixed?: { personId: string; titleId: string };
  /** Valeurs initiales (correction de la formation `qualificationId`, la ligne de l'historique est modifiée). */
  initial?: { qualificationId: number; obtainedOn?: string | null; expiresOn?: string | null; provider?: string | null; scope?: string | null };
  onDone: () => void;
  onCancel?: () => void;
};

const expiryFor = (title: TrainingTitle | undefined, obtainedOn: string) =>
  title && title.validityMonths > 0 && /^\d{4}-\d{2}-\d{2}$/.test(obtainedOn) ? addMonths(obtainedOn, title.validityMonths) : '';

/** Pourquoi la formation saisie ne règle pas le besoin de recyclage. */
function gapReason(expiresOn: string | null, assignments: readonly Span[], today: string) {
  if (!expiresOn) return '';
  const on = fmtDate(expiresOn);
  const state = heldState(expiresOn, today);
  if (state === 'x') return `Avec une échéance au ${on}, le titre resterait expiré`;
  if (state === 's') return `Avec une échéance au ${on}, le titre expirerait sous 60 jours`;
  const a = assignments.find((x) => lapseFor(state, expiresOn, x, today));
  return `Avec une échéance au ${on}, le titre ne couvrirait pas l'affectation Keystone ${a ? period(a.startOn, a.endOn) : ''}`.trimEnd();
}

/**
 * « Enregistrer une formation » : obtention d'un titre par un salarié, échéance calculée d'après la validité du titre.
 * Chaque formation s'ajoute à l'historique de la case ; `initial` corrige la formation en cours. Attestation facultative.
 */
export function TrainingForm({ rows, titles, today, fixed, initial, onDone, onCancel }: Props) {
  const [personId, setPersonId] = useState(fixed?.personId ?? '');
  const [titleId, setTitleId] = useState(fixed?.titleId ?? '');
  const title = titles.find((t) => t.id === titleId);
  const startOn = initial?.obtainedOn ?? today;
  const [obtainedOn, setObtainedOn] = useState(startOn);
  const [expiresOn, setExpiresOn] = useState(initial ? initial.expiresOn ?? '' : expiryFor(title, startOn));
  // Échéance saisie à la main : conservée quand le titre choisi n'a pas de durée de validité.
  const [expiryTyped, setExpiryTyped] = useState(false);
  // Attestations refusées avant l'envoi (au-delà des limites, la requête n'atteindrait pas le serveur : HAB-01).
  const [fileError, setFileError] = useState<string | null>(null);

  const cellOf = (pid: string, tid: string) => rows.find((r) => r.person.id === pid)?.cells.find((c) => c.title.id === tid);
  const cell = cellOf(personId, titleId);
  // Action de recyclage reprise encore rattachée (consultation seule) : l'enregistrement ne la modifie pas (réponses du
  // service QHSE du 15/10/2026 : les formations ne donnent pas lieu à des actions QSE).
  const renewal = cell?.renewal ?? null;
  // Échéance retenue par le serveur (obtention + validité si laissée vide) : règle-t-elle le besoin de recyclage ?
  const effectiveExpiry = expiresOn || expiryFor(title, obtainedOn) || null;
  const assignments = rows.find((r) => r.person.id === personId)?.assignments ?? [];
  const covers = coversNeed(effectiveExpiry, assignments, today);
  const providers = [...new Set(rows.flatMap((r) => r.cells.map((c) => c.provider)).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, 'fr'));
  // L'organisme reprend celui de la formation précédente tant que l'utilisateur ne l'a pas saisi.
  const [provider, setProvider] = useState(initial ? initial.provider ?? '' : cell?.provider ?? '');
  const [providerTyped, setProviderTyped] = useState(false);
  const pick = (pid: string, tid: string) => { if (!providerTyped) setProvider(cellOf(pid, tid)?.provider ?? ''); };

  const onPerson = (id: string) => {
    setPersonId(id);
    pick(id, titleId);
  };
  /** Échéance calculée (obtention + validité) ; un titre sans échéance garde la saisie manuelle, sinon la vide. */
  const autoExpiry = (ti: TrainingTitle | undefined, d: string) => {
    if (ti?.validityMonths) {
      setExpiresOn(expiryFor(ti, d));
      setExpiryTyped(false);
    } else if (!expiryTyped) {
      setExpiresOn('');
    }
  };
  const onTitle = (id: string) => {
    setTitleId(id);
    autoExpiry(titles.find((t) => t.id === id), obtainedOn);
    pick(personId, id);
  };
  const onObtained = (d: string) => {
    setObtainedOn(d);
    autoExpiry(title, d);
  };

  return (
    <ActionForm action={saveQualification} onDone={onDone} onCancel={onCancel} submitLabel={initial ? 'Enregistrer la correction' : 'Enregistrer la formation'}
      encType="multipart/form-data" hidden={{ personId: fixed?.personId, titleId: fixed?.titleId, qualificationId: initial?.qualificationId }}>
      {!fixed && (
        <FormRow>
          <Field name="personId" label="Salarié">
            <Select name="personId" options={rows.map((r) => [r.person.id, r.person.name] as const)} placeholder="Choisir…" value={personId} onChange={(e) => onPerson(e.target.value)} autoFocus />
          </Field>
          <Field name="titleId" label="Titre">
            <Select name="titleId" options={titles.map((t) => [t.id, t.label] as const)} placeholder="Choisir…" value={titleId} onChange={(e) => onTitle(e.target.value)} />
          </Field>
        </FormRow>
      )}
      <FormRow>
        <Field name="obtainedOn" label="Date d'obtention">
          <Input name="obtainedOn" type="date" max={today} value={obtainedOn} onChange={(e) => onObtained(e.target.value)} autoFocus={!!fixed} />
        </Field>
        <Field name="expiresOn" label="Échéance"
          hint={!title ? undefined : title.validityMonths ? `Obtention + ${title.validityMonths} mois, modifiable.` : 'Titre sans échéance.'}>
          <Input name="expiresOn" type="date" min={obtainedOn || undefined} value={expiresOn} onChange={(e) => { setExpiresOn(e.target.value); setExpiryTyped(true); }} />
        </Field>
      </FormRow>
      <Field name="provider" label="Organisme de formation" hint="Facultatif · ex. [Apave], [AFPA], formation interne.">
        <Input name="provider" list="vg-training-providers" value={provider} onChange={(e) => { setProvider(e.target.value); setProviderTyped(true); }} maxLength={120} />
        <datalist id="vg-training-providers">{providers.map((p) => <option key={p} value={p} />)}</datalist>
      </Field>
      {title?.scopeLabel && (
        // HAB-10 : catégories CACES, indices d'habilitation électrique… obtenus.
        <Field key={title.id} name="scope" label={title.scopeLabel} hint="Catégories ou niveaux figurant sur l'attestation, séparés par des virgules.">
          <Input name="scope" defaultValue={initial?.scope ?? cell?.scope ?? ''} maxLength={120} />
        </Field>
      )}
      <Field name="files" label="Attestation (facultatif)" hint={FILES_HINT}>
        <Input name="files" type="file" multiple accept={ATTACH_ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
      </Field>
      <FileError error={fileError} />
      {cell?.obtainedOn && !initial && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-info" style={{ fontSize: 14, marginTop: 1 }} aria-hidden />
          <span>La formation du {fmtDate(cell.obtainedOn)}{cell.expiresOn ? ` (échéance ${fmtDate(cell.expiresOn)})` : ''}{cell.provider ? ` · ${cell.provider}` : ''} reste consultable dans l&apos;historique.</span>
        </div>
      )}
      {cell && !cell.required && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-info" style={{ fontSize: 14, marginTop: 1 }} aria-hidden />
          <span>Ce titre deviendra requis pour ce salarié.</span>
        </div>
      )}
      {effectiveExpiry && !covers && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-calendar-x" style={{ fontSize: 14, marginTop: 1 }} aria-hidden />
          <span style={{ textWrap: 'pretty' }}>{gapReason(effectiveExpiry, assignments, today)} : le recyclage reste à réaliser.</span>
        </div>
      )}
      {renewal && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-info" style={{ fontSize: 14, marginTop: 1 }} aria-hidden />
          <span style={{ textWrap: 'pretty' }}>
            L&apos;action reprise {renewal.id} n&apos;est pas modifiée par cet enregistrement : le service QHSE la clôt ou l&apos;abandonne dans le plan d&apos;actions.
          </span>
        </div>
      )}
    </ActionForm>
  );
}
