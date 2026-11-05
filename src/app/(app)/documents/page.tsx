import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { hrefWith } from '@/components/ui';
import { DocumentRegister } from '@/components/documents/DocumentRegister';
import { FilterMenu } from '@/components/documents/FilterMenu';
import { STATUS_FILTERS, processLabel, type StatusFilter } from '@/lib/rules/documents';
import { CODEX_DOCUMENTS_NOTICE } from '@/lib/foreign/labels';
import { canCreateAction } from '@/lib/action-rules';
import { SCREENS, TONE, canEdit } from '@/lib/domain';
import { addDays } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadDocuments, matchesSearch, type DocumentRow } from '@/lib/data/documents';
import { loadFormOptions } from '@/lib/data/options';
import { lcfirst } from '@/lib/queries';
import { currentSiteId } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.docs.title };

const PATH = '/documents';
const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function matchesStatus(d: DocumentRow, s: StatusFilter) {
  switch (s) {
    case 'vigueur': return d.inForce;
    case 'validation': return !!d.circuit;
    case 'retard': return d.overdue;
    case 'brouillon': return d.revisions.some((r) => r.status === 'draft');
    case 'obsolete': return d.withdrawn;
  }
}

/**
 * Registre des documents QHSE lus dans Codex (lot 4 de M-02, D10, décision CV-05 du 05/11/2026) : consultation seule ;
 * le service QHSE y crée une action du plan rattachée à un document ou à sa révision ouverte.
 */
