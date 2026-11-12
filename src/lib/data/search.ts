import 'server-only';
import { isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { actionHref, parseActionFilters } from '../action-rules';
import { canEdit, canSee } from '../domain';
import { documentHref } from '../rules/documents';
import { dgiHref, canReadDgi } from '../rules/dgi';
import { engineeringHref } from '../rules/engineering';
import { safetyTalkHref } from '../rules/safety-talks';
import { SEARCH_LIMIT, rankSearch, type SearchItem } from '../rules/search';
import { getSession, siteFilter } from '../session';
import { loadActionPlan } from './actions';
import { loadAudits } from './audits';
import { loadChanges } from './changes';
import { loadDocuments } from './documents';
import { loadEmergencies } from './emergencies';
import { loadEngineering } from './engineering';
import { loadVisibleEvents } from './events';
import { loadRows } from './prevention-rows';
import { loadProcessSafetyStudies } from './process-safety';
import { loadRisks } from './risks';
import { loadSafetyTalks } from './safety-talks';
import { loadSelfAssessments } from './self-assessment';
import { selfAssessmentHref } from '../rules/self-assessment';
import { readPoints } from '../rules/lockouts';
import { loadWatch } from './watch';

// Recherche globale (TDB-18) : chaque module est cherché dans les éléments que charge son propre écran pour la personne
// connectée — même site sélectionné, même périmètre, mêmes droits (Salarié : ses signalements et ses actions, le DUERP ;
// maladies professionnelles et documents confidentiels selon les mêmes règles que les écrans). Aucune donnée de santé n'est
// cherchée : seuls la référence et l'intitulé d'un événement (l'intitulé d'un AT ne porte pas la lésion, celui d'une MP est
// imposé). Registre des dangers graves et imminents : lecteurs du registre seulement.

export type SearchGroup = {
  key: string; label: string; icon: string;
  items: SearchItem[];
  total: number;
  /** Recherche propre de l'écran (?q=), quand il en a une. */
  moreHref: string | null;
};

type Module = { key: string; label: string; icon: string; more?: (q: string) => string; load: () => Promise<SearchItem[]> };

const enc = encodeURIComponent;

/** Résultats de la recherche `q` (déjà validée par parseSearchQuery), groupés par module, modules sans résultat omis. */
export async function loadSearch(q: string): Promise<SearchGroup[]> {
  const session = await getSession();
  const { role } = session;
  const sees = (s: Parameters<typeof canSee>[1]) => canSee(role, s);
  const modules: Module[] = [];

  if (sees('events')) {
    modules.push({
      key: 'events', label: 'Événements', icon: 'ph-warning', more: (x) => `/evenements?etat=tous&q=${enc(x)}`,
      load: async () => (await loadVisibleEvents()).map((e) => ({
        ref: e.id, title: e.title, sub: e.occurredOn ? `${e.occurredOn.slice(8, 10)}/${e.occurredOn.slice(5, 7)}/${e.occurredOn.slice(0, 4)}` : null,
        href: `/evenements?etat=tous&sel=${enc(e.id)}`,
      })),
    });
  }
  if (canReadDgi(session) && sees('events')) {
    modules.push({
      key: 'dgi', label: 'Registre des dangers graves et imminents', icon: 'ph-siren',
      load: async () => {
        const [db, keep] = await Promise.all([getDb(), siteFilter('site')]);
        const rows = await db.select({ id: t.dgiNotices.id, siteId: t.dgiNotices.siteId, number: t.dgiNotices.number, workstations: t.dgiNotices.workstations, danger: t.dgiNotices.danger })
          .from(t.dgiNotices).where(isNull(t.dgiNotices.cancelledAt));
        return rows.filter((n) => keep(n.siteId)).map((n) => ({ ref: `DGI n° ${n.number}`, title: n.workstations, extra: n.danger, href: dgiHref(n.siteId, n.id) }));
      },
    });
  }
  if (sees('actions')) {
    modules.push({
      key: 'actions', label: "Plan d'actions", icon: 'ph-list-checks', more: (x) => `/actions?etat=historique&q=${enc(x)}`,
      load: async () => {
        const [current, abandoned] = await Promise.all([
          loadActionPlan(parseActionFilters({ etat: 'historique' })), loadActionPlan(parseActionFilters({ etat: 'abandonnees' })),
        ]);
        return [...current.items, ...abandoned.items].map((a) => ({ ref: a.id, title: a.label, extra: a.originRef, sub: a.statusLabel, href: actionHref(a.id) }));
      },
    });
  }
  if (sees('prevention')) {
    modules.push({
      key: 'prevention', label: 'Plans de prévention et permis', icon: 'ph-clipboard-text',
      load: async () => {
        const rows = await loadRows('site');
        const contractor = new Map(rows.contractors.map((c) => [c.id, c.name]));
        const plans = rows.plans.map((p) => ({ ref: p.id, title: p.title, extra: `${contractor.get(p.contractorId) ?? ''} ${p.location}`, sub: contractor.get(p.contractorId) ?? null, href: `/prevention?plan=${enc(p.id)}` }));
        const permits = rows.permits.map((p) => ({ ref: p.id, title: p.description, extra: `${p.location} ${p.performer}`, sub: p.location, href: `/prevention?onglet=permis&permis=${enc(p.id)}` }));
        const contractors = rows.contractors.map((c) => ({ ref: c.id, title: c.name, extra: c.trade, sub: c.trade, href: `/prevention?onglet=entreprises&entreprise=${enc(c.id)}` }));
        // PRV-22 : consignations des permis du site sélectionné (fiche du permis).
        const lockouts = rows.permits.flatMap((p) => rows.lockoutsOf(p.id).map((l) => ({
          ref: l.id, title: `Consignation · ${l.equipment}`, extra: `${p.id} ${readPoints(l.points).map((x) => `${x.label} ${x.device}`).join(' ')}`, sub: p.id, href: `/prevention?onglet=permis&permis=${enc(p.id)}`,
        })));
        return [...plans, ...permits, ...contractors, ...lockouts];
      },
    });
    modules.push({
      key: 'talks', label: 'Causeries sécurité', icon: 'ph-chats-circle',
      load: async () => ((await loadSafetyTalks())?.talks ?? []).map((x) => ({ ref: x.id, title: x.theme, extra: x.animator, sub: x.animator, href: safetyTalkHref(x.id) })),
    });
  }
  if (sees('risks')) {
    modules.push({
      key: 'risks', label: 'Évaluation des risques', icon: 'ph-shield-check',
      load: async () => {
        const [risks, emergencies, studies] = await Promise.all([loadRisks(), loadEmergencies({ employee: role === 'Salarié' }), loadProcessSafetyStudies()]);
        const unit = new Map(risks.units.map((u) => [u.id, u.label]));
        return [
          ...risks.risks.map((r) => ({ ref: `Risque ${r.id}`, title: `${r.hazard} — ${r.situation}`, extra: unit.get(r.unitId) ?? '', sub: unit.get(r.unitId) ?? null, href: `/risques?risque=${r.id}` })),
          ...emergencies.situations.map((s) => ({ ref: `Situation ${s.id}`, title: s.label, extra: s.scenario, href: `/risques?vue=urgences&situation=${s.id}` })),
          // Études de sécurité des procédés : jamais pour le Salarié (vue fermée, loadProcessSafetyStudies le refuse déjà).
          ...[...studies.studies, ...studies.cancelled].map((s) => ({ ref: s.id, title: `${s.typeLabel} · ${s.milestoneLabel}`, extra: `${s.scope} ${s.capexCode ?? ''} ${s.projectCode ?? ''}`, href: `/risques?vue=etudes&etude=${enc(s.id)}` })),
        ];
      },
    });
  }
  if (sees('watch')) {
    modules.push({
      key: 'watch', label: 'Veille et contrôles', icon: 'ph-scales', more: (x) => `/veille?q=${enc(x)}`,
      load: async () => {
        const w = await loadWatch();
        return [
          ...w.requirements.map((r) => ({ ref: `Exigence ${r.id}`, title: r.text, extra: `${r.summary} ${r.domain}`, sub: r.domain, href: `/veille?exigence=${r.id}` })),
          ...w.controls.map((c) => ({ ref: c.equipmentCode ?? `Contrôle ${c.id}`, title: `${c.controlType} · ${c.equipment}`, extra: c.organization, sub: c.status, href: `/veille?onglet=controles&controle=${c.id}` })),
        ];
      },
    });
  }
  if (sees('audits')) {
    modules.push({
      key: 'audits', label: 'Audits et certifications', icon: 'ph-certificate',
      load: async () => {
        const [a, changes] = await Promise.all([loadAudits({}), loadChanges()]);
        return [
          ...a.plan.map((p) => ({ ref: `Audit ${p.year}-${p.id}`, title: p.detail ?? p.label, extra: `${p.track} ${p.auditorLabel}`, sub: p.track, href: `/audits?annee=${p.year}&element=${p.id}` })),
          ...a.auditGroups.flatMap((g) => g.findings).map((f) => ({ ref: `Constat ${f.id}`, title: f.text, extra: `${f.clause ?? ''} ${f.audit}`, href: `/audits?constat=${f.id}` })),
          ...changes.rows.map((c) => ({ ref: c.id, title: c.title, extra: c.description, sub: c.statusLabel, href: `/audits?changement=${enc(c.id)}#changements` })),
          // AUD-40 : campagnes d'auto-évaluation visibles (loadSelfAssessments, comme la vue de l'écran).
          ...((await loadSelfAssessments())?.summaries ?? []).map((x) => ({ ref: x.id, title: `Auto-évaluation ${x.standardLabel} · ${x.site}`, extra: `${x.scope} ${x.assessor}`, sub: x.statusLabel, href: selfAssessmentHref(x.id) })),
        ];
      },
    });
  }
  if (sees('docs')) {
    modules.push({
      key: 'docs', label: 'Documents maîtrisés', icon: 'ph-files', more: (x) => `/documents?q=${enc(x)}`,
      // Registre tel que l'écran le montre au rôle (documents en vigueur pour la consultation seule ; confidentialité confReadable).
      load: async () => (await loadDocuments({ readOnly: !canEdit(role, 'docs') })).rows
        .map((d) => ({ ref: d.id, title: d.title, extra: d.aliases.join(' '), sub: d.typeLabel, href: documentHref(d.id) })),
    });
  }
  if (sees('engineering')) {
    modules.push({
      key: 'engineering', label: 'Modifications techniques', icon: 'ph-git-branch',
      load: async () => {
        const e = await loadEngineering();
        return [
          ...e.ecos.map((o) => ({ ref: o.id, title: o.title, sub: o.statusLabel, href: engineeringHref(o.id) })),
          ...e.ecrs.map((r) => ({ ref: r.id, title: r.title, extra: r.partRef ?? '', sub: r.statusLabel, href: engineeringHref(r.id) })),
        ];
      },
    });
  }

  const groups = await Promise.all(modules.map(async (m): Promise<SearchGroup> => {
    const { items, total } = rankSearch(await m.load(), q, SEARCH_LIMIT);
    return { key: m.key, label: m.label, icon: m.icon, items, total, moreHref: total > items.length && m.more ? m.more(q) : null };
  }));
  return groups.filter((g) => g.total > 0);
}
