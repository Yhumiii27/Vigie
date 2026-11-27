import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BackToList, DetailFocus } from '@/components/ListDetail';
import { PageHeader } from '@/components/PageHeader';
import { Icon, MissingNotice, SegLinks, hrefWith } from '@/components/ui';
import { ArchivePanel } from '@/components/risks/ArchivePanel';
import { AddRiskButton } from '@/components/risks/RiskForm';
import { RiskTable } from '@/components/risks/RiskTable';
import { RiskMatrix } from '@/components/risks/RiskMatrix';
import { inCell, matrixRows, parseCellFilter } from '@/components/risks/matrix';
import { AddUnitButton, EditUnitButton } from '@/components/risks/UnitDialogs';
import { ExportMenu } from '@/components/risks/ExportMenu';
import { DuerpAccessNotice } from '@/components/risks/AccessNotice';
import { AccessRegister } from '@/components/risks/AccessRegister';
import { ProgramPanel } from '@/components/risks/ProgramPanel';
import { OverviewPanel } from '@/components/risks/OverviewPanel';
import { EmergencyPanel } from '@/components/risks/EmergencyPanel';
import { ProcessSafetyPanel } from '@/components/risks/ProcessSafetyPanel';
import { duerpOverview } from '@/components/risks/overview';
import { NewVersionButton, VersionsButton } from '@/components/risks/VersionDialogs';
import { fmtDate, yearOf } from '@/lib/dates';
import { PROGRAM_SHORT, RISK_ACTION_THRESHOLD, RISK_FLAGS, RISK_LEVELS, SCREENS, TONE, canApprove, canEdit, canSee, canSeeHealth, isEmployee } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadFormOptions, type FormOptions } from '@/lib/data/options';
import { offeredOr } from '@/lib/form-options';
import { loadDuerpAccessRegister, loadPreventionProgram, loadRisks } from '@/lib/data/risks';
import { loadEmergencies } from '@/lib/data/emergencies';
import { loadProcessSafetyStudies } from '@/lib/data/process-safety';
import { STUDY_REF } from '@/lib/rules/process-safety';
import { ALL_SITES } from '@/lib/session';
import { today } from '@/lib/today';
import type { ActionFormOptions } from '@/lib/action-view';
import { ARCHIVES, canonicalHref, missingDetail, wantsArchives } from '@/lib/url-state';
import { getI18n, screenMetadata } from '@/i18n/server';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';

export const generateMetadata = () => screenMetadata('risks');

/** Rôles en consultation : aucune liste de choix (ni liste du personnel) transmise à la page. */
const NO_OPTIONS: Pick<FormOptions, 'people' | 'sites' | 'projects' | 'projectsMessage'> = { people: [], sites: [], projects: [], projectsMessage: null };

