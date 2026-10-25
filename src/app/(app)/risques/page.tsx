import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BackToList, DetailFocus } from '@/components/ListDetail';
import { PageHeader } from '@/components/PageHeader';
import { Icon, MissingNotice, SegLinks, hrefWith } from '@/components/ui';
import { ArchivePanel } from '@/components/risks/ArchivePanel';
import { AddRiskButton } from '@/components/risks/RiskForm';
import { RiskTable } from '@/components/risks/RiskTable';
import { AddUnitButton, EditUnitButton } from '@/components/risks/UnitDialogs';
import { ExportMenu } from '@/components/risks/ExportMenu';
import { DuerpAccessNotice } from '@/components/risks/AccessNotice';
import { AccessRegister } from '@/components/risks/AccessRegister';
import { ProgramPanel } from '@/components/risks/ProgramPanel';
import { NewVersionButton, VersionsButton } from '@/components/risks/VersionDialogs';
import { fmtDate, yearOf } from '@/lib/dates';
import { PROGRAM_SHORT, RISK_ACTION_THRESHOLD, RISK_FLAGS, RISK_LEVELS, SCREENS, TONE, canApprove, canEdit, canSee, canSeeHealth, isEmployee, riskLevel } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadFormOptions, type FormOptions } from '@/lib/data/options';
import { offeredOr } from '@/lib/form-options';
import { loadDuerpAccessRegister, loadPreventionProgram, loadRisks } from '@/lib/data/risks';
import { ALL_SITES } from '@/lib/session';
import { today } from '@/lib/today';
import type { ActionFormOptions } from '@/lib/action-view';
import { ARCHIVES, canonicalHref, missingDetail, wantsArchives } from '@/lib/url-state';

export const metadata: Metadata = { title: SCREENS.risks.title };

/** Rôles en consultation : aucune liste de choix (ni liste du personnel) transmise à la page. */
const NO_OPTIONS: Pick<FormOptions, 'people' | 'sites'> = { people: [], sites: [] };