export default async function DocumentsPage({ searchParams }: PageProps<'/documents'>) {
  const { role } = await guard('docs');
  const sp = await searchParams;
  // Rôles en consultation seule : documents en vigueur, sans révisions en cours ni circuits.
  const manager = canEdit(role, 'docs');
  const qhse = canCreateAction(role);
  const [data, formOptions, siteId] = await Promise.all([loadDocuments({ readOnly: !manager }), qhse ? loadFormOptions() : null, currentSiteId()]);
  const { rows, kpis, source } = data;

  const types = [...new Map(rows.map((r) => [r.typeCode, r.typeLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const type = types.find(([k]) => k === str(sp.type))?.[0];
  const rawProcess = str(sp.processus);
  const processCode = rawProcess && rows.some((r) => r.process === rawProcess) ? rawProcess : undefined;
  const statut = manager ? STATUS_FILTERS.find(([k]) => k === str(sp.statut))?.[0] : undefined;
  const q = (str(sp.q) ?? '').trim();
  const params = { type, processus: processCode, statut, q: q || undefined };
  const filtered = Boolean(type || processCode || statut || q);

  // Chaque liste de choix compte les documents qui correspondent aux autres filtres.
  const keep = (d: DocumentRow, skip: 'type' | 'process' | 'status') =>
    matchesSearch(d, q)
    && (skip === 'type' || !type || d.typeCode === type)
    && (skip === 'process' || !processCode || d.process === processCode)
    && (skip === 'status' || !statut || matchesStatus(d, statut));
  const byType = rows.filter((d) => keep(d, 'type'));
  const byProcess = rows.filter((d) => keep(d, 'process'));
  const byStatus = rows.filter((d) => keep(d, 'status'));
  const shown = byType.filter((d) => !type || d.typeCode === type);

  const processes = [...new Set(rows.flatMap((r) => (r.process ? [r.process] : [])))].sort((a, b) => processLabel(a).localeCompare(processLabel(b), 'fr'));
  const statusLabel = STATUS_FILTERS.find(([k]) => k === statut)?.[1];

  const inForce = kpis.find((k) => k.key === 'vigueur')!.value;
  const sub = manager
    ? `${plural(inForce, 'document en vigueur', 'documents en vigueur')} · ${plural(data.overdueCount, 'revue en retard', 'revues en retard')}`
    : `${plural(inForce, 'document en vigueur', 'documents en vigueur')} · consultation`;
  const emptyText = !source.ok ? 'Documents de Codex indisponibles.'
    : rows.length ? 'Aucun document ne correspond aux filtres.'
      : siteId ? 'Aucun document QHSE de Codex pour ce site.' : 'Aucun document QHSE dans Codex.';

  const toolbar = (
    <>
      <form action={PATH} style={{ position: 'relative', width: 240, maxWidth: '100%' }}>
        <i className="ph ph-magnifying-glass" aria-hidden style={{ position: 'absolute', left: 10, top: 8, fontSize: 14, color: 'var(--color-neutral-500)' }} />
        {type && <input type="hidden" name="type" value={type} />}
        {processCode && <input type="hidden" name="processus" value={processCode} />}
        {statut && <input type="hidden" name="statut" value={statut} />}
        <input className="input" name="q" defaultValue={q} placeholder="Référence ou titre…" aria-label="Rechercher un document"
          style={{ fontSize: 12.5, minHeight: 30, padding: '5px 10px 5px 30px' }} />
      </form>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {[{ key: undefined as string | undefined, label: 'Tous', n: byType.length }, ...types.map(([k, label]) => ({ key: k, label, n: byType.filter((d) => d.typeCode === k).length }))].map((f) => (
          <Link key={f.label} href={hrefWith(PATH, params, { type: f.key })} scroll={false} className={`vg-chip${type === f.key ? ' is-on' : ''}`}>
            {f.label}<span style={{ opacity: 0.6 }}>{f.n}</span>
          </Link>
        ))}
      </div>
      <FilterMenu key={`p-${processCode}`} icon="ph-funnel" label={`Processus : ${processCode ? lcfirst(processLabel(processCode)) : 'tous'}`}
        options={[
          { href: hrefWith(PATH, params, { processus: undefined }), label: 'Tous les processus', on: !processCode, n: byProcess.length },
          ...processes.map((p) => ({ href: hrefWith(PATH, params, { processus: p }), label: processLabel(p), on: processCode === p, n: byProcess.filter((d) => d.process === p).length })),
        ]} />
      {manager && (
        <FilterMenu key={`s-${statut}`} label={`Statut : ${statusLabel ? lcfirst(statusLabel) : 'tous'}`}
          options={[
            { href: hrefWith(PATH, params, { statut: undefined }), label: 'Tous les statuts', on: !statut, n: byStatus.length },
            ...STATUS_FILTERS.map(([k, label]) => ({ href: hrefWith(PATH, params, { statut: k }), label, on: statut === k, n: byStatus.filter((d) => matchesStatus(d, k)).length })),
          ]} />
      )}
      {filtered && <Link href={PATH} scroll={false} className="vg-link">Réinitialiser</Link>}
    </>
  );

  return (
    <>
      <PageHeader title={SCREENS.docs.title} sub={sub} />
      <div className="vg-page">
        {/* D10, décision CV-05 du 05/11/2026 : consultation seule, Codex fait foi. */}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          <i className="ph ph-plugs-connected" style={{ fontSize: 13, marginRight: 6 }} aria-hidden />{CODEX_DOCUMENTS_NOTICE}
        </p>
        {!source.ok && (
          <div className="card" role="status" style={{ padding: '10px 14px', borderColor: 'var(--tone-warn-dot)', fontSize: 12.5, textWrap: 'pretty' }}>
            {source.message} Les revues et circuits de validation ne sont pas suivis tant que la source n&apos;est pas lue.
          </div>
        )}
        {manager && source.ok && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {kpis.map((k) => {
            const on = statut === k.key;
            return (
              <Link key={k.key} href={hrefWith(PATH, params, { statut: on ? undefined : k.key })} scroll={false}
                className="card vg-kcard" style={{ gap: 5, padding: '12px 14px', boxShadow: on ? '0 0 0 1px var(--color-accent)' : undefined }}
                aria-label={`${k.label} : ${k.value}${on ? ' (filtre actif, retirer)' : ' (afficher ces documents)'}`}>
                <div className="vg-eyebrow" style={{ color: on ? 'var(--color-accent)' : 'var(--color-neutral-500)' }}>{k.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1, color: k.key === 'retard' && k.value > 0 ? TONE.danger.dot : undefined }}>{k.value}</span>
                  {k.sub && <span style={{ fontSize: 12, color: k.subTone === 'neutral' ? 'var(--color-neutral-400)' : TONE[k.subTone].dot }}>{k.sub}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.note}</div>
              </Link>
            );
          })}
        </div>}

        <DocumentRegister
          docs={rows}
          shownIds={shown.map((d) => d.id)}
          toolbar={toolbar}
          emptyText={emptyText}
          canManage={manager}
          // Création d'action depuis un document : service QHSE seulement (ACT-22).
          actionForm={qhse && formOptions ? { people: formOptions.people, sites: formOptions.sites, today: data.now } : null}
          aliasOf={data.aliasOf}
          elsewhere={data.elsewhere}
          unavailable={data.unavailable}
          suggestedDueOn={addDays(data.now, 30)}
        />

        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
          {manager
            ? <>Maîtrise des informations documentées (ISO 9001 §7.5) : seule la révision en vigueur est diffusée. Rédaction, circuits de validation, revues et retraits se font dans Codex.</>
            : <>Consultation des documents en vigueur (ISO 9001 §7.5). Pour signaler une erreur ou proposer une modification, contactez le propriétaire du document ou l&apos;animateur QHSE.</>}
        </p>
      </div>
    </>
  );
}
