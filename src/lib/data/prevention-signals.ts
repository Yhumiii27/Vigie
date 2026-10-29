import 'server-only';
import { cache } from 'react';
import {
  PERMIT_TYPES, fmtLocalRange, isFullySigned, isMandatory, isPlanEnded, nextPeriodicMeeting, permitDays, permitState, toParisLocal,
  type PermitType,
} from '@/components/prevention/model';
import { addDays, fmtDate } from '../dates';
import { byUrgency, type TodoItem, type Tone } from '../domain';
import { TODO_HORIZON_DAYS } from '../horizons';
import { gapSummary, loadRows, plural } from './prevention-rows';
import { loadQhseLeads } from './leads';

// Échéances de la prévention et indicateur de la veille (R. 4512-6) — QUA-26 : extrait de src/lib/data/prevention.ts.

/**
 * Indicateur calculé pour la veille réglementaire (exigence rattachée à l'indicateur « prevention », R. 4512-6, VEI-07) :
 * interventions sans plan signé en cours et écarts passés sur 12 mois (PRV-01), sur tout le périmètre de la personne
 * (VEI-06 : l'exigence vaut pour l'entreprise, quel que soit le site sélectionné), même calcul que l'écran. gapCount compte
 * les deux ; l'évaluation de conformité reste un jugement du pilote, affiché à côté.
 */
export const loadPreventionCompliance = cache(async (): Promise<{
  gapCount: number; currentGapCount: number; pastGapCount: number; label: string; tone: Tone; href: string;
}> => {
  const { gapCount: current, pastGapCount: past } = gapSummary(await loadRows('perimeter'));
  const pastLabel = `${plural(past, 'écart passé', 'écarts passés')} sur 12 mois`;
  return {
    gapCount: current + past,
    currentGapCount: current,
    pastGapCount: past,
    label: current
      ? `${plural(current, 'intervention sans plan signé', 'interventions sans plan signé')}${past ? ` · ${pastLabel}` : ''}`
      : past ? `Aucune intervention en cours sans plan signé · ${pastLabel}` : 'Aucun écart R. 4512-6 sur 12 mois',
    tone: current ? 'danger' : past ? 'warn' : 'ok',
    href: '/prevention',
  };
});

/**
 * Échéances du domaine (tableau de bord, notifications, badge), sur tous les sites du périmètre (TDB-05, siteId du plan
 * ou du permis) ; plans clos ou annulés exclus :
 * - plans : intervention en cours sans plan signé (écart) ; plan obligatoire à signer avant un démarrage sous l'horizon ;
 *   période échue, plan à clore ; sinon inspection commune prévue sous l'horizon pour un plan non signé ;
 * - permis : écart (entreprise extérieure sans plan signé, compté avec son plan s'il est lui-même en écart) ;
 *   permis expiré non clos ou demande échue ; demande à délivrer dont la validité commence sous l'horizon.
 * Les échéances ouvrent directement la fiche concernée (/prevention?plan=… ou ?onglet=permis&permis=…).
 * Les écarts R. 4512-6 passés (PRV-01 : plan signé après le début, intervention réalisée sans plan signé) restent des
 * indicateurs (écran, veille, revue de direction) : ni échéance ni badge ; aucune action QSE n'est exigée à la clôture
 * (actions immédiates hors actions QSE, réponses du service QHSE du 15/10/2026).
 */
