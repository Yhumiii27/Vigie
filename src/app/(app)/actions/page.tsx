import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { NewActionButton } from '@/components/ActionFormDialog';
import { PageHeader } from '@/components/PageHeader';
import { ActionLink, ActionPlanProvider, ActionTableRow } from '@/components/actions/ActionPlanProvider';
import { KanbanBoard } from '@/components/actions/KanbanBoard';
import { Icon, SegLinks, ToneTag, hrefWith } from '@/components/ui';
import { addDays } from '@/lib/dates';
import { CLOSED_ALL_LABEL, ORIGINS, PLAN_SCOPES, SCREENS, TONE, canApprove, canManage, isEmployee } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { ALL_SITES } from '@/lib/session';
import { filterPlan, loadActionPlan, loadLinkedAction, type PlanAction, type PlanScope } from '@/lib/data/actions';
import { loadFormOptions } from '@/lib/data/options';

export const metadata: Metadata = { title: SCREENS.actions.title };

const VIEWS = [['kanban', 'Kanban', 'ph-kanban'], ['liste', 'Liste', 'ph-list-bullets'], ['pilote', 'Par pilote', 'ph-users-three']] as const;

const dueColor = (a: PlanAction) => (a.late ? TONE.danger.dot : 'var(--color-neutral-300)');
const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Cellule Échéance (liste, par pilote) : réalisation, puis vérification d'efficacité pour les actions à vérifier. */
function DueCell({ a, closed }: { a: PlanAction; closed?: boolean }) {
  if (closed && a.col === 'done') return <span style={{ color: 'var(--color-neutral-400)' }} title="Clôturée le">{a.closedOn ? `Clôturée le ${a.closedLabel}` : a.due}</span>;
  return (
    <>
      <span style={{ color: dueColor(a) }} title={`Réalisation prévue le ${a.dueLabel}`}>{a.due}</span>
      {a.col === 'verify' && a.verifyDue && (
        <span style={{ display: 'block', fontSize: 11, color: a.verifyLate ? TONE.danger.dot : 'var(--color-neutral-500)' }} title={`Vérification d'efficacité le ${a.verifyDueLabel}`}>
          Vérif. {a.verifyDue}
        </span>
      )}
    </>
  );
}

/** Origine : libellé, puis référence en lien vers la source quand l'écran est ouvert au rôle. */
function OriginCell({ a }: { a: PlanAction }) {
  const href = a.sources[0]?.href;
  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name={a.origin.icon} size={12} />{a.origin.label}</span>
      {href
        ? <Link href={href} className="vg-link" style={{ display: 'block', fontSize: 11 }}>{a.originRef}</Link>
        : <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-600)' }}>{a.originRef}</span>}
    </>
  );
}

