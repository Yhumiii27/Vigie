import type { Metadata } from 'next';
import Link from 'next/link';
import { CertificationCards } from '@/components/audits/CertificationCards';
import { ContextCard } from '@/components/audits/ContextCard';
import { ChangesCard } from '@/components/audits/ChangesCard';
import { ObjectivesCard } from '@/components/audits/ObjectivesCard';
import { FindingsCard } from '@/components/audits/FindingsCard';
import { ProgramTimeline } from '@/components/audits/ProgramTimeline';
import { PageHeader } from '@/components/PageHeader';
import { ReviewCard } from '@/components/review/ReviewCard';
import { Aside, MissingNotice, SegLinks, ToneTag } from '@/components/ui';
import { isoWeek, monthName, monthOf, yearOf } from '@/lib/dates';
import { canCreateAction } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { ALL_SITES, AUDIT_KINDS, AUDIT_KIND_KEYS, SCREENS, canApprove, canEdit } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadAudits } from '@/lib/data/audits';
import { loadContext } from '@/lib/data/context';
import { loadChanges } from '@/lib/data/changes';
import { missingDetail } from '@/lib/url-state';
import { loadObjectives } from '@/lib/data/objectives';
import { loadFormOptions } from '@/lib/data/options';
import { SelfAssessmentView } from '@/components/audits/SelfAssessmentView';
import { isQhse } from '@/lib/action-rules';
import { latestAssessments, loadAssessmentCatalogue, loadSelfAssessments } from '@/lib/data/self-assessment';
import { SELF_ASSESSMENT_VIEW, fmtDelta, isAssessmentStandard, rateTone, selfAssessmentHref } from '@/lib/rules/self-assessment';
import { currentSiteId } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.audits.title };

/** Vues de l'écran : programme et revue de direction, auto-évaluation par référentiel (AUD-40). */
function ViewNav({ on }: { on: 'programme' | 'auto' }) {
  return (
    <SegLinks options={[
      { href: '/audits', label: 'Programme et revue de direction', on: on === 'programme' },
      { href: selfAssessmentHref(), label: 'Auto-évaluation ISO', on: on === 'auto' },
    ]} />
  );
}

