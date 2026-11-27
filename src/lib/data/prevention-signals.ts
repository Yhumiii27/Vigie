import 'server-only';
import { composed, titled, type Msg } from '@/i18n/msg';
import { cache } from 'react';
import {
  fmtLocalRange, isFullySigned, isMandatory, isPlanEnded, nextPeriodicMeeting, permitDays, permitState, toParisLocal,
  type PermitType,
} from '@/lib/rules/prevention';
import { addDays, fmtDate } from '../dates';
import { byUrgency, type TodoItem, type Tone } from '../domain';
import { TODO_HORIZON_DAYS } from '../horizons';
import { gapSummary, loadRows } from './prevention-rows';
import { loadQhseLeads } from './leads';
import { readPlanWorkers } from './plan-workers';
import { lockoutSignal } from '@/lib/rules/lockouts';

// Échéances de la prévention et indicateur de la veille (R. 4512-6) — QUA-26 : extrait de src/lib/data/prevention.ts.

/**
 * Indicateur calculé pour la veille réglementaire (exigence rattachée à l'indicateur « prevention », R. 4512-6, VEI-07) :
 * interventions sans plan signé en cours et écarts passés sur 12 mois (PRV-01), sur tout le périmètre de la personne
 * (VEI-06 : l'exigence vaut pour l'entreprise, quel que soit le site sélectionné), même calcul que l'écran. gapCount compte
 * les deux ; l'évaluation de conformité reste un jugement du pilote, affiché à côté.
 */
