import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SkillAlerts } from '@/components/skills/SkillAlerts';
import { SkillMatrix } from '@/components/skills/SkillMatrix';
import { CardHead, MissingNotice, SegLinks } from '@/components/ui';
import { ForecastView } from '@/components/skills/ForecastView';
import { renewalForecast } from '@/components/skills/rules';
import { today } from '@/lib/today';
import { SCREENS, canEdit } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { ALL_SITES } from '@/lib/session';
import { loadFormOptions, type Option } from '@/lib/data/options';
import { loadSiteAdmin } from '@/lib/data/sites';
import { loadSkillMatrix } from '@/lib/data/skills';

export const metadata: Metadata = { title: SCREENS.skills.title };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function SkillsPage({ searchParams }: PageProps<'/habilitations'>) {
  const session = await guard('skills');
  const sp = await searchParams;
  // Bandeaux : titres manquants ou expirés, mais aussi expirant avant ou pendant une affectation Keystone (`lapses`).
  // Rôle Salarié : sa seule ligne, ses échéances et ses affectations (filtrées par loadSkillMatrix).
  const [{ titles, archivedTitles, rows, lapses, others, departed, archive, self }, { sites }, allSites] =
    await Promise.all([loadSkillMatrix(), loadFormOptions(), loadSiteAdmin()]);
  // Même règle que les server actions du domaine (requireSkillsEditor).
  const manage = canEdit(session.role, 'skills');
  const now = today();
  // Nouveau salarié : site sélectionné, ou le premier site en vue « Tous les sites ».
  const defaultSiteId = session.site.id === ALL_SITES ? sites[0]?.[0] ?? '' : session.site.id;
  // Vue Salarié : aucune saisie, donc aucune liste de formulaire transmise au navigateur. Aucune liste du formulaire
  // d'action : l'écran ne crée pas d'action QSE (recyclages gérés par le service RH, réponses du service QHSE du 15/10/2026).
  const options = { sites: self ? [] : sites };
  // Fiche d'un salarié encore rattaché à un site archivé (vue « Tous les sites ») : son site reste affiché tel quel.
  const archivedSites = self ? [] : allSites.filter((s) => s.archivedOn).map((s) => [s.id, `${s.label} (archivé)`] as Option);

  // Lien profond (échéances, notifications, fiche action) : ?salarie=<personId>[&titre=<titleId>].
  const personId = str(sp.salarie);
  const titleId = str(sp.titre);
  const target = personId ? rows.find((r) => r.person.id === personId) : undefined;
  const initialSel = target
    ? { personId: target.person.id, titleId: titleId && titles.some((ti) => ti.id === titleId) ? titleId : undefined }
    : undefined;

  const sub = self ? `Mes habilitations · ${titles.length} titres suivis` : `${rows.length} salariés · ${titles.length} titres suivis`;
  // HAB-09 : vue « À prévoir » (?vue=a-prevoir) — recyclages et formations des 12 prochains mois, calculés à l'affichage.
  const forecastOn = str(sp.vue) === 'a-prevoir';
  const forecast = forecastOn ? renewalForecast(rows, now) : null;
  const views = [
    { href: '/habilitations', label: 'Matrice', on: !forecastOn, icon: 'ph-grid-four' },
    { href: '/habilitations?vue=a-prevoir', label: 'À prévoir · 12 mois', on: forecastOn, icon: 'ph-calendar-dots' },
  ];

  return (
    <>
      <PageHeader title={SCREENS.skills.title} sub={sub} />
      <div className="vg-page">
        {personId && !target && <MissingNotice text={self ? 'Fiche non accessible : seules vos habilitations sont affichées.' : 'Salarié introuvable, sorti des effectifs ou hors du site sélectionné.'} closeHref="/habilitations" />}
        <SkillAlerts alerts={lapses} today={now} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SegLinks options={views} />
        </div>
        {forecast ? (
          <div className="card" style={{ gap: 12 }}>
            <CardHead title="Recyclages et formations à prévoir" aside={(
              // Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application.
              <a href="/habilitations/imprimer" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
                <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />Plan de formation
              </a>
            )} />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              Titres requis expirés, jamais suivis ou expirant d&apos;ici 12 mois, par mois d&apos;échéance. Plan de formation géré par le service RH :
              aucune action QSE n&apos;est créée.
            </p>
            <ForecastView forecast={forecast} />
          </div>
        ) : (
          <SkillMatrix titles={titles} archivedTitles={archivedTitles} rows={rows} others={others} departed={departed} archive={archive}
            archivedSites={archivedSites} self={self}
            canManage={manage} options={options} today={now} defaultSiteId={defaultSiteId}
            initialSel={initialSel} closeHref="/habilitations" />
        )}
      </div>
    </>
  );
}