export default async function AuditsPage({ searchParams }: PageProps<'/audits'>) {
  const session = await guard('audits');
  const sp = await searchParams;
  // AUD-40 : auto-évaluation par référentiel (?vue=auto-evaluation&campagne=AE-001, ?norme=iso45001).
  if (sp.vue === SELF_ASSESSMENT_VIEW) {
    const campagne = typeof sp.campagne === 'string' ? sp.campagne : undefined;
    const [data, catalogue, options] = await Promise.all([loadSelfAssessments({ open: campagne }), loadAssessmentCatalogue(), loadFormOptions()]);
    const edit = canEdit(session.role, 'audits');
    const canCreate = edit && canCreateAction(session.role);
    const sites = edit ? [...(options.allSites ? [[ALL_SITES, 'Tous les sites'] as const] : []), ...options.sites] : [];
    return (
      <>
        <PageHeader title={SCREENS.audits.title} sub="Auto-évaluation par référentiel (ISO 45001, ISO 14001, ISO 9001)" />
        <div className="vg-page">
          <ViewNav on="auto" />
          {data && (
            <SelfAssessmentView data={data} catalogue={catalogue ?? []} canCatalogue={edit && isQhse(session.role)} canCreate={canCreate}
              actionOptions={canCreate ? { people: options.people, sites: options.sites, today: data.now } : { people: [], sites: [], today: data.now }}
              sites={sites} missing={data.missing} standard={isAssessmentStandard(sp.norme) ? sp.norme : undefined} />
          )}
        </div>
      </>
    );
  }
  const [data, options] = await Promise.all([
    loadAudits({ year: sp.annee, element: sp.element, constat: sp.constat }),
    loadFormOptions(),
  ]);
  const { now, certs, year, yearOptions, tracks, hiddenTracks, renewFrom, allTracks, plan, cancelledPlan, planFindings, auditGroups, cancelledFindings, auditOptions, openElement, openFinding, missingElement, missingFinding } = data;
  // AUD-13, CNF-05 : objectifs mesurables de l'année du programme, contexte du système de management.
  // CNF-11 : demandes de changement (site sélectionné ; communes à l'entreprise sur tous les sites).
  const [objectives, context, changes, selected] = await Promise.all([loadObjectives(year), loadContext(), loadChanges(), currentSiteId()]);
  // AUD-40 : dernière campagne clôturée de chaque référentiel (site sélectionné et entreprise).
  const assessments = await latestAssessments({ site: selected, allowed: session.allowedSiteIds, asOf: now });
  const changeParam = typeof sp.changement === 'string' ? sp.changement : undefined;
  // AUD-19 : lien profond vers un référentiel (échéances de certification, indicateur de la veille) ; site sélectionné et
  // périmètre (certs déjà filtrés, AUD-22), sinon bandeau « introuvable ».
  const certParam = typeof sp.referentiel === 'string' ? sp.referentiel : undefined;
  const openCert = certParam && certs.some((c) => c.id === certParam) ? certParam : undefined;
  const openChange = changeParam && changes.rows.some((c) => c.id === changeParam) ? changeParam : undefined;
  // Saisie : animateur QHSE et direction ; consultation pour le chef de service et le chef de projet (AUD-02), qui ouvrent
  // en lecture les éléments dont ils sont responsables (?element=).
  const edit = canEdit(session.role, 'audits');
  const approve = canApprove(session.role);
  const nowYear = yearOf(now);
  const curMonth = nowYear === year ? monthOf(now) : nowYear > year ? 13 : 0;
  // Listes des formulaires (personnes, sites) : rôles qui saisissent seulement, hors de la charge de la page en consultation.
  // Création d'action : service QHSE seulement (ACT-22) ; `today` : date du jour du serveur.
  const canCreate = edit && canCreateAction(session.role);
  const actionOptions: ActionFormOptions = canCreate
    ? { people: options.people, sites: options.sites, today: now }
    : { people: [], sites: [], today: now };
  const certOptions = certs.map((c) => [c.id, c.standard] as const);
  // AUD-22, AUD-27 : sites (« Tous les sites » en tête quand le périmètre est complet) et personnes des formulaires du
  // programme, des constats et des certifications — rôles qui saisissent seulement.
  const siteChoices = [...(options.allSites ? [[ALL_SITES, 'Tous les sites'] as const] : []), ...options.sites];
  const planOptions = edit ? { people: options.people, sites: siteChoices } : { people: [], sites: [] };
  const closeHref = `/audits?annee=${year}`;

  // D08-5 : filtre du programme par type d'audit (?type=), valeur inconnue ignorée ; l'année et le type se combinent.
  const auditType = AUDIT_KIND_KEYS.find((k) => k === sp.type);
  const shownPlan = auditType ? plan.filter((p) => p.auditKind === auditType) : plan;
  const typeHref = (k?: string) => `/audits?annee=${year}${k ? `&type=${k}` : ''}`;
  const typeNav = (
    <SegLinks size={11} pad="3px 8px" options={[
      { href: typeHref(), label: 'Tous types', on: !auditType },
      ...AUDIT_KIND_KEYS.filter((k) => plan.some((p) => p.auditKind === k)).map((k) => ({ href: typeHref(k), label: AUDIT_KINDS[k].short, on: auditType === k })),
    ]} />
  );
  const yearNav = yearOptions.length > 1 && (
    <SegLinks size={11} pad="3px 8px" options={yearOptions.map((y) => ({ href: `/audits?annee=${y}`, label: String(y), on: y === year }))} />
  );
  const period = curMonth >= 1 && curMonth <= 12 ? `Semaine ${isoWeek(now)} · ${monthName(curMonth)} en cours` : curMonth === 0 ? 'Programme prévisionnel' : 'Année écoulée';

  return (
    <>
      <PageHeader title={SCREENS.audits.title} sub={`Programme ${year} et revue de direction`} />
      <div className="vg-page">
        <ViewNav on="programme" />
        {missingElement && <MissingNotice text="Élément du programme d'audit introuvable pour l'année affichée." closeHref={closeHref} />}
        {missingFinding && <MissingNotice text="Constat d'audit introuvable." closeHref={closeHref} />}
        {missingDetail(sp.changement, !!openChange) && <MissingNotice text="Demande de changement introuvable ou hors du site sélectionné." closeHref={closeHref} />}
        {missingDetail(sp.referentiel, !!openCert) && <MissingNotice text="Référentiel introuvable ou hors du site sélectionné." closeHref={closeHref} />}
        <CertificationCards key={openCert ?? 'certs'} certs={certs} canApprove={approve} sites={approve ? siteChoices : []} initialId={openCert} closeHref={closeHref} />

        {assessments.length > 0 && (
          <div className="card" style={{ gap: 6 }}>
            <div className="card-kicker">Auto-évaluation par référentiel</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
              {assessments.map((a) => (
                <Link key={a.id} href={selfAssessmentHref(a.id)} className="vg-link" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                  {a.standard} · {a.site}
                  <ToneTag tone={rateTone(a.rate)}>{a.rate == null ? '—' : `${a.rate} %`}</ToneTag>
                  {a.previousOn && <span style={{ color: 'var(--vg-text-muted)' }}>{fmtDelta(a.delta)}</span>}
                </Link>
              ))}
            </div>
          </div>
        )}

        <ObjectivesCard data={objectives} canEdit={edit}
          options={edit ? { people: options.people, sites: options.sites, allSites: options.allSites } : { people: [], sites: [], allSites: false }} />
        <ContextCard data={context} canEdit={edit} />
        <ChangesCard key={openChange ?? 'changes'} rows={changes.rows} canEdit={edit} canApprove={approve} versions={changes.versions} today={now}
          options={edit ? { people: options.people, sites: siteChoices } : { people: [], sites: [] }} initialId={openChange} closeHref={closeHref} />

        <ProgramTimeline key={openElement ?? 'prog'} year={year} curMonth={curMonth} tracks={tracks} allTracks={allTracks} items={shownPlan} cancelled={cancelledPlan}
          findings={planFindings} certs={certOptions} auditOptions={auditOptions} yearOptions={yearOptions} canEdit={edit} canCreate={canCreate} options={actionOptions}
          planOptions={planOptions} hiddenTracks={hiddenTracks} renewFrom={renewFrom}
          initialId={openElement} closeHref={closeHref} aside={<><Aside>{period}</Aside>{typeNav}{yearNav}</>} />

        {/* Pas de `key` liée au lien profond : la fermeture retire ?constat= de l'URL sans remonter la carte ni changer de groupe. */}
        <FindingsCard groups={auditGroups} cancelled={cancelledFindings} auditOptions={auditOptions} canEdit={edit}
          canCreate={canCreate} options={actionOptions} initialFindingId={openFinding} closeHref={closeHref} planOptions={planOptions} tracks={allTracks}
          initialKind={typeof sp.nature === 'string' ? sp.nature : undefined} />

        <div id="revue" style={{ scrollMarginTop: 16 }}>
          <ReviewCard searchParams={sp} />
        </div>
      </div>
    </>
  );
}