export const loadPreventionCompliance = cache(async (): Promise<{
  gapCount: number; currentGapCount: number; pastGapCount: number; label: string; text: Msg; tone: Tone; href: string;
}> => {
  const { gapCount: current, pastGapCount: past } = gapSummary(await loadRows('perimeter'));
  const pastText: Msg = past > 1 ? { en: '{n} past gaps over 12 months', values: { n: past } } : { en: '{n} past gap over 12 months', values: { n: past } };
  const currentText: Msg = current > 1 ? { en: '{n} works without a signed plan', values: { n: current } } : { en: '{n} work without a signed plan', values: { n: current } };
  const { label, text } = current
    ? (past ? composed('{current} · {past}', { current: currentText, past: pastText }) : composed('{current}', { current: currentText }))
    : past ? composed('No work in progress without a signed plan · {past}', { past: pastText }) : composed('No R. 4512-6 gap over 12 months');
  return {
    gapCount: current + past,
    currentGapCount: current,
    pastGapCount: past,
    label, text,
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
      todo.push({ date: now, dueOn: p.startOn, kind, tone: 'danger', ...titled('{id} · work in progress without a signed plan — {title}', { id: p.id, title: p.title }), who, href, ownerIds, siteId, overdue: true });
      return;
    }
    if (p.endOn < now) {
      todo.push({ date: p.endOn, dueOn: p.endOn, kind, tone: 'warn', ...titled('{id} · period ended, plan to close — {title}', { id: p.id, title: p.title }), who, href, ownerIds, siteId, overdue: true });
      return;
    }
    // PRV-17 : inspection ou réunion périodique de coordination due (périodicité du plan) pendant l'intervention ;
    // responsable du plan, sinon responsable QHSE du site.
    const meeting = nextPeriodicMeeting(p, meetingsOf(p.id).map((m) => ({ heldOn: m.heldOn, cancelled: !!m.cancelledAt })), now);
    if (meeting && meeting.dueOn <= horizon) {
      const to = p.ownerId ? { who, ownerIds: [p.ownerId] } : { who: [contractorName(p.contractorId), leads.forSite(p.siteId).who].filter(Boolean).join(' · '), ownerIds: leads.forSite(p.siteId).ownerIds };
      todo.push({
        date: meeting.late ? now : meeting.dueOn, dueOn: meeting.dueOn, kind, tone: meeting.late ? 'danger' : 'warn', overdue: meeting.late || undefined,
        ...(meeting.late
          ? titled('{id} · periodic coordination inspection or meeting overdue since {date} — {title}', { id: p.id, date: fmtDate(meeting.dueOn), title: p.title })
          : titled('{id} · periodic coordination inspection or meeting before {date} — {title}', { id: p.id, date: fmtDate(meeting.dueOn), title: p.title })),
        href, ...to, siteId, key: `pp-reunion|${p.id}`,
      });
    }
    const toSignBeforeStart = p.startOn > now && p.startOn <= horizon && isMandatory(p, ruleOf(p.siteId)) && !isFullySigned(p);
    if (toSignBeforeStart) {
      todo.push({ date: p.startOn, dueOn: p.startOn, kind, tone: 'warn', ...titled('{id} · plan to sign before the start — {title}', { id: p.id, title: p.title }), who, href, ownerIds, siteId });
    } else if (!isFullySigned(p) && p.inspectionOn && p.inspectionOn > now && p.inspectionOn <= horizon) {
      todo.push({ date: p.inspectionOn, dueOn: p.inspectionOn, kind, tone: 'neutral', ...titled('{id} · joint inspection planned on {date} — {title}', { id: p.id, date: fmtDate(p.inspectionOn), title: p.title }), who, href, ownerIds, siteId });
    }
  });
  // PRV-23 : intervenants sans accueil sécurité à jour sur un plan en cours ou qui démarre sous l'horizon, au responsable QHSE
  // du site (avertissement, jamais un blocage) ; Cursus indisponible : rien (pas de fausse alerte, la fiche le dit).
  const soon = plans.filter((p) => !isPlanEnded(p) && p.endOn >= now && p.startOn <= horizon);
  const { workers } = await readPlanWorkers(rows.db, now, soon.map((p) => p.id));
  soon.forEach((p) => {
    const missing = workers.filter((w) => w.planId === p.id && w.check.induction === 'missing');
    if (!missing.length) return;
    const to = leads.forSite(p.siteId);
    const started = p.startOn <= now;
    todo.push({
      date: started ? now : p.startOn, dueOn: p.startOn, kind: 'Plan de prévention', tone: started ? 'danger' : 'warn', overdue: started || undefined,
      ...(missing.length > 1
        ? titled('{id} · {n} workers without an up-to-date safety induction — {title}', { id: p.id, n: missing.length, title: p.title })
        : titled('{id} · {n} worker without an up-to-date safety induction — {title}', { id: p.id, n: missing.length, title: p.title })),
      who: [contractorName(p.contractorId), to.who].filter(Boolean).join(' · '), ownerIds: to.ownerIds, siteId: p.siteId,
      href: `/prevention?plan=${p.id}`, key: `pp-accueil|${p.id}`,
    });
  });
  permits.forEach((p) => {
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    const typeText: Msg = type === 'essai' ? { en: 'test permit#lower' } : { en: 'hot work permit#lower' };
    const who = [contractorName(p.contractorId), owner(p.issuerId)].filter(Boolean).join(' · ');
    const href = `/prevention?onglet=permis&permis=${p.id}`;
    const ownerIds = p.issuerId ? [p.issuerId] : undefined;
    const siteId = p.siteId;
    // Permis en écart : compté à part, sauf s'il est rattaché à un plan déjà en écart (échéance du plan).
    if (gaps.permitGaps.has(p.id)) {
      if (!gaps.countedPermitGaps.has(p.id)) return;
      const what: Msg = p.status === 'demande' ? { en: 'request for a {type}', values: { type: typeText } } : typeText;
      todo.push({ date: now, kind: 'Permis', tone: 'danger', ...titled('{id} · {what} of an external company without a signed prevention plan — {location}', { id: p.id, what, location: p.location }), who, href, ownerIds, siteId, overdue: true });
      return;
    }
    if (permitState(p, nowMs) === 'expire') {
      todo.push({
        date: now, kind: 'Permis', tone: 'danger',
        ...(p.status === 'demande'
          ? titled('{id} · request for a {type} ended, never delivered — {location}', { id: p.id, type: typeText, location: p.location })
          : titled('{id} · {type} expired not closed — {location}', { id: p.id, type: typeText, location: p.location })),
        who, href, ownerIds, siteId, overdue: true,
      });
      return;
    }
    const { from } = permitDays(p);
    if (p.status === 'demande' && from <= horizon) {
      const validity = fmtLocalRange(toParisLocal(p.validFrom), toParisLocal(p.validTo));
      todo.push({ date: from > now ? from : now, dueOn: from, kind: 'Permis', tone: 'warn', ...titled('{id} · {type} to deliver (validity {validity}) — {location}', { id: p.id, type: typeText, validity, location: p.location }), who, href, ownerIds, siteId });
    }
  });

  // PRV-22 : consignation posée ou préparée et non vérifiée alors que la validité du permis a commencé ; consignation non
  // levée à la fin du permis (validité échue, clos ou annulé) — au responsable du permis (délivreur), sinon au responsable
  // QHSE du site.
  permits.forEach((p) => {
    rows.lockoutsOf(p.id).forEach((l) => {
      const kind = lockoutSignal(l, p, nowMs);
      if (!kind) return;
      const to = p.issuerId ? { who: owner(p.issuerId), ownerIds: [p.issuerId] } : leads.forSite(p.siteId);
      const start = toParisLocal(p.validFrom).slice(0, 10);
      const validEnd = toParisLocal(p.validTo).slice(0, 10);
      const closedOn = p.closedAt ? toParisLocal(p.closedAt).slice(0, 10) : null;
      const end = closedOn && closedOn < validEnd ? closedOn : validEnd;
      todo.push({
        date: now, dueOn: kind === 'verification' ? start : end, kind: 'Permis', tone: 'danger', overdue: true,
        ...(kind === 'verification'
          ? titled('{id} · lockout not verified, permit {permit} within its validity — {equipment}', { id: l.id, permit: p.id, equipment: l.equipment })
          : titled('{id} · lockout not lifted at the end of the permit {permit} — {equipment}', { id: l.id, permit: p.id, equipment: l.equipment })),
        who: [contractorName(p.contractorId), to.who].filter(Boolean).join(' · '), ownerIds: to.ownerIds, siteId: p.siteId,
        href: `/prevention?onglet=permis&permis=${p.id}`, key: `consignation-${kind}|${l.id}`,
      });
    });
  });

  return { badge: todo.length, todo: todo.sort(byUrgency) };
});
