import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SkillAlerts } from '@/components/skills/SkillAlerts';
import { SkillMatrix } from '@/components/skills/SkillMatrix';
import { CardHead, MissingNotice, SegLinks } from '@/components/ui';
import { ForecastView } from '@/components/skills/ForecastView';
import { renewalForecast, skillLinkTarget } from '@/lib/rules/skills';
import { CURSUS_HELD_NOTICE } from '@/lib/foreign/labels';
import { today } from '@/lib/today';
import { SCREENS, canApprove, canEdit, canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { ALL_SITES, inPerimeter } from '@/lib/session';
import { hasLeft } from '@/lib/people';
import { loadPeople } from '@/lib/queries';
import { loadFormOptions, type Option } from '@/lib/data/options';
import { loadSiteAdmin } from '@/lib/data/sites';
import { loadSkillMatrix, loadTitleChoices } from '@/lib/data/skills';
import { loadPeopleAdmin } from '@/lib/data/people';
import { PeoplePanel } from '@/components/skills/PeoplePanel';

export const metadata: Metadata = { title: SCREENS.skills.title };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function SkillsPage({ searchParams }: PageProps<'/habilitations'>) {
  const session = await guard('skills');
  const sp = await searchParams;
  // Bandeaux : titres manquants ou expirés, mais aussi expirant avant ou pendant une affectation Keystone (`lapses`).
  // Rôle Salarié : sa seule ligne, ses échéances et ses affectations (filtrées par loadSkillMatrix).
  // Même règle que les server actions du domaine (requireSkillsEditor).
  const manage = canEdit(session.role, 'skills');
  // Titres suivis, communs à tous les sites : service QHSE et direction seulement (requireTitlesEditor, HAB-12) ; choix
  // « Suivre un titre » tirés du catalogue de Cursus (D08), lus pour eux seulement.
  const manageTitles = manage && canApprove(session.role);
  const [{ titles, archivedTitles, rows, lapses, others, departed, archive, versions, self, source }, { sites }, allSites, catalog] =
    await Promise.all([loadSkillMatrix(), loadFormOptions(), loadSiteAdmin(), manageTitles ? loadTitleChoices() : { choices: [], message: null }]);
  const now = today();
  // Vue Salarié : aucune saisie, donc aucune liste de formulaire transmise au navigateur. Aucune liste du formulaire
  // d'action : l'écran ne crée pas d'action QSE (recyclages gérés par le service RH, réponses du service QHSE du 15/10/2026).
  const options = { sites: self ? [] : sites };
  // Fiche d'un salarié encore rattaché à un site archivé (vue « Tous les sites ») : son site reste affiché tel quel.
  const archivedSites = self ? [] : allSites.filter((s) => s.archivedOn).map((s) => [s.id, `${s.label} (archivé)`] as Option);

  // Lien profond (échéances, notifications, fiche action) : ?salarie=<personId>[&titre=<titleId>].
  const personId = str(sp.salarie);
  const titleId = str(sp.titre);
  // HAB-17 : message précis quand la cible n'est pas affichée (sortie, hors matrice, autre site, titre archivé ou inconnu) ;
  // message unique pour une personne inconnue ou hors du périmètre.
  let otherSite = false;
  if (personId && !self && session.site.id !== ALL_SITES) {
    const p = (await loadPeople()).get(personId);
    otherSite = !!p && !hasLeft(p, today()) && p.siteId !== session.site.id && inPerimeter(session.allowedSiteIds, p.siteId);
  }
  const link = personId ? skillLinkTarget({
    self, selfId: session.user.id, personId, titleId,
    rowIds: new Set(rows.map((r) => r.person.id)), otherIds: new Set(others.map((p) => p.id)),
    departed: new Map(departed.map((p) => [p.id, p.leftOn ?? ''])), otherSite,
    activeTitleIds: new Set(titles.map((ti) => ti.id)), archivedTitles: new Map(archivedTitles.map((ti) => [ti.id, ti.label])),
  }) : null;
  const initialSel = link?.select;
  // HAB-16 : sous « Tous les sites », site de rattachement de chaque salarié de la matrice (libellés des seuls sites affichés).
  const rowSites = new Set(rows.map((r) => r.person.siteId).filter(Boolean));
  const siteLabels = !self && session.site.id === ALL_SITES && rowSites.size > 1
    ? Object.fromEntries(allSites.filter((x) => rowSites.has(x.id)).map((x) => [x.id, x.label.split(' — ')[0]]))
    : null;

  const sub = self ? `Mes habilitations · ${titles.length} titres suivis` : `${rows.length} salariés · ${titles.length} titres suivis`;
  // HAB-09 : vue « À prévoir » (?vue=a-prevoir) — recyclages et formations des 12 prochains mois, calculés à l'affichage.
  const forecastOn = str(sp.vue) === 'a-prevoir';
  const forecast = forecastOn ? renewalForecast(rows, now) : null;
  // D01 (décision CV-10) : vue « Personnel (Cursus) » — fiches à rattacher et absentes de Cursus, QHSE et direction.
  const peopleAdmin = manageTitles && str(sp.vue) === 'personnel' ? await loadPeopleAdmin() : null;
  const views = [
    { href: '/habilitations', label: 'Matrice', on: !forecastOn && !peopleAdmin, icon: 'ph-grid-four' },
    { href: '/habilitations?vue=a-prevoir', label: 'À prévoir · 12 mois', on: forecastOn, icon: 'ph-calendar-dots' },
    ...(manageTitles ? [{ href: '/habilitations?vue=personnel', label: 'Personnel (Cursus)', on: !!peopleAdmin, icon: 'ph-users-three' }] : []),
  ];
  const allSiteLabels = Object.fromEntries(allSites.map((x) => [x.id, x.label.split(' — ')[0]]));

  return (
    <>
      <PageHeader title={SCREENS.skills.title} sub={sub} />
      <div className="vg-page">
        {link?.notice && <MissingNotice text={link.notice} closeHref="/habilitations" />}
        {/* D09, décision CV-01 du 04/11/2026 : consultation seule, Cursus fait foi. */}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          <i className="ph ph-plugs-connected" style={{ fontSize: 13, marginRight: 6 }} aria-hidden />{CURSUS_HELD_NOTICE}
        </p>
        {!source.ok && (
          <div className="card" role="status" style={{ padding: '10px 14px', borderColor: 'var(--tone-warn-dot)', fontSize: 12.5, textWrap: 'pretty' }}>
            {source.message} Les états des titres requis ne sont pas calculés : aucune alerte ni échéance d&apos;habilitation tant que la source n&apos;est pas lue.
          </div>
        )}
        <SkillAlerts alerts={lapses} today={now} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SegLinks options={views} />
          {/* SEC-13 : droit d'accès d'un salarié (RGPD) — animateur QHSE et direction (données de santé comprises). */}
          {canSeeHealth(session.role) && (
            <a href="/habilitations/donnees-personnelles" className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }}>
              <i className="ph ph-user-list" style={{ fontSize: 13 }} aria-hidden />Données personnelles
            </a>
          )}
        </div>
        {peopleAdmin ? <PeoplePanel admin={peopleAdmin} siteLabels={allSiteLabels} canReassign={canEdit(session.role, 'actions')} /> : forecast ? (
          <div className="card" style={{ gap: 12 }}>
            <CardHead title="Recyclages et formations à prévoir" aside={(
              <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {/* Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application. */}
                <a href="/habilitations/imprimer" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
                  <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />Plan de formation
                </a>
              </span>
            )} />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              Titres requis expirés, jamais suivis, suspendus ou expirant d&apos;ici 12 mois, par mois d&apos;échéance, d&apos;après Cursus. Plan de formation
              et sessions gérés par le service RH dans Cursus : aucune action QSE n&apos;est créée.
            </p>
            <ForecastView forecast={forecast} />
          </div>
        ) : (
          <SkillMatrix titles={titles} versions={versions} archivedTitles={archivedTitles} rows={rows} others={others} departed={departed} archive={archive}
            archivedSites={archivedSites} self={self}
            canManage={manage} canManageTitles={manageTitles} catalog={catalog} options={options} today={now}
            initialSel={initialSel} closeHref="/habilitations" siteLabels={siteLabels} />
        )}
      </div>
    </>
  );
}