export default async function ActionsPage({ searchParams }: PageProps<'/actions'>) {
  const session = await guard('actions');
  const sp = await searchParams;
  const scope: PlanScope = PLAN_SCOPES.find(([k]) => k && k === sp.etat)?.[0] ?? '';
  const [{ all, pilots, columns, now, counts }, options] = await Promise.all([loadActionPlan({ scope }), loadFormOptions()]);
  const manage = canManage(session.role);
  // Listes du formulaire (effectif, événements du site) : seulement pour l'encadrement, seul à créer et modifier une action.
  const formOptions = manage
    ? { people: options.people, origins: options.origins, sites: options.sites, allSites: options.allSites, events: options.events }
    : { people: [], origins: [], sites: [] };
  // Création : le site sélectionné ou tous les sites (une modification peut transférer l'action vers un autre site).
  const newOptions = session.site.id === ALL_SITES ? formOptions : { ...formOptions, sites: formOptions.sites.filter(([id]) => id === session.site.id) };
  const approve = canApprove(session.role);
  // Salarié : le plan ne montre que ses actions (pilote) ; filtre Pilote et « Mes actions » sans objet.
  const employee = isEmployee(session.role);

  // ─── Filtres (portés par l'URL, communs aux trois vues) ───
  const view = VIEWS.find((v) => v[0] === sp.vue)?.[0] ?? 'kanban';
  const originParam = str(sp.origine);
  // Propriété propre uniquement : « ?origine=constructor » ne doit pas passer pour une origine.
  const origin = originParam && Object.hasOwn(ORIGINS, originParam) ? originParam : undefined;
  const mine = !employee && sp.mes === '1';
  const pilot = !employee && !mine && pilots.some(([id]) => id === sp.pilote) ? str(sp.pilote) : undefined;
  const q = (str(sp.q) ?? '').trim().slice(0, 100);
  const pilotId = mine ? session.user.id : pilot;
  const params = { vue: view === 'kanban' ? undefined : view, etat: scope || undefined, origine: origin, pilote: pilot, mes: mine ? '1' : undefined, q: q || undefined };
  const filtered = !!(origin || pilotId || q);

  const scopeLabel = PLAN_SCOPES.find(([k]) => k === scope)?.[1] ?? PLAN_SCOPES[0][1];
  const shown = filterPlan(all, { origin, pilotId, q });
  // Plan vide (sans filtre) : message et bouton plutôt qu'un Kanban vide.
  const emptyPlan = scope === '' && all.length === 0 && !filtered;
  const mineCount = filterPlan(all, { origin, pilotId: session.user.id, q }).length;
  const open = all.filter((a) => a.col !== 'done');
  const late = open.filter((a) => a.late).length;
  const order = columns.map((c) => c.key);

  // ─── Lien direct /actions?action=A-214 ───
  const linkId = str(sp.action);
  const link = linkId ? await loadLinkedAction(linkId) : null;
  const closeLinkHref = hrefWith('/actions', params, {});
  // Action demandée mais rattachée à un autre site (lien direct, ou fiche ouverte dont on vient de changer le site).
  const moved = linkId && link && !link.action && link.elsewhere ? { id: linkId, site: lcSite(link.elsewhere) } : null;

  const byPilot = [...shown.reduce((m, a) => m.set(a.pilotId, [...(m.get(a.pilotId) ?? []), a]), new Map<string, PlanAction[]>()).values()]
    .sort((a, b) => b.length - a.length || a[0].pilot.localeCompare(b[0].pilot, 'fr'));
  const listed = [...shown].sort((a, b) => order.indexOf(a.col) - order.indexOf(b.col) || a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id, 'fr', { numeric: true }));

  const pilotName = pilotId ? pilots.find(([id]) => id === pilotId)?.[1] ?? session.user.name : undefined;
  // Site : celui sélectionné ; « Tous les sites » sélectionné → champ « Site sélectionné » (résolu par le serveur).
  const newDefaults = {
    siteId: session.site.id === ALL_SITES ? undefined : session.site.id,
    origin,
    pilotId,
  };

  return (
    <>
      <PageHeader title={SCREENS.actions.title} sub={scope === 'annulees'
        ? `${plural(all.length, 'action')} annulée${all.length > 1 ? 's' : ''}`
        : `${open.length} action${open.length > 1 ? 's' : ''} ouverte${open.length > 1 ? 's' : ''} · ${late} en retard`} />
      <div className="vg-page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SegLinks pad="5px 11px" options={VIEWS.map(([key, label, icon]) => ({ href: hrefWith('/actions', params, { vue: key === 'kanban' ? undefined : key }), label, icon, on: view === key }))} />
          <Filter key={`e-${scope}`} label={`Affichage : ${scopeLabel.toLowerCase()}`} icon={PLAN_SCOPES.find(([k]) => k === scope)?.[2]}
            options={PLAN_SCOPES.map(([k, label]) => ({
              href: hrefWith('/actions', params, { etat: k || undefined }), on: scope === k,
              label: k === 'historique' ? `${label} (${plural(counts.olderClosed, 'clôturée')} ancienne${counts.olderClosed > 1 ? 's' : ''})` : k === 'annulees' ? `${label} (${counts.cancelled})` : label,
            }))} />
          <Filter key={`o-${origin}`} label={`Origine : ${origin ? ORIGINS[origin].label.toLowerCase() : 'toutes'}`} icon="ph-funnel"
            options={[{ href: hrefWith('/actions', params, { origine: undefined }), label: 'Toutes les origines', on: !origin },
              ...Object.entries(ORIGINS).map(([k, o]) => ({ href: hrefWith('/actions', params, { origine: k }), label: o.label, on: origin === k }))]} />
          {!employee && (
            <>
              <Filter key={`p-${pilotId}`} label={`Pilote : ${pilotName ?? 'tous'}`}
                options={[{ href: hrefWith('/actions', params, { pilote: undefined, mes: undefined }), label: 'Tous les pilotes', on: !pilotId },
                  ...pilots.map(([id, name]) => ({ href: hrefWith('/actions', params, { pilote: id, mes: undefined }), label: name, on: pilotId === id }))]} />
              <Link href={hrefWith('/actions', params, { mes: mine ? undefined : '1', pilote: undefined })} scroll={false}
                className={`vg-chip${mine ? ' is-on' : ''}`} style={{ padding: '5px 10px', fontSize: 12, lineHeight: 1.2 }}>
                <Icon name="ph-user-circle" size={13} />Mes actions<span style={{ opacity: 0.6 }}>{mineCount}</span>
              </Link>
            </>
          )}
          <Form action="/actions" scroll={false} role="search" style={{ position: 'relative', width: 230, maxWidth: '100%' }}>
            {Object.entries({ vue: params.vue, etat: params.etat, origine: origin, pilote: pilot, mes: params.mes }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
            <Icon name="ph-magnifying-glass" size={13} style={{ position: 'absolute', left: 9, top: 7, color: 'var(--color-neutral-500)' }} />
            {/* Clé = recherche appliquée : la saisie se réaligne quand la recherche est effacée par un lien. */}
            <input key={q} className="input" name="q" defaultValue={q} placeholder="Réf., action, origine…" aria-label="Rechercher une action"
              style={{ fontSize: 12, lineHeight: 1.2, minHeight: 0, padding: '5px 26px 5px 28px' }} />
            {q && (
              <Link href={hrefWith('/actions', params, { q: undefined })} scroll={false} aria-label="Effacer la recherche"
                style={{ position: 'absolute', right: 7, top: 6, color: 'var(--color-neutral-500)', display: 'grid' }}>
                <Icon name="ph-x" size={13} />
              </Link>
            )}
          </Form>
          {filtered && (
            <Link href={hrefWith('/actions', { vue: params.vue, etat: params.etat }, {})} scroll={false} className="vg-link" style={{ fontSize: 11.5 }}>
              Effacer les filtres
            </Link>
          )}
          <span title={Object.values(ORIGINS).map((o) => o.label).join(' · ')} style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
            Plan unique · {Object.keys(ORIGINS).length} origines
          </span>
          {manage && <NewActionButton options={newOptions} defaults={newDefaults} />}
        </div>

        {linkId && !link?.action && (
          <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 12.5 }}>
            <Icon name="ph-info" size={15} style={{ color: TONE.warn.dot }} />
            <span style={{ flex: 1, minWidth: 0, textWrap: 'pretty' }}>
              {moved
                ? <>L&apos;action {linkId} relève du {moved.site} : sélectionnez ce site ou « Tous les sites » dans la barre latérale pour l&apos;ouvrir.</>
                : <>L&apos;action {linkId} est introuvable dans le plan d&apos;actions.</>}
            </span>
            <Link href={closeLinkHref} scroll={false} className="vg-link">Masquer</Link>
          </div>
        )}

        <ActionPlanProvider actions={shown} linked={link?.action ?? null} initialOpenId={link?.action?.id ?? null} moved={moved} options={formOptions}
          canManage={manage} canApprove={approve} currentUserId={session.user.id} today={now} verifyDefault={addDays(now, 30)}>
          {filtered && (
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              {shown.length === 0
                ? (mine ? "Vous n'êtes pilote d'aucune action correspondant à ces critères." : 'Aucune action ne correspond à ces critères.')
                : `${shown.length} action${shown.length > 1 ? 's' : ''} sur ${all.length}`}
            </div>
          )}

          {emptyPlan && (
            <div className="card" style={{ alignItems: 'center', justifyItems: 'center', textAlign: 'center', gap: 10, padding: '28px 16px' }}>
              <Icon name="ph-list-checks" size={26} style={{ color: 'var(--color-neutral-500)' }} />
              <div style={{ fontSize: 13, color: 'var(--color-neutral-300)' }}>
                {employee ? "Aucune action dont vous êtes pilote." : 'Aucune action sur ce site.'}
              </div>
              {manage && <NewActionButton options={newOptions} defaults={newDefaults} />}
            </div>
          )}

          {scope === 'annulees' && (
            <div className="card" style={{ padding: '6px 14px 10px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ fontSize: 12.5, minWidth: 900 }}>
                  <thead><tr><th>Réf.</th><th>Action</th><th>Origine</th><th>Pilote</th><th>Annulée le</th><th>Par</th><th>Motif</th></tr></thead>
                  <tbody>
                    {shown.map((a) => (
                      <ActionTableRow key={a.id} id={a.id}>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>
                          <ActionLink id={a.id} style={{ color: 'inherit', textDecoration: 'none' }}>{a.id}</ActionLink>
                        </td>
                        <td>{a.title}</td>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}><OriginCell a={a} /></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{a.cancelledLabel ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{a.cancelledBy ?? '—'}</td>
                        <td style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty', minWidth: 220 }}>{a.cancelReason ?? '—'}</td>
                      </ActionTableRow>
                    ))}
                    {shown.length === 0 && (
                      <tr><td colSpan={7} style={{ color: 'var(--color-neutral-500)', fontSize: 12, padding: '14px 8px' }}>
                        {filtered ? 'Aucune action annulée ne correspond à ces critères.' : 'Aucune action annulée.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {scope !== 'annulees' && !emptyPlan && view === 'kanban' && (
            <KanbanBoard columns={columns.map((c) => ({
              key: c.key, label: c.key === 'done' && scope === 'historique' ? CLOSED_ALL_LABEL : c.label, tone: c.tone,
              cards: shown.filter((a) => a.col === c.key),
            }))} />
          )}

          {scope !== 'annulees' && !emptyPlan && view === 'liste' && (
            <div className="card" style={{ padding: '6px 14px 10px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ fontSize: 12.5, minWidth: 900 }}>
                  <thead><tr><th>Réf.</th><th>Action</th><th>Origine</th><th>Nature</th><th>Pilote</th><th>Site</th><th>Échéance</th><th>Statut</th></tr></thead>
                  <tbody>
                    {listed.map((a) => (
                      <ActionTableRow key={a.id} id={a.id}>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>
                          <ActionLink id={a.id} style={{ color: 'inherit', textDecoration: 'none' }}>{a.id}</ActionLink>
                        </td>
                        <td>{a.title}</td>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}><OriginCell a={a} /></td>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.kindLabel}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.siteShort}</td>
                        <td style={{ whiteSpace: 'nowrap' }}><DueCell a={a} closed={scope === 'historique'} /></td>
                        <td><ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.statusLabel}</ToneTag></td>
                      </ActionTableRow>
                    ))}
                    {listed.length === 0 && (
                      <tr><td colSpan={8} style={{ color: 'var(--color-neutral-500)', fontSize: 12, padding: '14px 8px' }}>Aucune action à afficher.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {scope !== 'annulees' && !emptyPlan && view === 'pilote' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 10, alignItems: 'start' }}>
              {byPilot.map((items) => {
                const nLate = items.filter((a) => a.late).length;
                return (
                  <div key={items[0].pilotId} className="card" style={{ gap: 6, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 4 }}>
                      <span className="vg-avatar" style={{ width: 26, height: 26, fontSize: 10 }}>{items[0].pilotInitials}</span>
                      <span style={{ fontWeight: 500 }}>{items[0].pilot}</span>
                      <span style={{ fontSize: 11.5, color: nLate ? TONE.danger.dot : 'var(--color-neutral-500)' }}>
                        {items.length} action{items.length > 1 ? 's' : ''}{nLate ? ` · ${nLate} en retard` : ''}
                      </span>
                    </div>
                    {items.map((a) => (
                      <ActionLink key={a.id} id={a.id} className="vg-row"
                        style={{ gridTemplateColumns: '52px minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '3px 6px', margin: '0 -6px' }}>
                        <span style={{ color: 'var(--color-neutral-500)', fontSize: 11.5 }}>{a.id}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                        <span style={{ fontSize: 12, textAlign: 'right' }}><DueCell a={a} /></span>
                        <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.statusLabel}</ToneTag>
                      </ActionLink>
                    ))}
                  </div>
                );
              })}
              {byPilot.length === 0 && <div className="vg-muted" style={{ fontSize: 12, padding: '8px 2px' }}>Aucune action à afficher.</div>}
            </div>
          )}
        </ActionPlanProvider>
      </div>
    </>
  );
}

/** « Site de [Ville B] — zone d'essais » → « site de [Ville B] » (après « relève du »). */
const lcSite = (label: string) => {
  const short = label.split(' — ')[0];
  return short.startsWith('Site ') ? `s${short.slice(1)}` : short;
};

function Filter({ label, icon, options }: { label: string; icon?: string; options: { href: string; label: string; on: boolean }[] }) {
  return (
    <details className="vg-dropdown">
      <summary className="btn btn-secondary vg-btn-sm">{icon && <Icon name={icon} size={13} />}{label}<Icon name="ph-caret-down" size={11} /></summary>
      <div className="vg-menu elev-md">
        {options.map((o) => <Link key={o.href} href={o.href} scroll={false} className={`vg-menu-item${o.on ? ' is-on' : ''}`}>{o.label}</Link>)}
      </div>
    </details>
  );
}
