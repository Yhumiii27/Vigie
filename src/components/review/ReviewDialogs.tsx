'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { DeleteButton } from '@/components/audits/parts';
import { fmtDate } from '@/lib/dates';
import { REVIEW_DECISION_KINDS, REVIEW_DECISION_KEYS, REVIEW_KINDS, REVIEW_KIND_KEYS, REVIEW_SOURCES, REVIEW_SOURCE_KEYS, type ReviewKind } from '@/lib/domain';
import type { Option } from '@/lib/data/options';
import type { DecisionView, ReviewItemView, ReviewView } from '@/lib/data/review';
import {
  abandonReviewDecision, addReviewCorrection, cancelReview, closeReview, createReview, deleteReviewDecision, deleteReviewItem, holdReview, rescheduleReview,
  saveReviewDecision, saveReviewItem,
} from '@/server/review';
import styles from './review.module.css';

const SOURCE_OPTIONS = REVIEW_SOURCE_KEYS.map((k) => [k, REVIEW_SOURCES[k].label] as const);
const KIND_OPTIONS = REVIEW_KIND_KEYS.map((k) => [k, REVIEW_KINDS[k].label] as const);
const DECISION_OPTIONS = REVIEW_DECISION_KEYS.map((k) => [k, REVIEW_DECISION_KINDS[k].label] as const);

/** Ajoute à une liste de personnes celle déjà choisie si elle n'y figure plus (personne sortie). */
const withValue = (options: readonly Option[], value: string | null | undefined, label?: string) =>
  value && !options.some(([v]) => v === value) ? [...options, [value, label ?? value] as const] : options;

