import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { hrefWith } from '@/components/ui';
import { DocumentRegister } from '@/components/documents/DocumentRegister';
import { FilterMenu } from '@/components/documents/FilterMenu';
import { DOC_TYPES, DOC_TYPE_KEYS, PROCESS_KEYS, STATUS_FILTERS, processLabel, type StatusFilter } from '@/components/documents/meta';
import { SCREENS, TONE, canApprove, canEdit } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadDocuments, matchesSearch, type DocumentRow } from '@/lib/data/documents';
import { loadFormOptions } from '@/lib/data/options';
import { lcfirst } from '@/lib/queries';
import { currentSiteId } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.docs.title };

const PATH = '/documents';
/** Consultation seule : aucun formulaire, donc aucune liste de choix (personnel, sites, actions) transmise au navigateur (QUA-06). */
const READER_OPTIONS = { people: [], sites: [], origins: [], actions: [] };
const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function matchesStatus(d: DocumentRow, s: StatusFilter) {
  switch (s) {
    case 'vigueur': return !!d.current;
    case 'revue': return d.pending?.status === 'en_revue';
    case 'retard': return d.overdue;
    case 'brouillon': return d.pending?.status === 'brouillon';
    case 'obsolete': return d.status === 'obsolete';
  }
}

export default async function DocumentsPage({ searchParams }: PageProps<'/documents'>) {
  const { role } = await guard('docs');
  const sp = await searchParams;
  // Rôles en consultation seule : documents en vigueur, sans cycle de vie ni brouillons.
  const manager = canEdit(role, 'docs');
  const [data, formOptions, siteId] = await Promise.all([loadDocuments({ readOnly: !manager }), loadFormOptions(), currentSiteId()]);
  const { rows, kpis } = data;

  const type = DOC_TYPE_KEYS.find((k) => k === str(sp.type));
  const rawProcess = str(sp.processus);
  const processCode = rawProcess && (PROCESS_KEYS.includes(rawProcess) || rows.some((r) => r.process === rawProcess)) ? rawProcess : undefined;
  const statut = manager ? STATUS_FILTERS.find(([k]) => k === str(sp.statut))?.[0] : undefined;
  const q = (str(sp.q) ?? '').trim();
  const params = { type, processus: processCode, statut, q: q || undefined };
  const filtered = Boolean(type || processCode || statut || q);

  // Chaque liste de choix compte les documents qui correspondent aux autres filtres.
  const keep = (d: DocumentRow, skip: 'type' | 'process' | 'status') =>
    matchesSearch(d, q)
    && (skip === 'type' || !type || d.type === type)
    && (skip === 'process' || !processCode || d.process === processCode)
    && (skip === 'status' || !statut || matchesStatus(d, statut));
  const byType = rows.filter((d) => keep(d, 'type'));
  const byProcess = rows.filter((d) => keep(d, 'process'));
  const byStatus = rows.filter((d) => keep(d, 'status'));
  const shown = byType.filter((d) => !type || d.type === type);

  const processes = [...new Set([...rows.map((r) => r.process), ...(processCode ? [processCode] : [])])]
    .sort((a, b) => processLabel(a).localeCompare(processLabel(b), 'fr'));
  const statusLabel = STATUS_FILTERS.find(([k]) => k === statut)?.[1];

  const inForce = kpis.find((k) => k.key === 'vigueur')!.value;
  const sub = manager
    ? `${plural(inForce, 'document en vigueur', 'documents en vigueur')} · ${plural(data.overdueCount, 'révision en retard', 'révisions en retard')}`
    : `${plural(inForce, 'document en vigueur', 'documents en vigueur')} · consultation`;
  const emptyText = rows.length
    ? 'Aucun document ne correspond aux filtres.'
    : `${siteId ? `Aucun document ${manager ? 'maîtrisé' : 'en vigueur'} pour ce site.` : `Aucun document ${manager ? 'maîtrisé' : 'en vigueur'}.`}${manager ? ' Créez le premier avec « Nouveau document ».' : ''}`;

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
        {[{ key: undefined, label: 'Tous', n: byType.length }, ...DOC_TYPE_KEYS.map((k) => ({ key: k, label: DOC_TYPES[k].plural, n: byType.filter((d) => d.type === k).length }))].map((f) => (
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
        {manager && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {kpis.map((k) => {
            const on = statut === k.key;
            return (
              <Link key={k.key} href={hrefWith(PATH, params, { statut: on ? undefined : k.key })} scroll={false}
                className="card vg-kcard" style={{ gap: 5, padding: '12px 14px', boxShadow: on ? '0 0 0 1px var(--color-accent)' : undefined }}
                title={on ? 'Retirer ce filtre' : 'Afficher ces documents'}>
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
          canApprove={canApprove(role)}
          options={manager ? { people: formOptions.people, sites: formOptions.sites, origins: formOptions.origins, actions: data.actionOptions } : READER_OPTIONS}
          existingIds={data.allIds}
          elsewhere={data.elsewhere}
          unavailable={data.unavailable}
          siteId={siteId}
          suggestedDueOn={data.suggestedDueOn}
        />

        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
          {manager ? (
            <>
              Maîtrise des informations documentées (ISO 9001 §7.5) : seule la version approuvée est diffusée ; la version remplacée est archivée et reste consultable.
              L&apos;approbation est réservée à l&apos;animateur QHSE et à la direction.
            </>
          ) : (
            <>
              Consultation des documents en vigueur (ISO 9001 §7.5) : seule la dernière version approuvée est diffusée. Pour signaler une erreur ou proposer une
              modification, contactez le propriétaire du document ou l&apos;animateur QHSE.
            </>
          )}
        </p>
      </div>
    </>
  );
}