export const loadPreventionSignals = cache(async (): Promise<{ badge: number; todo: TodoItem[] }> => {
  const [rows, leads] = await Promise.all([loadRows('perimeter'), loadQhseLeads()]);
  const { now, nowMs, people, contractors, plans, permits, ruleOf, meetingsOf } = rows;
  const { gaps } = gapSummary(rows);
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const contractorName = (id: string | null) => (id ? contractors.find((c) => c.id === id)?.name ?? id : 'Intervention interne');
  const owner = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const todo: TodoItem[] = [];

  plans.forEach((p) => {
    if (isPlanEnded(p)) return;
    const href = `/prevention?plan=${p.id}`;
    const who = [contractorName(p.contractorId), owner(p.ownerId)].filter(Boolean).join(' · ');
    const ownerIds = p.ownerId ? [p.ownerId] : undefined;
    const kind = 'Plan de prévention';
    const siteId = p.siteId;
    if (gaps.planGaps.has(p.id)) {
      todo.push({ date: now, dueOn: p.startOn, kind, tone: 'danger', title: `${p.id} · intervention en cours sans plan signé — ${p.title}`, who, href, ownerIds, siteId, overdue: true });
      return;
    }
    if (p.endOn < now) {
      todo.push({ date: p.endOn, dueOn: p.endOn, kind, tone: 'warn', title: `${p.id} · période échue, plan à clore — ${p.title}`, who, href, ownerIds, siteId, overdue: true });
      return;
    }
    // PRV-17 : inspection ou réunion périodique de coordination due (périodicité du plan) pendant l'intervention ;
    // responsable du plan, sinon responsable QHSE du site.
    const meeting = nextPeriodicMeeting(p, meetingsOf(p.id).map((m) => ({ heldOn: m.heldOn, cancelled: !!m.cancelledAt })), now);
    if (meeting && meeting.dueOn <= horizon) {
      const to = p.ownerId ? { who, ownerIds: [p.ownerId] } : { who: [contractorName(p.contractorId), leads.forSite(p.siteId).who].filter(Boolean).join(' · '), ownerIds: leads.forSite(p.siteId).ownerIds };
      todo.push({
        date: meeting.late ? now : meeting.dueOn, dueOn: meeting.dueOn, kind, tone: meeting.late ? 'danger' : 'warn', overdue: meeting.late || undefined,
        title: `${p.id} · inspection ou réunion périodique de coordination ${meeting.late ? `en retard depuis le ${fmtDate(meeting.dueOn)}` : `avant le ${fmtDate(meeting.dueOn)}`} — ${p.title}`,
        href, ...to, siteId, key: `pp-reunion|${p.id}`,
      });
    }
    const toSignBeforeStart = p.startOn > now && p.startOn <= horizon && isMandatory(p, ruleOf(p.siteId)) && !isFullySigned(p);
    if (toSignBeforeStart) {
      todo.push({ date: p.startOn, dueOn: p.startOn, kind, tone: 'warn', title: `${p.id} · plan à signer avant le démarrage — ${p.title}`, who, href, ownerIds, siteId });
    } else if (!isFullySigned(p) && p.inspectionOn && p.inspectionOn > now && p.inspectionOn <= horizon) {
      todo.push({ date: p.inspectionOn, dueOn: p.inspectionOn, kind, tone: 'neutral', title: `${p.id} · inspection commune prévue le ${fmtDate(p.inspectionOn)} — ${p.title}`, who, href, ownerIds, siteId });
    }
  });
  permits.forEach((p) => {
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    const label = PERMIT_TYPES[type].label.toLowerCase();
    const who = [contractorName(p.contractorId), owner(p.issuerId)].filter(Boolean).join(' · ');
    const href = `/prevention?onglet=permis&permis=${p.id}`;
    const ownerIds = p.issuerId ? [p.issuerId] : undefined;
    const siteId = p.siteId;
    // Permis en écart : compté à part, sauf s'il est rattaché à un plan déjà en écart (échéance du plan).
    if (gaps.permitGaps.has(p.id)) {
      if (!gaps.countedPermitGaps.has(p.id)) return;
      const what = p.status === 'demande' ? `demande de ${label}` : label;
      todo.push({ date: now, kind: 'Permis', tone: 'danger', title: `${p.id} · ${what} d'une entreprise extérieure sans plan de prévention signé — ${p.location}`, who, href, ownerIds, siteId, overdue: true });
      return;
    }
    if (permitState(p, nowMs) === 'expire') {
      todo.push({
        date: now, kind: 'Permis', tone: 'danger',
        title: p.status === 'demande'
          ? `${p.id} · demande de ${label} échue, jamais délivrée — ${p.location}`
          : `${p.id} · ${label} expiré non clos — ${p.location}`,
        who, href, ownerIds, siteId, overdue: true,
      });
      return;
    }
    const { from } = permitDays(p);
    if (p.status === 'demande' && from <= horizon) {
      const validity = fmtLocalRange(toParisLocal(p.validFrom), toParisLocal(p.validTo));
      todo.push({ date: from > now ? from : now, dueOn: from, kind: 'Permis', tone: 'warn', title: `${p.id} · ${label} à délivrer (validité ${validity}) — ${p.location}`, who, href, ownerIds, siteId });
    }
  });

  return { badge: todo.length, todo: todo.sort(byUrgency) };
});