function Footer({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

// ─── Élément d'entrée de la check-list ──────────────────────────────────────

export function ItemForm({ reviewId, item, people, canDelete, onClose }: {
  reviewId: number; item?: ReviewItemView; people: readonly Option[]; canDelete: boolean; onClose: () => void;
}) {
  const [source, setSource] = useState<string>(item?.source ?? 'manuel');
  const auto = REVIEW_SOURCES[source as keyof typeof REVIEW_SOURCES]?.auto ?? false;
  return (
    <>
      <ActionForm action={saveReviewItem} onDone={onClose} onCancel={onClose} submitLabel={item ? 'Enregistrer' : 'Ajouter'}
        hidden={{ id: item?.id, reviewId: item ? undefined : reviewId }}>
        <Field name="label" label="Élément d'entrée de la revue" hint="Ex. Performance des fournisseurs, Résultats des audits internes.">
          <Input name="label" defaultValue={item?.label} maxLength={160} autoFocus />
        </Field>
        <Field name="source" label="Source"
          hint={auto ? 'Calculé par Vigie : fourni dès que les données de la section existent dans le dossier.' : 'Élément remis par un contributeur, coché à réception.'}>
          <Select name="source" options={SOURCE_OPTIONS} defaultValue={item?.source ?? 'manuel'} onChange={(e) => setSource(e.target.value)} />
        </Field>
        {!auto && (
          <>
            <FormRow>
              <Field name="ownerId" label="Fourni par">
                <Select name="ownerId" options={withValue(people, item?.ownerId)} defaultValue={item?.ownerId ?? ''} placeholder="Hors annuaire / Vigie" />
              </Field>
              <Field name="dueOn" label="Attendu le">
                <Input name="dueOn" type="date" defaultValue={item?.dueOn ?? ''} />
              </Field>
            </FormRow>
            <Field name="owner" label="Précision" hint="Contributeur hors annuaire, référence d'action (ex. A-184)…">
              <Input name="owner" defaultValue={item?.owner} maxLength={80} />
            </Field>
            {!item && <Checkbox name="done" label="Déjà fourni" />}
          </>
        )}
      </ActionForm>
      {item && canDelete && (
        <Footer>
          <DeleteButton run={() => deleteReviewItem(item.id)} onDone={onClose} label="Retirer de la check-list" note="Donnée de préparation : retrait définitif." />
        </Footer>
      )}
    </>
  );
}

// ─── Décision, objectif ou besoin en ressources ─────────────────────────────

export function DecisionForm({ reviewId, decision, people, canDelete, onClose }: {
  reviewId: number; decision?: DecisionView; people: readonly Option[]; canDelete: boolean; onClose: () => void;
}) {
  return (
    <>
      <ActionForm action={saveReviewDecision} onDone={onClose} onCancel={onClose} submitLabel={decision ? 'Enregistrer' : 'Ajouter'}
        hidden={{ id: decision?.id, reviewId: decision ? undefined : reviewId }}>
        <Field name="kind" label="Nature">
          <Select name="kind" options={DECISION_OPTIONS} defaultValue={decision?.kind ?? 'decision'} />
        </Field>
        <Field name="text" label="Intitulé" hint="§9.3.3 : opportunités d'amélioration, modifications du système, besoins en ressources.">
          <TextArea name="text" rows={3} maxLength={400} defaultValue={decision?.text} autoFocus />
        </Field>
        <FormRow>
          <Field name="pilotId" label="Pilote">
            <Select name="pilotId" options={withValue(people, decision?.pilotId, decision?.pilot)} defaultValue={decision?.pilotId ?? ''} placeholder="À désigner" />
          </Field>
          <Field name="dueOn" label="Échéance">
            <Input name="dueOn" type="date" defaultValue={decision?.dueOn ?? ''} />
          </Field>
        </FormRow>
      </ActionForm>
      {decision && canDelete && !decision.actionId && (
        <Footer>
          <DeleteButton run={() => deleteReviewDecision(decision.id)} onDone={onClose} label="Retirer" note="Projet de décision avant la séance : retrait définitif." />
        </Footer>
      )}
    </>
  );
}

// ─── Compte rendu de la séance ──────────────────────────────────────────────

export function HoldForm({ review, people, now, next, allSites, onClose }: {
  review: ReviewView; people: readonly Option[]; now: string; next: { on: string; kind: ReviewKind }; allSites: boolean; onClose: () => void;
}) {
  const chosen = new Set(review.participantIds);
  // Participants déjà enregistrés mais sortis de l'effectif : conservés dans la liste.
  const departed = review.participantIds.filter((id) => !people.some(([v]) => v === id)).map((id) => [id, review.participants[review.participantIds.indexOf(id)] ?? id] as const);
  const list = [...people, ...departed].map(([v, l]) => [v, l.split(' — ')[0]] as const);
  return (
    <ActionForm action={holdReview} onDone={onClose} onCancel={onClose} hidden={{ id: review.id }}
      submitLabel={review.status === 'tenue' ? 'Enregistrer le compte rendu' : 'Enregistrer · revue tenue'}>
      {/* Première saisie : le dossier de séance est figé (indicateurs arrêtés à la date de la séance, AUD-06) sur tout le périmètre. */}
      <p style={{ margin: 0, fontSize: 12, color: !allSites && !review.seanceFrozen ? 'var(--tone-warn-fg)' : 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {review.seanceFrozen
          ? 'Dossier de séance figé à la première saisie : le corriger ne recalcule pas ses indicateurs, sauf si la date de la séance change (« Tous les sites » requis).'
          : `À l'enregistrement, le dossier de séance est figé avec les indicateurs arrêtés à la date de la séance.${allSites ? '' : ' Sélectionnez d’abord « Tous les sites » : il couvre tout le périmètre.'}`}
      </p>
      <Field name="reviewOn" label="Date de la séance" hint="Corrigez-la si la revue s'est tenue un autre jour.">
        <Input name="reviewOn" type="date" defaultValue={review.reviewOn <= now ? review.reviewOn : now} max={now} />
      </Field>
      <Field name="participantIds" label="Participants">
        <div className={styles.people}>
          {list.map(([id, label]) => (
            <label key={id} className="vg-check">
              <input type="checkbox" name="participantIds" value={id} defaultChecked={chosen.has(id)} />
              <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
              <span>{label}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field name="externalParticipants" label="Autres participants" hint="Hors annuaire : représentants du CSE, organisme, consultant…">
        <Input name="externalParticipants" defaultValue={review.externalParticipants ?? ''} maxLength={300} />
      </Field>
      <Field name="customerPerception" label="Perception des clients (§9.3.2 c1)" hint="Retours clients, enquêtes, respect des délais de livraison.">
        <TextArea name="customerPerception" rows={3} maxLength={2000} defaultValue={review.customerPerception ?? ''} />
      </Field>
      <Field name="resourceNeeds" label="Besoins en ressources (§9.3.3 c)" hint="Effectifs, équipements, budget, formations à programmer.">
        <TextArea name="resourceNeeds" rows={3} maxLength={2000} defaultValue={review.resourceNeeds ?? ''} />
      </Field>
      <Field name="minutes" label="Compte rendu et conclusions">
        <TextArea name="minutes" rows={5} maxLength={4000} defaultValue={review.minutes ?? ''} />
      </Field>
      <FormRow>
        <Field name="nextReviewOn" label="Prochaine revue le" hint="Revue suivante déjà planifiée : reportée à cette date au besoin ; sinon créée (check-list reprise) avec son échéance au programme.">
          <Input name="nextReviewOn" type="date" defaultValue={next.on} />
        </Field>
        <Field name="nextKind" label="Type de la prochaine revue">
          <Select name="nextKind" options={KIND_OPTIONS} defaultValue={next.kind} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

// ─── Nouvelle revue, report ─────────────────────────────────────────────────

export function CreateReviewForm({ nextOn, kind, copyFrom, copyLabel, onClose }: {
  nextOn: string; kind: ReviewKind; copyFrom: number | null; copyLabel: string | null; onClose: () => void;
}) {
  return (
    <ActionForm action={createReview} onDone={onClose} onCancel={onClose} hidden={{ copyFrom }} submitLabel="Planifier la revue">
      <FormRow>
        <Field name="reviewOn" label="Date de la revue">
          <Input name="reviewOn" type="date" defaultValue={nextOn} autoFocus />
        </Field>
        <Field name="kind" label="Type">
          <Select name="kind" options={KIND_OPTIONS} defaultValue={kind} />
        </Field>
      </FormRow>
      {copyFrom && copyLabel && <Checkbox name="copyItems" label={`Reprendre la check-list de la ${copyLabel.toLowerCase()}`} defaultChecked />}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        La revue est inscrite au programme annuel : elle reprend l&apos;échéance de revue déjà prévue ce mois-là, sinon elle est ajoutée à la ligne « Revues de direction ».
      </p>
    </ActionForm>
  );
}

export function RescheduleForm({ review, onClose }: { review: ReviewView; onClose: () => void }) {
  return (
    <ReasonForm action={rescheduleReview} onDone={onClose} onCancel={onClose} hidden={{ id: review.id }} submitLabel="Reporter la revue"
      placeholder="Ex. Indisponibilité de la direction" before={(
        <Field name="to" label="Nouvelle date" hint="L'échéance de la revue au programme annuel est reportée à cette date (première date conservée).">
          <Input name="to" type="date" defaultValue={review.reviewOn} autoFocus />
        </Field>
      )} />
  );
}

// ─── Clôture et annulation (animateur QHSE, direction) ──────────────────────

/** Visa de la direction : confirmation en ligne, puis clôture et dossier figé. */
export function CloseReviewButton({ id, allSites }: { id: number; allSites: boolean }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return (
      <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setAsking(true)}
        title="Visa de la direction : le dossier de revue est figé et n'est plus recalculé.">
        <i className="ph ph-seal-check" style={{ fontSize: 13 }} aria-hidden />Clôturer et figer le dossier
      </button>
    );
  }
  return (
    <span style={{ display: 'grid', gap: 6, flexBasis: '100%' }}>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
        Le dossier est figé avec les indicateurs arrêtés à la date de la séance (dossier de séance et compte rendu) et ne pourra plus être modifié.
        {!allSites && ' Sélectionnez d’abord « Tous les sites » : le dossier archivé couvre tout le périmètre.'}
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setAsking(false); setError(null); }}>Annuler</button>
        <button type="button" className="btn btn-primary vg-btn-sm" disabled={pending || !allSites}
          onClick={() => start(async () => {
            const r = await closeReview(id);
            if (r.error) setError(r.error);
            else setAsking(false);
          })}>
          <i className="ph ph-seal-check" style={{ fontSize: 13 }} aria-hidden />{pending ? 'Clôture…' : 'Confirmer la clôture'}
        </button>
      </span>
      {error && <span role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </span>
  );
}

/** Décision abandonnée après la séance (AUD-36) : motif obligatoire, la décision reste affichée barrée. */
export function AbandonDecisionButton({ decision }: { decision: DecisionView }) {
  return (
    <ReasonButton action={abandonReviewDecision} hidden={{ id: decision.id }} label="Abandonner" className="vg-text-btn"
      title={`${decision.kindLabel} abandonné(e)`} kicker={decision.text.length > 80 ? `${decision.text.slice(0, 79)}…` : decision.text} submitLabel="Abandonner"
      message="La décision n'est jamais retirée du compte rendu : elle reste affichée barrée avec la date, l'auteur et le motif, et ne donne plus d'échéance « sans suite »."
      placeholder="Ex. objectif repris par la décision de la revue suivante" />
  );
}

/**
 * Rectificatif d'une revue clôturée (AUD-34), signé par la direction : ajout daté et motivé, affiché avec le dossier figé
 * (qui ne change pas) et à l'historique de la revue.
 */
export function CorrectionButton({ review }: { review: ReviewView }) {
  return (
    <ReasonButton action={addReviewCorrection} hidden={{ id: review.id }} label="Ajouter un rectificatif" icon="ph-pen-nib" className="btn btn-ghost vg-btn-sm"
      title="Rectificatif de la revue" kicker={`Revue de direction du ${fmtDate(review.reviewOn)}`} submitLabel="Signer le rectificatif"
      message="Le dossier figé au visa ne se modifie pas : le rectificatif s'y ajoute, daté et signé en votre nom, et ne pourra plus être modifié (une erreur se corrige par un nouveau rectificatif)."
      placeholder="Ex. erreur de saisie relevée par le CSE" before={(
        <Field name="text" label="Rectificatif" hint="Ce qui est rectifié dans le dossier et la correction apportée.">
          <TextArea name="text" rows={4} maxLength={2000} autoFocus />
        </Field>
      )} />
  );
}

export function CancelReviewButton({ review }: { review: ReviewView }) {
  return (
    <ReasonButton action={cancelReview} hidden={{ id: review.id }} label="Annuler la revue" icon="ph-x-circle" className="btn btn-ghost vg-btn-sm"
      title="Annuler la revue" kicker={`Revue de direction du ${fmtDate(review.reviewOn)}`} submitLabel="Annuler la revue"
      message="La revue et sa check-list restent consultables dans l'historique (filtre « Afficher les annulées »). Son échéance au programme annuel est annulée avec elle (liste « Éléments annulés »)."
      placeholder="Ex. Revue regroupée avec la revue annuelle" />
  );
}
