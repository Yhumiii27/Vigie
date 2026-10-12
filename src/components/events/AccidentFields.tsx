'use client';

import { useState, type ReactNode } from 'react';
import { Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { Option } from '@/lib/form-options';
import { VICTIM_KINDS, VICTIM_KIND_KEYS } from '@/lib/domain';
import { RestrictedNote } from './FieldGrid';
import { INJURIES, declarationDuty } from './shared';

/** Rubriques de la déclaration d'un AT transmises au formulaire (données de santé à null pour un rôle non habilité). */
export type AccidentValues = {
  victimKind?: string | null; victimId?: string | null; victimName?: string | null; victimCompany?: string | null;
  workSchedule?: string | null; knownAt?: string | null; activity?: string | null; circumstances?: string | null;
  witnesses?: string | null; thirdParty?: string | null;
  injury?: string | null; lostDays?: number | null; cpamDeclaredOn?: string | null;
  lesionNature?: string | null; lesionSite?: string | null; careGiven?: string | null; reservesOn?: string | null;
};

const VICTIM_OPTIONS = VICTIM_KIND_KEYS.map((k) => [k, VICTIM_KINDS[k]] as const);
const REQUIRED = 'requis pour la qualification';
/** Aide d'un champ exigé à la qualification (EVT-05). */
export const requiredHint = (base?: ReactNode) => (base ? <>{base} · {REQUIRED}</> : `${REQUIRED[0].toUpperCase()}${REQUIRED.slice(1)}.`);

/**
 * Rubriques de la déclaration d'accident du travail (EVT-01, Cerfa 14463) dans le formulaire de la fiche : victime,
 * horaire, connaissance par l'employeur (départ du délai de 48 h), activité, circonstances, témoins, tiers ; puis, pour
 * l'animateur QHSE et la direction (`health`), blessure, jours perdus, lésions, soins, déclaration CPAM et réserves.
 * `benign` : accident inscrit au registre des accidents bénins (blessure verrouillée côté serveur).
 * Déclaration CPAM : tout AT de l'effectif non inscrit au registre (premiers soins compris : le registre est une faculté) ;
 * intérimaire ou victime extérieure : déclaré par l'ETT ou par son employeur (declarationDuty), date conservée si déjà saisie.
 */
export function AccidentFields({ event: e, people, health, benign }: { event: AccidentValues; people: readonly Option[]; health: boolean; benign?: 'active' | 'escalated' | null }) {
  const [victimKind, setVictimKind] = useState(e.victimKind ?? '');
  const [injury, setInjury] = useState(e.injury ?? '');
  const [declaredOn, setDeclaredOn] = useState(e.cpamDeclaredOn ?? '');
  const declared = victimKind && victimKind !== 'salarie';
  const duty = declarationDuty({ victimKind: victimKind || null });
  const showDeclaration = benign !== 'active' && (duty === 'cpam' || !!e.cpamDeclaredOn);

  return (
    <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>Accident du travail · déclaration</h6>
      <FormRow>
        <Field name="victimKind" label="Victime" hint={!victimKind ? requiredHint() : undefined}>
          <Select name="victimKind" options={VICTIM_OPTIONS} value={victimKind} onChange={(ev) => setVictimKind(ev.target.value)} placeholder="À préciser" />
        </Field>
        {victimKind === 'salarie' && (
          <Field name="victimId" label="Personne de l'effectif" hint={requiredHint()}>
            <Select name="victimId" options={people} defaultValue={e.victimId ?? ''} placeholder="Choisir…" />
          </Field>
        )}
        {declared && (
          <Field name="victimName" label="Nom de la victime" hint={requiredHint()}>
            <Input name="victimName" defaultValue={e.victimName ?? ''} maxLength={120} placeholder="Prénom et nom" autoComplete="off" />
          </Field>
        )}
      </FormRow>
      {declared && (
        <Field name="victimCompany" label={victimKind === 'interimaire' ? 'Entreprise de travail temporaire' : 'Entreprise ou organisme de la victime'}>
          <Input name="victimCompany" defaultValue={e.victimCompany ?? ''} maxLength={120} />
        </Field>
      )}
      <FormRow>
        <Field name="workSchedule" label="Horaire de travail ce jour-là">
          <Input name="workSchedule" defaultValue={e.workSchedule ?? ''} maxLength={80} placeholder="7 h 30 – 12 h · 13 h – 16 h 30" />
        </Field>
        <Field name="knownAt" label="Connu de l'employeur le" hint="Point de départ du délai de 48 h. Vide : date d'enregistrement dans Vigie.">
          <Input name="knownAt" type="datetime-local" defaultValue={e.knownAt ?? ''} />
        </Field>
      </FormRow>
      <Field name="activity" label="Activité de la victime au moment de l'accident">
        <Input name="activity" defaultValue={e.activity ?? ''} maxLength={300} placeholder="Tâche, poste, opération en cours" />
      </Field>
      <Field name="circumstances" label="Circonstances détaillées" hint={requiredHint('Les faits seulement : la nature et le siège des lésions ont leurs champs réservés.')}>
        <TextArea name="circumstances" defaultValue={e.circumstances ?? ''} rows={3} maxLength={4000} />
      </Field>
      <FormRow>
        <Field name="witnesses" label="Témoins">
          <TextArea name="witnesses" defaultValue={e.witnesses ?? ''} rows={2} maxLength={1000} placeholder="Nom, entreprise, coordonnées" />
        </Field>
        <Field name="thirdParty" label="Tiers impliqué">
          <Input name="thirdParty" defaultValue={e.thirdParty ?? ''} maxLength={500} placeholder="Nom, adresse, assureur ; vide : aucun" />
        </Field>
      </FormRow>

      {!health ? <RestrictedNote /> : (
        <>
          <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>
            <i className="ph ph-lock-simple" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />Données de santé · animateur QHSE et direction
          </h6>
          <FormRow>
            <Field name="injury" label="Blessure"
              hint={benign === 'active' ? 'Inscrit au registre des accidents bénins : « Basculer en déclaration CPAM » depuis la fiche.' : benign === 'escalated' ? 'Basculé en déclaration CPAM depuis le registre.' : undefined}>
              <Select name="injury" options={INJURIES} value={injury} onChange={(ev) => setInjury(ev.target.value)} placeholder="Non précisée" />
            </Field>
            <Field name="lostDays" label="Jours perdus" hint={injury === 'arret' ? "Jours calendaires d'arrêt (taux de gravité)." : 'Uniquement pour un accident avec arrêt.'}>
              <Input name="lostDays" type="number" min={0} step={1} inputMode="numeric" defaultValue={e.lostDays ?? ''} disabled={injury !== 'arret'} />
            </Field>
          </FormRow>
          <FormRow>
            <Field name="lesionNature" label="Nature des lésions">
              <Input name="lesionNature" defaultValue={e.lesionNature ?? ''} maxLength={200} placeholder="Coupure, entorse, brûlure…" />
            </Field>
            <Field name="lesionSite" label="Siège des lésions">
              <Input name="lesionSite" defaultValue={e.lesionSite ?? ''} maxLength={200} placeholder="Main droite, cheville gauche…" />
            </Field>
          </FormRow>
          <Field name="careGiven" label="Soins dispensés">
            <TextArea name="careGiven" defaultValue={e.careGiven ?? ''} rows={2} maxLength={1000} placeholder="Poste de secours, médecin, urgences, transport…" />
          </Field>
          {!showDeclaration && benign !== 'active' && duty !== 'cpam' && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              {duty === 'ett'
                ? "Intérimaire : l'entreprise de travail temporaire déclare l'accident. Informez-la sous 24 h (copie à la CARSAT et à l'inspection du travail), puis « Indiquer l'information de l'ETT » sur la fiche."
                : "Victime extérieure : son employeur déclare l'accident. « Indiquer la déclaration par l'employeur » sur la fiche avant la clôture."}
            </p>
          )}
          {showDeclaration && (
            <FormRow>
              <Field name="cpamDeclaredOn" label="Déclaration CPAM"
                hint={injury === 'soins'
                  ? "Accident bénin : inscription au registre ou déclaration, sous 48 h (dimanches et fériés non compris). Vide : non déclaré."
                  : "Date d'envoi de la déclaration (48 h, dimanches et fériés non compris). Vide : à déclarer."}>
                <Input name="cpamDeclaredOn" type="date" value={declaredOn} onChange={(ev) => setDeclaredOn(ev.target.value)} />
              </Field>
              {declaredOn && (
                <Field name="reservesOn" label="Réserves motivées adressées le" hint="Facultatives : 10 jours francs après la déclaration.">
                  <Input name="reservesOn" type="date" defaultValue={e.reservesOn ?? ''} />
                </Field>
              )}
            </FormRow>
          )}
        </>
      )}
    </>
  );
}
