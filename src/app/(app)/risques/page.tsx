import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Icon, SegLinks, hrefWith } from '@/components/ui';
import { AddRiskButton } from '@/components/risks/RiskForm';
import { RiskTable } from '@/components/risks/RiskTable';
import { AddUnitButton, EditUnitButton } from '@/components/risks/UnitDialogs';
import { ExportMenu } from '@/components/risks/ExportMenu';
import { NewVersionButton, VersionsButton } from '@/components/risks/VersionDialogs';
import { fmtDate } from '@/lib/dates';
import { RISK_ACTION_THRESHOLD, RISK_LEVELS, SCREENS, TONE, canApprove, canManage, riskLevel } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadFormOptions } from '@/lib/data/options';
import { loadRisks } from '@/lib/data/risks';
import { ALL_SITES } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.risks.title };

export default async function RisksPage({ searchParams }: PageProps<'/risques'>) {
  const session = await guard('risks');
  const sp = await searchParams;
  const [{ version, versions, nextVersion, nextUpdateOn, totals, units, risks }, options] = await Promise.all([loadRisks(), loadFormOptions()]);
  const manage = canManage(session.role);
  const approve = canApprove(session.role);
  const unitId = typeof sp.unite === 'string' && units.some((u) => u.id === sp.unite) ? sp.unite : units[0]?.id;
  const residual = sp.mode === 'residuel';
  const params = { unite: unitId === units[0]?.id ? undefined : unitId, mode: residual ? 'residuel' : undefined };
  const rows = risks.filter((r) => r.unitId === unitId);
  const unit = units.find((u) => u.id === unitId);
  // Site affiché (null = « Tous les sites ») : une unité rattachée à un autre site n'apparaît pas dans la liste.
  const viewSite = session.site.id === ALL_SITES ? null : { id: session.site.id, label: session.site.label };
  const defaultSiteId = viewSite?.id ?? session.siteOptions[0]?.id ?? '';
  const unitOptions = units.map(({ id, label, site }) => ({ id, label, site }));

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
  const stats = [
    { v: rows.length, k: 'risques évalués', color: 'var(--color-text)' },
    { v: high, k: 'élevés ou critiques (brut)', color: high ? RISK_LEVELS[2].dot : 'var(--color-text)' },
    { v: resHigh, k: `résiduels ≥ ${RISK_ACTION_THRESHOLD}`, color: resHigh ? TONE.danger.dot : TONE.ok.dot },
  ];

  const updateNote = version?.daysToUpdate == null ? '' : version.daysToUpdate < 0
    ? ` · dépassée de ${-version.daysToUpdate} j`
    : version.daysToUpdate === 0 ? " · aujourd'hui"
    : version.daysToUpdate <= 30 ? ` · dans ${version.daysToUpdate} j` : '';
  const banner: { k: string; v: string; color?: string }[] = version ? [
    { k: 'Version', v: version.version },
    {
      k: 'Mise à jour annuelle',
      v: `${fmtDate(version.updatedOn)} · prochaine le ${fmtDate(version.nextUpdateOn)}${updateNote}`,
      color: version.updateTone ? TONE[version.updateTone].fg : undefined,
    },
    { k: 'Conservation', v: version.retentionLabel },
    {
      k: 'Validation',
      v: [version.validatedBy, version.cseConsultedOn ? `CSE consulté le ${fmtDate(version.cseConsultedOn)}` : 'consultation du CSE à renseigner'].filter(Boolean).join(' · '),
      color: version.cseConsultedOn ? undefined : TONE.warn.fg,
    },
  ] : [{ k: 'Version', v: 'Aucune version en vigueur', color: TONE.warn.fg }];

  return (
    <>
      <PageHeader title={SCREENS.risks.title} sub={`Document unique · ${units.length} unité${units.length > 1 ? 's' : ''} de travail`} />
      <div className="vg-page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="ph-file-text" size={18} style={{ color: 'var(--color-accent)' }} /><span style={{ fontWeight: 500 }}>DUERP</span></div>
          {banner.map(({ k, v, color }) => (
            <div key={k} style={{ display: 'grid', gap: 1 }}>
              <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</span>
              <span style={{ fontSize: 12.5, color }}>{v}</span>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <VersionsButton versions={versions} canApprove={approve} people={options.people} />
            <NewVersionButton canApprove={approve} people={options.people} current={version?.version ?? null} nextVersion={nextVersion}
              nextUpdateOn={nextUpdateOn} defaultValidatorId={version?.validatedById ?? session.user.id} totals={totals} />
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 216px) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div className="vg-eyebrow" style={{ padding: '4px 10px 6px' }}>Unités de travail</div>
            {units.map((u) => (
              <Link key={u.id} href={hrefWith('/risques', params, { unite: u.id === units[0].id ? undefined : u.id })} scroll={false} className={`vg-item${u.id === unitId ? ' is-on' : ''}`} style={{ gap: 8, padding: '7px 10px' }}>
                <span style={{ flex: 1, fontSize: 12.5 }}>{u.label}</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{u.count}</span>
                <span className="vg-dot" style={{ width: 7, height: 7, background: u.count ? RISK_LEVELS[u.top].dot : 'var(--color-neutral-700)' }} />
              </Link>
            ))}
            {!units.length && <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucune unité sur ce site.</div>}
            {manage && <AddUnitButton sites={options.sites} defaultSiteId={defaultSiteId} viewSite={viewSite} residual={residual} />}
          </div>

          {unit ? (
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
                    {manage && <EditUnitButton unit={unit} sites={options.sites} viewSite={viewSite} residual={residual} />}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {stats.map((k) => (
                      <div key={k.k} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-.02em', color: k.color }}>{k.v}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.k}</span>
                      </div>
                    ))}
                  </div>
                  <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12, textWrap: 'pretty' }}>
                    Cotation gravité 1–4 × probabilité 1–4. À partir de {RISK_ACTION_THRESHOLD}, une action de réduction est obligatoire et suivie dans le plan d&apos;actions unique ; le risque résiduel est recoté après vérification d&apos;efficacité.
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                    {manage && <AddRiskButton units={unitOptions} unitId={unit.id} />}
                    <ExportMenu unit={{ id: unit.id, label: unit.label }} scopeLabel={session.site.label} unitCount={units.length} />
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: '6px 14px 10px' }}>
                <div style={{ overflowX: 'auto' }}>
                  <RiskTable rows={rows} unit={unit} units={unitOptions} canManage={manage}
                    options={{ people: options.people, origins: options.origins, sites: options.sites }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ gap: 8, maxWidth: 560, border: '1px dashed var(--color-divider)', background: 'transparent' }}>
              <div className="card-kicker">{session.site.label}</div>
              <div className="card-title" style={{ fontSize: 15 }}>Aucune unité de travail</div>
              <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12.5, textWrap: 'pretty' }}>
                Le document unique s&apos;organise par unités de travail (atelier, zone, activité). {manage ? 'Ajoutez une première unité pour ce site, puis évaluez ses risques.' : "Aucune unité n'a encore été créée pour ce site."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
