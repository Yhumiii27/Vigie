import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { EngineeringRegister } from '@/components/engineering/EngineeringRegister';
import { canCreateAction } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { SCREENS, canEdit } from '@/lib/domain';
import { loadDocumentChoices } from '@/lib/data/documents';
import { loadEngineering, loadOpenEcoChoices } from '@/lib/data/engineering';
import { loadFormOptions } from '@/lib/data/options';
import { guard } from '@/lib/guard';
import { ECR_TAB } from '@/lib/rules/engineering';
import { currentSiteId } from '@/lib/session';
import { firstParam } from '@/lib/url-state';

export const metadata: Metadata = { title: SCREENS.engineering.title };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Modifications techniques (D12, lot 5 de M-02, décision CV-06 du 05/11/2026) : ordres de modification (onglet par
 * défaut) et demandes (`?onglet=demandes`), fiche `?sel=<numéro>` (liens /modifications-techniques/<numéro> de Codex et de
 * Keystone redirigés ici), filtres de Keystone `?part=` et `?project=`, formulaire d'un nouvel ordre prérempli
 * (`?nouveau=ordre&article=&projet=&titre=&source=keystone`). Saisie : animateur QHSE et direction ; l'encadrement consulte
 * son périmètre (un approbateur désigné décide sa clé) ; Salarié : écran fermé.
 */
export default async function EngineeringPage({ searchParams }: PageProps<'/modifications-techniques'>) {
  const { role } = await guard('engineering');
  const sp = await searchParams;
  const qhse = canEdit(role, 'engineering');
  const part = firstParam(sp.part)?.trim() || null;
  const project = firstParam(sp.project)?.trim() || null;
  const [data, options, ecoChoices, docChoices, siteId] = await Promise.all([
    loadEngineering({ part, project }),
    qhse ? loadFormOptions() : null,
    qhse ? loadOpenEcoChoices() : Promise.resolve([] as [string, string][]),
    qhse ? loadDocumentChoices('site') : null,
    currentSiteId(),
  ]);
  const tab = firstParam(sp.onglet) === ECR_TAB ? 'ecr' : 'eco';
  const open = data.ecos.filter((e) => e.status !== 'released' && e.status !== 'rejected').length;
  const toDecide = data.ecrs.filter((r) => r.status === 'submitted' && !r.cancelled).length;
  const actionOptions: ActionFormOptions = qhse && options && canCreateAction(role)
    ? { people: options.people, sites: options.sites, today: data.now }
    : { people: [], sites: [], today: data.now };
  const nouveau = firstParam(sp.nouveau) === 'ordre' && qhse
    ? { part: firstParam(sp.article) ?? '', project: firstParam(sp.projet) ?? '', title: firstParam(sp.titre) ?? '', source: firstParam(sp.source) === 'keystone' ? 'keystone' as const : 'vigie' as const }
    : null;
  return (
    <>
      <PageHeader title={SCREENS.engineering.title} sub={`${plural(open, 'ordre ouvert', 'ordres ouverts')} · ${plural(toDecide, 'demande à décider', 'demandes à décider')}${qhse ? '' : ' · consultation'}`} />
      <div className="vg-page">
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          <i className="ph ph-git-branch" style={{ fontSize: 13, marginRight: 6 }} aria-hidden />
          Demandes (ECR) et ordres (ECO) de modification venus de Codex, de Keystone ou de Vigie : Vigie les numérote, les instruit, les approuve
          et les libère ; les documents restent dans Codex, les articles, projets et machines dans Keystone.
        </p>
        {data.sourceMessages.map((m) => (
          <div key={m} className="card" role="status" style={{ padding: '10px 14px', borderColor: 'var(--tone-warn-dot)', fontSize: 12.5, textWrap: 'pretty' }}>{m}</div>
        ))}
        <EngineeringRegister
          tab={tab}
          ecos={data.ecos}
          ecrs={data.ecrs}
          versions={data.versions}
          today={data.now}
          qhse={qhse}
          showSite={!siteId}
          filter={{ part, project }}
          options={qhse && options ? {
            people: options.people, sites: options.sites, allSites: options.allSites, projects: options.projects, projectsMessage: options.projectsMessage,
            ecos: ecoChoices, documents: docChoices?.source.ok ? docChoices.rows.map((d) => [d.id, `${d.id} · ${d.title}`] as [string, string]) : [],
            documentsMessage: docChoices && !docChoices.source.ok ? 'Documents de Codex indisponibles : demande sur un document impossible pour l’instant.' : null,
          } : null}
          actionOptions={actionOptions}
          defaultSite={siteId ?? ''}
          create={nouveau}
        />
      </div>
    </>
  );
}