export default async function RisksPage({ searchParams }: PageProps<'/risques'>) {
  const session = await guard('risks');
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
  const [{ version, versions, nextVersion, nextUpdateOn, totals, units, risks, archivedRisks, archivedUnits, linkableActions, actionsQhse, duerpRequirement }, options, register, program] =
    await Promise.all([
      loadRisks(),
      edit ? loadFormOptions() : Promise.resolve(NO_OPTIONS),
      approve ? loadDuerpAccessRegister() : Promise.resolve(null),
      programYear != null ? loadPreventionProgram(programYear) : Promise.resolve(null),
    ]);
  // Lien profond ?risque=<id> (échéances, plan d'actions, événement) : ouvre la fiche du risque dans son unité,
  // ou dans le filtre « Archivés » pour un risque archivé (rôles qui modifient le DUERP).
  const riskParam = typeof sp.risque === 'string' ? Number(sp.risque) : null;
  const deepRisk = riskParam == null ? undefined : risks.find((r) => r.id === riskParam);
  const deepArchived = riskParam == null || deepRisk ? undefined : archivedRisks.find((r) => r.id === riskParam);
  const archives = edit && !program && !registerOn && (wantsArchives(sp) || !!deepArchived);
  const archivedCount = archivedRisks.length + archivedUnits.length;
  const askedUnit = typeof sp.unite === 'string' && units.some((u) => u.id === sp.unite) ? sp.unite : undefined;
  const unitId = deepRisk?.unitId ?? askedUnit ?? units[0]?.id;
  const residual = sp.mode === 'residuel';
  // UX-07 : unité choisie explicitement (lien de la liste ou lien profond) — gardée dans l'URL, la fiche remplace alors la
  // liste sur téléphone ; sans choix, la première unité (grand écran) et la liste des unités (téléphone).
  const explicitUnit = !!askedUnit || !!deepRisk;
  const params = {
    unite: explicitUnit ? unitId : undefined, mode: residual ? 'residuel' : undefined, etat: archives ? ARCHIVES : undefined,
    programme: program ? String(program.year) : undefined, registre: registerOn ? '1' : undefined,
  };
  // Panneau de droite : une unité, ou « Archivés », le programme annuel, le registre (les autres paramètres sont remis à zéro).
  const panel = { etat: undefined, programme: undefined, registre: undefined };
  const unitPanel = !archives && !program && !registerOn;
  const rows = risks.filter((r) => r.unitId === unitId);
  const unit = units.find((u) => u.id === unitId);
  // Site affiché (null = « Tous les sites ») : une unité rattachée à un autre site n'apparaît pas dans la liste.
  const viewSite = session.site.id === ALL_SITES ? null : { id: session.site.id, label: session.site.label };
  const defaultSiteId = viewSite?.id ?? session.siteOptions[0]?.id ?? '';
  const unitOptions = units.map(({ id, label, site }) => ({ id, label, site }));
  // Formulaire d'action : service QHSE seulement (ACT-22) ; listes vides sinon. Date du jour du serveur (VIGIE_TODAY).
  const actionOptions: ActionFormOptions = actionsQhse
    ? { people: options.people, sites: options.sites, today: today() }
    : { people: [], sites: [], today: today() };

  const cells: { t: string; bg: string; color: string; fs: number }[] = [];
  for (let g = 4; g >= 1; g--) {
    cells.push({ t: `G${g}`, bg: 'transparent', color: 'var(--color-neutral-500)', fs: 11 });
    for (let p = 1; p <= 4; p++) {
      const n = rows.filter((r) => (residual ? r.residualGravity : r.gravity) === g && (residual ? r.residualProbability : r.probability) === p).length;
      cells.push({ t: n ? String(n) : '', bg: RISK_LEVELS[riskLevel(g * p)].bg, color: 'var(--color-text)', fs: 13 });
    }
  }
  cells.push({ t: '', bg: 'transparent', color: 'transparent', fs: 11 });
  for (let p = 1; p <= 4; p++) cells.push({ t: `P${p}`, bg: 'transparent', color: 'var(--color-neutral-500)', fs: 11 });

  const high = rows.filter((r) => r.gravity * r.probability >= RISK_ACTION_THRESHOLD).length;
  const resHigh = rows.filter((r) => r.residualGravity * r.residualProbability >= RISK_ACTION_THRESHOLD).length;
  const toReview = rows.filter((r) => r.flag === 'toReview').length;
  const stats = [
    { v: rows.length, k: 'risques évalués', color: 'var(--color-text)' },
    { v: high, k: 'élevés ou critiques (brut)', color: high ? RISK_LEVELS[2].dot : 'var(--color-text)' },
    { v: resHigh, k: `résiduels ≥ ${RISK_ACTION_THRESHOLD}`, color: resHigh ? TONE.danger.dot : TONE.ok.dot },
  ];

  const updateNote = version?.daysToUpdate == null ? '' : version.daysToUpdate < 0
    ? ` · dépassée de ${-version.daysToUpdate} j`
    : version.daysToUpdate === 0 ? " · aujourd'hui"
    : version.daysToUpdate <= 30 ? ` · dans ${version.daysToUpdate} j` : '';
  const requirementLink = duerpRequirement && canSee(session.role, 'watch') ? duerpRequirement.href : null;
  const banner: { k: string; v: string; color?: string; link?: { href: string; label: string } }[] = version ? [
    { k: 'Version', v: version.version },
    {
      k: 'Mise à jour annuelle',
      v: `${fmtDate(version.updatedOn)} · prochaine le ${fmtDate(version.nextUpdateOn)}${updateNote}`,
      color: version.updateTone ? TONE[version.updateTone].fg : undefined,
    },
    { k: 'Conservation', v: version.retentionLabel },
    {
      k: 'Validation',
      v: [
        version.validatedBy, version.cseConsultedOn ? `CSE consulté le ${fmtDate(version.cseConsultedOn)}` : 'consultation du CSE à renseigner',
        version.spstSentOn ? `transmise au SPST le ${fmtDate(version.spstSentOn)}` : 'transmission au SPST à renseigner',
      ].filter(Boolean).join(' · '),
      color: version.cseConsultedOn && version.spstSentOn ? undefined : TONE.warn.fg,
      link: requirementLink ? { href: requirementLink, label: 'Exigence R. 4121-1' } : undefined,
    },
  ] : [{ k: 'Version', v: 'Aucune version en vigueur', color: TONE.warn.fg }];

  return (
    <>
      <PageHeader title={SCREENS.risks.title} sub={`Document unique · ${units.length} unité${units.length > 1 ? 's' : ''} de travail`} />
      <div className="vg-page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="ph-file-text" size={18} style={{ color: 'var(--color-accent)' }} /><span style={{ fontWeight: 500 }}>DUERP</span></div>
          {banner.map(({ k, v, color, link }) => (
            <div key={k} style={{ display: 'grid', gap: 1 }}>
              <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vg-text-muted)' }}>{k}</span>
              <span style={{ fontSize: 12.5, color }}>{v}</span>
              {link && <Link href={link.href} className="vg-link" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ph-scales" size={12} />{link.label}</Link>}
            </div>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application. */}
            <a href="/risques/imprimer" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><Icon name="ph-printer" size={13} />Imprimer</a>
            {/* CNF-03 : bilan annuel SSCT présenté au CSE (accidentologie : rôles habilités aux données de santé). */}
            {canSeeHealth(session.role) && (
              <a href="/risques/bilan-ssct" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><Icon name="ph-chart-bar" size={13} />Bilan SSCT</a>
            )}
            <VersionsButton versions={versions} canApprove={approve} people={approve ? options.people : []} history={edit} />
            {edit && (
              <NewVersionButton canApprove={approve} people={options.people} current={version?.version ?? null} nextVersion={nextVersion}
                nextUpdateOn={nextUpdateOn} defaultValidatorId={offeredOr(options.people, version?.validatedById, session.user.id)} totals={totals} />
            )}
          </span>
        </div>
        {!edit && <DuerpAccessNotice style={{ padding: '0 4px' }} />}

        {missingDetail(sp.risque, !!deepRisk || !!deepArchived) && <MissingNotice text="Risque introuvable ou hors du site sélectionné." closeHref={hrefWith('/risques', params, {})} />}

        <div className="vg-split vg-md" data-focus={explicitUnit || !unitPanel ? 'detail' : 'list'} style={{ display: 'grid', gap: 12, alignItems: 'start' }}>
          <div className="vg-md-list" style={{ display: 'grid', gap: 2 }}>
            <div className="vg-eyebrow" style={{ padding: '4px 10px 6px' }}>Unités de travail</div>
            {units.map((u) => (
              <Link key={u.id} href={hrefWith('/risques', params, { ...panel, unite: u.id })} scroll={false} className={`vg-item${u.id === unitId && unitPanel ? ' is-on' : ''}`} style={{ gap: 8, padding: '7px 10px' }}>
                <span style={{ flex: 1, fontSize: 12.5 }}>{u.label}</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{u.count}</span>
                {u.alerts > 0 && (
                  <span title={`${u.alerts} risque${u.alerts > 1 ? 's' : ''} ≥ ${RISK_ACTION_THRESHOLD} sans action de réduction ou au résiduel encore élevé`}
                    style={{ fontSize: 11, fontWeight: 500, color: TONE.danger.fg, background: TONE.danger.bg, borderRadius: 8, padding: '0 5px', lineHeight: '15px' }}>{u.alerts}</span>
                )}
                {u.toReview > 0 && (
                  <span title={`${u.toReview} ${u.toReview > 1 ? 'résiduels' : 'résiduel'} à recoter (actions vérifiées)`} style={{ display: 'inline-flex' }}>
                    <Icon name="ph-arrows-clockwise" size={12} style={{ color: TONE.warn.dot }} />
                  </span>
                )}
                <span className="vg-dot" style={{ width: 7, height: 7, background: u.count ? RISK_LEVELS[u.top].dot : 'var(--color-neutral-700)' }} />
              </Link>
            ))}
            {!units.length && <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucune unité sur ce site.</div>}
            {edit && (archivedCount > 0 || archives) && (
              <Link href={hrefWith('/risques', params, { ...panel, etat: archives ? undefined : ARCHIVES })} scroll={false} className={`vg-item${archives ? ' is-on' : ''}`}
                style={{ gap: 8, padding: '7px 10px', marginTop: 4, color: 'var(--color-neutral-400)' }} title="Unités et risques retirés du document unique, avec leur motif et leur historique">
                <Icon name="ph-archive" size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>Archivés</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{archivedCount}</span>
              </Link>
            )}
            <Link href={hrefWith('/risques', params, { ...panel, programme: program ? undefined : String(thisYear) })} scroll={false} className={`vg-item${program ? ' is-on' : ''}`}
              style={{ gap: 8, padding: '7px 10px', marginTop: edit && (archivedCount > 0 || archives) ? 0 : 4, color: 'var(--color-neutral-400)' }}
              title="Programme annuel de prévention des risques professionnels et d'amélioration des conditions de travail (L. 4121-3-1)">
              <Icon name="ph-calendar-check" size={13} />
              <span style={{ flex: 1, fontSize: 12.5 }}>Programme annuel ({PROGRAM_SHORT})</span>
            </Link>
            {approve && register && (
              <Link href={hrefWith('/risques', params, { ...panel, registre: registerOn ? undefined : '1' })} scroll={false} className={`vg-item${registerOn ? ' is-on' : ''}`}
                style={{ gap: 8, padding: '7px 10px', color: 'var(--color-neutral-400)' }} title="Registre des demandes d'accès au DUERP (R. 4121-4)">
                <Icon name="ph-hand-arrow-down" size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>Mises à disposition</span>
                {register.pending > 0 && (
                  <span title={`${register.pending} demande${register.pending > 1 ? 's' : ''} en attente`}
                    style={{ fontSize: 11, fontWeight: 500, color: TONE.warn.fg, background: TONE.warn.bg, borderRadius: 8, padding: '0 5px', lineHeight: '15px' }}>{register.pending}</span>
                )}
              </Link>
            )}
            {edit && <AddUnitButton sites={options.sites} defaultSiteId={defaultSiteId} viewSite={viewSite} residual={residual} />}
          </div>

          <div className="vg-md-detail" style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          <BackToList href={hrefWith('/risques', { mode: params.mode }, {})} label="Retour aux unités de travail" />
          {(explicitUnit || !unitPanel) && <DetailFocus key={`${unitId ?? ''}:${archives}:${program?.year ?? ''}:${registerOn}`} />}
          {program ? (
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
                    <span className="card-title" style={{ fontSize: 14 }}>Matrice gravité × probabilité</span>
                    <SegLinks size={11.5} pad="3px 9px" options={[
                      { href: hrefWith('/risques', params, { mode: undefined }), label: 'Brut', on: !residual },
                      { href: hrefWith('/risques', params, { mode: 'residuel' }), label: 'Résiduel', on: residual },
                    ]} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(4, minmax(0, 1fr))', gap: 4, fontSize: 12 }}>
                    {cells.map((c, i) => (
                      <div key={i} style={{ minHeight: 40, display: 'grid', placeItems: 'center', borderRadius: 4, background: c.bg, color: c.color, fontSize: c.fs, padding: '0 6px' }}>{c.t}</div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-neutral-400)' }}>
                    {RISK_LEVELS.map((l) => (
                      <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: l.bg }} />{l.label}</span>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 22 }}>
                    <div className="card-kicker">{unit.label}{units.some((u) => u.site !== unit.site) ? ` · ${unit.site}` : ''}</div>
                    {edit && <EditUnitButton unit={unit} sites={options.sites} viewSite={viewSite} residual={residual} isFirst={units[0]?.id === unit.id} isLast={units.at(-1)?.id === unit.id} />}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {stats.map((k) => (
                      <div key={k.k} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-.02em', color: k.color }}>{k.v}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.k}</span>
                      </div>
                    ))}
                  </div>
                  {toReview > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TONE.warn.fg }} title={RISK_FLAGS.toReview.hint}>
                      <Icon name="ph-arrows-clockwise" size={13} />{toReview} {toReview > 1 ? 'résiduels' : 'résiduel'} à recoter
                    </div>
                  )}
                  <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12, textWrap: 'pretty' }}>
                    Cotation gravité 1–4 × probabilité 1–4. À partir de {RISK_ACTION_THRESHOLD}, une action de réduction est obligatoire et suivie dans le plan d&apos;actions unique ; le risque résiduel est recoté après vérification d&apos;efficacité.
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                    {edit && <AddRiskButton units={unitOptions} unitId={unit.id} />}
                    <ExportMenu unit={{ id: unit.id, label: unit.label }} scopeLabel={session.site.label} unitCount={units.length} />
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: '6px 14px 10px' }}>
                <div style={{ overflowX: 'auto' }}>
                  <RiskTable key={`${unit.id}:${deepRisk?.id ?? ''}`} rows={rows} unit={unit} units={unitOptions} canManage={edit} showEvents={!employee} showHistory={edit}
                    actionsQhse={actionsQhse} options={actionOptions}
                    linkableActions={linkableActions} initialRiskId={deepRisk?.id} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ gap: 8, maxWidth: 560, border: '1px dashed var(--color-divider)', background: 'transparent' }}>
              <div className="card-kicker">{session.site.label}</div>
              <div className="card-title" style={{ fontSize: 15 }}>Aucune unité de travail</div>
              <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12.5, textWrap: 'pretty' }}>
                Le document unique s&apos;organise par unités de travail (atelier, zone, activité). {edit ? 'Ajoutez une première unité pour ce site, puis évaluez ses risques.' : "Aucune unité n'a encore été créée pour ce site."}
              </p>
            </div>
          )}
          </div>
        </div>
      </div>
    </>
  );
}