export default async function RisksPage({ searchParams }: PageProps<'/risques'>) {
  const session = await guard('risks');
  const { t } = await getI18n();
  const sp = await searchParams;
  // UX-12 : ancien paramètre ?archives=1 lu puis réécrit en ?etat=archives.
  const canonical = canonicalHref('/risques', sp);
  if (canonical) redirect(canonical);
  // Saisie : encadrement autorisé à modifier le DUERP ; consultation pour le chef de projet et le salarié (DUE-01).
  const edit = canEdit(session.role, 'risks');
  const approve = edit && canApprove(session.role);
  const employee = isEmployee(session.role);
  const thisYear = yearOf(today());
  // ?programme=<année> : programme annuel de prévention (tous les rôles) ; ?registre=1 : mises à disposition (approbateurs).
  const programYear = typeof sp.programme === 'string' && /^\d{4}$/.test(sp.programme) ? Number(sp.programme) : null;
  const registerOn = approve && sp.registre === '1' && programYear == null;
  // DUE-17 : vue d'ensemble toutes unités (?vue=ensemble), tous les rôles.
  const overviewOn = sp.vue === 'ensemble' && programYear == null && !registerOn;
  // CNF-08 : situations d'urgence et exercices (?vue=urgences, fiche ?situation=<id>), tous les rôles de l'écran.
  const situationParam = typeof sp.situation === 'string' && /^\d{1,9}$/.test(sp.situation) ? Number(sp.situation) : null;
  const emergencyOn = (sp.vue === 'urgences' || situationParam != null) && programYear == null && !registerOn;
  // VG-01 à VG-05 : études de sécurité des procédés (?vue=etudes, fiche ?etude=<référence>), tous les rôles de l'écran sauf
  // le Salarié (vue masquée ; lien profond : MissingNotice).
  const studyParam = typeof sp.etude === 'string' && STUDY_REF.test(sp.etude) ? sp.etude : null;
  const studiesAsked = (sp.vue === 'etudes' || sp.etude !== undefined) && programYear == null && !registerOn && !emergencyOn;
  const studiesOn = studiesAsked && !employee;
  const [{ version, versions, nextVersion, nextUpdateOn, totals, units, risks, archivedRisks, archivedUnits, linkableActions, actionsQhse, duerpRequirement, measureOptions, zoneOptions }, options, register, program, emergencies, studies] =
    await Promise.all([
      loadRisks(),
      edit ? loadFormOptions() : Promise.resolve(NO_OPTIONS),
      approve ? loadDuerpAccessRegister() : Promise.resolve(null),
      programYear != null ? loadPreventionProgram(programYear) : Promise.resolve(null),
      emergencyOn ? loadEmergencies({ employee }) : Promise.resolve(null),
      studiesOn ? loadProcessSafetyStudies() : Promise.resolve(null),
    ]);
  // Lien profond ?risque=<id> (échéances, plan d'actions, événement) : ouvre la fiche du risque dans son unité,
  // ou dans le filtre « Archivés » pour un risque archivé (rôles qui modifient le DUERP).
  const riskParam = typeof sp.risque === 'string' ? Number(sp.risque) : null;
  const deepRisk = riskParam == null ? undefined : risks.find((r) => r.id === riskParam);
  const deepArchived = riskParam == null || deepRisk ? undefined : archivedRisks.find((r) => r.id === riskParam);
  const archives = edit && !program && !registerOn && !overviewOn && !emergencyOn && !studiesOn && (wantsArchives(sp) || !!deepArchived);
  const archivedCount = archivedRisks.length + archivedUnits.length;
  const askedUnit = typeof sp.unite === 'string' && units.some((u) => u.id === sp.unite) ? sp.unite : undefined;
  const unitId = deepRisk?.unitId ?? askedUnit ?? units[0]?.id;
  const residual = sp.mode === 'residuel';
  // UX-07 : unité choisie explicitement (lien de la liste ou lien profond) — gardée dans l'URL, la fiche remplace alors la
  // liste sur téléphone ; sans choix, la première unité (grand écran) et la liste des unités (téléphone).
  const explicitUnit = !!askedUnit || !!deepRisk;
  const overview = overviewOn && !deepRisk && !askedUnit;
  const emergency = emergencyOn && !deepRisk && !askedUnit && !!emergencies;
  const deepSituation = situationParam != null && emergencies ? [...emergencies.situations, ...emergencies.archived].find((x) => x.id === situationParam) : undefined;
  const study = studiesOn && !deepRisk && !askedUnit && !!studies;
  const deepStudy = studyParam != null && studies ? [...studies.studies, ...studies.cancelled].find((x) => x.id === studyParam) : undefined;
  const params = {
    unite: explicitUnit ? unitId : undefined, mode: residual ? 'residuel' : undefined, etat: archives ? ARCHIVES : undefined,
    programme: program ? String(program.year) : undefined, registre: registerOn ? '1' : undefined, vue: overview ? 'ensemble' : emergency ? 'urgences' : study ? 'etudes' : undefined,
  };
  // Panneau de droite : une unité, ou la vue d'ensemble, « Archivés », le programme annuel, le registre (les autres
  // paramètres sont remis à zéro).
  const panel = { etat: undefined, programme: undefined, registre: undefined, vue: undefined };
  const unitPanel = !archives && !program && !registerOn && !overview && !emergency && !study;
  const rows = risks.filter((r) => r.unitId === unitId);
  const unit = units.find((u) => u.id === unitId);
  // Site affiché (null = « Tous les sites ») : une unité rattachée à un autre site n'apparaît pas dans la liste.
  const viewSite = session.site.id === ALL_SITES ? null : { id: session.site.id, label: session.site.label };
  const defaultSiteId = viewSite?.id ?? session.siteOptions[0]?.id ?? '';
  const unitOptions = units.map(({ id, label, site }) => ({ id, label, site }));
  const showUnitSite = !viewSite && new Set(units.map((u) => u.site)).size > 1;
  const unitLabels = Object.fromEntries(units.map((u) => [u.id, u.label]));
  // Formulaire d'action : service QHSE seulement (ACT-22) ; listes vides sinon. Date du jour du serveur (VIGIE_TODAY).
  const actionOptions: ActionFormOptions = actionsQhse
    ? { people: options.people, sites: options.sites, today: today() }
    : { people: [], sites: [], today: today() };

  // DUE-16 : matrice G × P en tableau (en-têtes de ligne et de colonne, nom de chaque case) ; une case non vide filtre le
  // tableau des risques (?gravite=&probabilite=, cotation brute ou résiduelle selon ?mode=) ; un lien profond ?risque= l'emporte.
  const askedCell = deepRisk ? null : parseCellFilter(sp);
  const matrix = matrixRows(rows, residual);
  const cell = askedCell && matrix.flat().some((c) => c.g === askedCell.g && c.p === askedCell.p && c.n > 0) ? askedCell : null;
  const tableRows = rows.filter((r) => inCell(r, cell, residual));

  const high = rows.filter((r) => r.gravity * r.probability >= RISK_ACTION_THRESHOLD).length;
  const resHigh = rows.filter((r) => r.residualGravity * r.residualProbability >= RISK_ACTION_THRESHOLD).length;
  const toReview = rows.filter((r) => r.flag === 'toReview').length;
  const stats = [
    { v: rows.length, k: t('risks assessed'), color: 'var(--color-text)' },
    { v: high, k: t('high or critical (gross)'), color: high ? RISK_LEVELS[2].dot : 'var(--color-text)' },
    { v: resHigh, k: fill(t('residual ≥ {n}'), { n: RISK_ACTION_THRESHOLD }), color: resHigh ? TONE.danger.dot : TONE.ok.dot },
  ];

  const updateNote = version?.daysToUpdate == null ? '' : version.daysToUpdate < 0
    ? fill(t(' · overdue by {n} d'), { n: -version.daysToUpdate })
    : version.daysToUpdate === 0 ? t(' · today')
    : version.daysToUpdate <= 30 ? fill(t(' · in {n} d'), { n: version.daysToUpdate }) : '';
  const requirementLink = duerpRequirement && canSee(session.role, 'watch') ? duerpRequirement.href : null;
  const banner: { k: string; v: string; color?: string; link?: { href: string; label: string } }[] = version ? [
    { k: t('Version'), v: version.version },
    {
      k: t('Annual update'),
      v: `${fill(t('{date} · next on {next}'), { date: fmtDate(version.updatedOn), next: fmtDate(version.nextUpdateOn) })}${updateNote}`,
      color: version.updateTone ? TONE[version.updateTone].fg : undefined,
    },
    { k: t('Retention'), v: version.retentionLabel },
    {
      k: t('Validation'),
      v: [
        version.validatedBy, version.cseConsultedOn ? fill(t('CSE consulted on {date}'), { date: fmtDate(version.cseConsultedOn) }) : t('CSE consultation to be entered'),
        version.spstSentOn ? fill(t('sent to the SPST on {date}'), { date: fmtDate(version.spstSentOn) }) : t('transmission to the SPST to be entered'),
      ].filter(Boolean).join(' · '),
      color: version.cseConsultedOn && version.spstSentOn ? undefined : TONE.warn.fg,
      link: requirementLink ? { href: requirementLink, label: t('Requirement R. 4121-1') } : undefined,
    },
  ] : [{ k: t('Version'), v: t('No version in force'), color: TONE.warn.fg }];

  return (
    <>
      <PageHeader title={SCREENS.risks.title} sub={fill(units.length > 1 ? t('Single document · {n} work units') : t('Single document · {n} work unit'), { n: units.length })} />
      <div className="vg-page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="ph-file-text" size={18} style={{ color: 'var(--color-accent)' }} /><span style={{ fontWeight: 500 }}>{t('DUERP')}</span></div>
          {banner.map(({ k, v, color, link }) => (
            <div key={k} style={{ display: 'grid', gap: 1 }}>
              <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vg-text-muted)' }}>{k}</span>
              <span style={{ fontSize: 12.5, color }}>{v}</span>
              {link && <Link href={link.href} className="vg-link" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ph-scales" size={12} />{link.label}</Link>}
            </div>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application. */}
            <a href="/risques/imprimer" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><Icon name="ph-printer" size={13} />{t('Print')}</a>
            {/* CNF-03 : bilan annuel SSCT présenté au CSE (accidentologie : rôles habilités aux données de santé). */}
            {canSeeHealth(session.role) && (
              <a href="/risques/bilan-ssct" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><Icon name="ph-chart-bar" size={13} />{t('SSCT report')}</a>
            )}
            <VersionsButton versions={versions} canApprove={approve} people={approve ? options.people : []} history={edit} />
            {edit && (
              <NewVersionButton canApprove={approve} people={options.people} current={version?.version ?? null} nextVersion={nextVersion}
                nextUpdateOn={nextUpdateOn} defaultValidatorId={offeredOr(options.people, version?.validatedById, session.user.id)} totals={totals} />
            )}
          </span>
        </div>
        {!edit && <DuerpAccessNotice style={{ padding: '0 4px' }} />}

        {missingDetail(sp.risque, !!deepRisk || !!deepArchived) && <MissingNotice text={t('Risk not found or outside the selected site.')} closeHref={hrefWith('/risques', params, {})} />}
        {emergencyOn && missingDetail(sp.situation, !!deepSituation) && <MissingNotice text={t('Emergency situation not found or outside the selected site.')} closeHref={hrefWith('/risques', params, {})} />}
        {studiesAsked && missingDetail(sp.etude, !!deepStudy) && <MissingNotice text={t('Safety study not found or outside the selected site.')} closeHref={hrefWith('/risques', params, {})} />}

        <div className="vg-split vg-md" data-focus={explicitUnit || !unitPanel ? 'detail' : 'list'} style={{ display: 'grid', gap: 12, alignItems: 'start' }}>
          <div className="vg-md-list" style={{ display: 'grid', gap: 2 }}>
            <div className="vg-eyebrow" style={{ padding: '4px 10px 6px' }}>{t('Work units')}</div>
            {units.length > 0 && (
              <Link href={hrefWith('/risques', params, { ...panel, unite: undefined, vue: overview ? undefined : 'ensemble' })} scroll={false}
                className={`vg-item${overview ? ' is-on' : ''}`} style={{ gap: 8, padding: '7px 10px', color: 'var(--color-neutral-400)' }}
                aria-current={overview ? 'page' : undefined}>
                <Icon name="ph-squares-four" size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{t('Overview · all units')}</span>
              </Link>
            )}
            {units.map((u) => (
              <Link key={u.id} href={hrefWith('/risques', params, { ...panel, unite: u.id })} scroll={false} className={`vg-item${u.id === unitId && unitPanel ? ' is-on' : ''}`} style={{ gap: 8, padding: '7px 10px' }}>
                {/* DUE-13 : sous « Tous les sites », le site sous le libellé distingue deux unités homonymes. */}
                <span style={{ flex: 1, fontSize: 12.5, minWidth: 0 }}>
                  {u.label}
                  {showUnitSite && <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)' }}>{u.site}</span>}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{u.count}</span>
                {u.alerts > 0 && (
                  <span title={fill(u.alerts > 1 ? t('{n} risks ≥ {threshold} without a reduction action or with a residual still high') : t('{n} risk ≥ {threshold} without a reduction action or with a residual still high'), { n: u.alerts, threshold: RISK_ACTION_THRESHOLD })}
                    style={{ fontSize: 11, fontWeight: 500, color: TONE.danger.fg, background: TONE.danger.bg, borderRadius: 8, padding: '0 5px', lineHeight: '15px' }}>{u.alerts}</span>
                )}
                {u.toReview > 0 && (
                  <span title={fill(u.toReview > 1 ? t('{n} residuals to re-rate (verified actions)') : t('{n} residual to re-rate (verified actions)'), { n: u.toReview })} style={{ display: 'inline-flex' }}>
                    <Icon name="ph-arrows-clockwise" size={12} style={{ color: TONE.warn.dot }} />
                  </span>
                )}
                <span className="vg-dot" style={{ width: 7, height: 7, background: u.count ? RISK_LEVELS[u.top].dot : 'var(--color-neutral-700)' }} />
              </Link>
            ))}
            {!units.length && <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No unit on this site.')}</div>}
            {edit && (archivedCount > 0 || archives) && (
              <Link href={hrefWith('/risques', params, { ...panel, etat: archives ? undefined : ARCHIVES })} scroll={false} className={`vg-item${archives ? ' is-on' : ''}`}
                style={{ gap: 8, padding: '7px 10px', marginTop: 4, color: 'var(--color-neutral-400)' }} title={t('Units and risks removed from the single document, with their reason and history')}>
                <Icon name="ph-archive" size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{t('Archives')}</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{archivedCount}</span>
              </Link>
            )}
            <Link href={hrefWith('/risques', params, { ...panel, programme: program ? undefined : String(thisYear) })} scroll={false} className={`vg-item${program ? ' is-on' : ''}`}
              style={{ gap: 8, padding: '7px 10px', marginTop: edit && (archivedCount > 0 || archives) ? 0 : 4, color: 'var(--color-neutral-400)' }}
              title={t('Annual programme for the prevention of occupational risks and the improvement of working conditions (L. 4121-3-1)')}>
              <Icon name="ph-calendar-check" size={13} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{fill(t('Annual programme ({short})'), { short: PROGRAM_SHORT })}</span>
            </Link>
            <Link href={hrefWith('/risques', params, { ...panel, unite: undefined, vue: emergency ? undefined : 'urgences' })} scroll={false} className={`vg-item${emergency ? ' is-on' : ''}`}
              style={{ gap: 8, padding: '7px 10px', color: 'var(--color-neutral-400)' }} aria-current={emergency ? 'page' : undefined}
              title={t('Identified emergency situations, means, instructions and drills (ISO 45001 §8.2, ISO 14001 §8.2)')}>
              <Icon name="ph-siren" size={13} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{t('Emergency situations')}</span>
            </Link>
            {!employee && (
              <Link href={hrefWith('/risques', params, { ...panel, unite: undefined, vue: study ? undefined : 'etudes' })} scroll={false} className={`vg-item${study ? ' is-on' : ''}`}
                style={{ gap: 8, padding: '7px 10px', color: 'var(--color-neutral-400)' }} aria-current={study ? 'page' : undefined}
                title={t('HazID, HazOp / FMEA, site inspection, PSSR and ASPD audit of CAPEX and projects (DIG-PRODI method)')}>
                <Icon name="ph-flask" size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{t('Process safety studies')}</span>
              </Link>
            )}
            {approve && register && (
              <Link href={hrefWith('/risques', params, { ...panel, registre: registerOn ? undefined : '1' })} scroll={false} className={`vg-item${registerOn ? ' is-on' : ''}`}
                style={{ gap: 8, padding: '7px 10px', color: 'var(--color-neutral-400)' }} title={t('Register of requests for access to the DUERP (R. 4121-4)')}>
                <Icon name="ph-hand-arrow-down" size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{t('Access provisions')}</span>
                {register.pending > 0 && (
                  <span title={fill(register.pending > 1 ? t('{n} requests pending') : t('{n} request pending'), { n: register.pending })}
                    style={{ fontSize: 11, fontWeight: 500, color: TONE.warn.fg, background: TONE.warn.bg, borderRadius: 8, padding: '0 5px', lineHeight: '15px' }}>{register.pending}</span>
                )}
              </Link>
            )}
            {edit && <AddUnitButton sites={options.sites} zones={zoneOptions} unitLabels={unitLabels} defaultSiteId={defaultSiteId} viewSite={viewSite} residual={residual} />}
          </div>

          <div className="vg-md-detail" style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          <BackToList href={hrefWith('/risques', { mode: params.mode }, {})} label={t('Back to work units')} />
          {(explicitUnit || !unitPanel) && <DetailFocus key={`${unitId ?? ''}:${archives}:${program?.year ?? ''}:${registerOn}:${overview}:${emergency}:${study}`} />}
          {study && studies ? (
            <ProcessSafetyPanel key={deepStudy?.id ?? 'etudes'} rows={studies.studies} cancelled={studies.cancelled} canManage={approve}
              options={approve ? { sites: options.sites, people: options.people, projects: options.projects, projectsMessage: options.projectsMessage } : { sites: [], people: [], projects: [], projectsMessage: null }} actionOptions={actionOptions} today={today()} showSite={!viewSite}
              versions={studies.versions} defaultSite={defaultSiteId} initialId={deepStudy?.id} closeHref={hrefWith('/risques', params, {})} />
          ) : emergency && emergencies ? (
            <EmergencyPanel key={deepSituation?.id ?? 'urgences'} rows={emergencies.situations} archived={emergencies.archived} canManage={edit} canApprove={approve}
              options={edit ? { sites: options.sites, people: options.people } : { sites: [], people: [] }} today={today()} showSite={!viewSite}
              versions={emergencies.versions} defaultSite={defaultSiteId} initialId={deepSituation?.id} closeHref={hrefWith('/risques', params, {})} />
          ) : overview ? (
            <OverviewPanel data={duerpOverview(units.map((u) => ({ id: u.id, label: u.label, site: u.site })), risks, residual)} residual={residual}
              brutHref={hrefWith('/risques', params, { mode: undefined })} residualHref={hrefWith('/risques', params, { mode: 'residuel' })}
              unitHref={(id) => hrefWith('/risques', params, { ...panel, unite: id })} scopeLabel={session.site.label} />
          ) : program ? (
            <ProgramPanel key={program.year} data={program} canApprove={approve} showPilot={!employee} showHistory={edit}
              yearLinks={program.years.map((y) => ({ year: y, href: hrefWith('/risques', params, { programme: String(y) }) }))} />
          ) : registerOn && register ? (
            <AccessRegister requests={register.requests} versions={register.versions} sites={options.sites} showSite={!viewSite}
              defaultSiteId={viewSite?.id ?? ''} today={today()} currentVersion={version?.version ?? null} />
          ) : archives ? (
            <ArchivePanel key={deepArchived?.id ?? 'archives'} risks={archivedRisks} units={units} archivedUnits={archivedUnits} canApprove={approve}
              options={actionOptions} linkableActions={linkableActions}
              showSite={!viewSite} residual={residual} initialRiskId={deepArchived?.id} />
          ) : unit ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <div className="card" style={{ gap: 10, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="card-title" style={{ fontSize: 14 }}>{t('Severity × probability matrix')}</span>
                    <SegLinks size={11.5} pad="3px 9px" options={[
                      { href: hrefWith('/risques', params, { mode: undefined }), label: t('Gross'), on: !residual },
                      { href: hrefWith('/risques', params, { mode: 'residuel' }), label: t('Residual'), on: residual },
                    ]} />
                  </div>
                  <RiskMatrix rows={matrix} selected={cell} residual={residual} caption={fill(residual ? t('Residual risk matrix · {unit}') : t('Gross rating matrix · {unit}'), { unit: unit.label })}
                    hrefOf={(c) => (cell && c.g === cell.g && c.p === cell.p
                      ? hrefWith('/risques', params, { gravite: undefined, probabilite: undefined })
                      : hrefWith('/risques', params, { gravite: String(c.g), probabilite: String(c.p) }))} />
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-neutral-400)' }}>
                    {RISK_LEVELS.map((l) => (
                      <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: l.bg }} />{labelT(t)(l.label)}</span>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 22 }}>
                    <div className="card-kicker">{unit.label}{units.some((u) => u.site !== unit.site) ? ` · ${unit.site}` : ''}</div>
                    {edit && <EditUnitButton unit={unit} sites={options.sites} zones={zoneOptions} unitLabels={unitLabels} viewSite={viewSite} residual={residual} isFirst={units[0]?.id === unit.id} isLast={units.at(-1)?.id === unit.id} />}
                  </div>
                  {unit.zones.length > 0 && (
                    <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="ph-map-pin" size={12} />{fill(t('Plan zones: {zones}'), { zones: unit.zones.map((z) => z.name).join(', ') })}
                    </span>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {stats.map((k) => (
                      <div key={k.k} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-.02em', color: k.color }}>{k.v}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.k}</span>
                      </div>
                    ))}
                  </div>
                  {toReview > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TONE.warn.fg }} title={labelT(t)(RISK_FLAGS.toReview.hint)}>
                      <Icon name="ph-arrows-clockwise" size={13} />{fill(toReview > 1 ? t('{n} residuals to re-rate') : t('{n} residual to re-rate'), { n: toReview })}
                    </div>
                  )}
                  <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12, textWrap: 'pretty' }}>
                    {fill(t('Rating severity 1–4 × probability 1–4. From {n}, a reduction action is mandatory and followed in the single action plan; the residual risk is re-rated after the effectiveness check.'), { n: RISK_ACTION_THRESHOLD })}
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                    {edit && <AddRiskButton units={unitOptions} unitId={unit.id} hazards={risks.map((r) => r.hazard)} />}
                    <ExportMenu unit={{ id: unit.id, label: unit.label }} scopeLabel={session.site.label} unitCount={units.length} />
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: '6px 14px 10px' }}>
                <div style={{ overflowX: 'auto' }}>
                  {cell && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0 2px', fontSize: 12 }}>
                      <span style={{ color: 'var(--vg-text-muted)' }}>{fill(tableRows.length > 1 ? t('{n} risks out of {m}') : t('{n} risk out of {m}'), { n: tableRows.length, m: rows.length })}</span>
                      <Link href={hrefWith('/risques', params, { gravite: undefined, probabilite: undefined })} scroll={false} className="vg-chip is-on">
                        {residual ? t('Residual') : t('Gross')} G{cell.g} × P{cell.p}<i className="ph ph-x" style={{ fontSize: 11 }} aria-hidden /><span className="vg-sr-only">{t(': remove this filter')}</span>
                      </Link>
                    </div>
                  )}
                  <RiskTable key={`${unit.id}:${deepRisk?.id ?? ''}:${cell ? `${cell.g}${cell.p}` : ''}`} rows={tableRows} unit={unit} units={unitOptions} canManage={edit} showEvents={!employee} showHistory={edit}
                    measureOptions={measureOptions}
                    actionsQhse={actionsQhse} options={actionOptions}
                    linkableActions={linkableActions} initialRiskId={deepRisk?.id} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ gap: 8, maxWidth: 560, border: '1px dashed var(--color-divider)', background: 'transparent' }}>
              <div className="card-kicker">{session.site.label}</div>
              <div className="card-title" style={{ fontSize: 15 }}>{t('No work unit')}</div>
              <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12.5, textWrap: 'pretty' }}>
                {t('The single document is organised by work units (workshop, zone, activity). ')}{edit ? t('Add a first unit for this site, then assess its risks.') : t('No unit has been created yet for this site.')}
              </p>
            </div>
          )}
          </div>
        </div>
      </div>
    </>
  );
}
