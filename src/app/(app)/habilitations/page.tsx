import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SkillAlerts } from '@/components/skills/SkillAlerts';
import { SkillMatrix } from '@/components/skills/SkillMatrix';
import { MissingNotice } from '@/components/ui';
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

  return (
    <>
      <PageHeader title={SCREENS.skills.title} sub={sub} />
      <div className="vg-page">
        {personId && !target && <MissingNotice text={self ? 'Fiche non accessible : seules vos habilitations sont affichées.' : 'Salarié introuvable, sorti des effectifs ou hors du site sélectionné.'} closeHref="/habilitations" />}
        <SkillAlerts alerts={lapses} today={now} />
        <SkillMatrix titles={titles} archivedTitles={archivedTitles} rows={rows} others={others} departed={departed} archive={archive}
          archivedSites={archivedSites} self={self}
          canManage={manage} options={options} today={now} defaultSiteId={defaultSiteId}
          initialSel={initialSel} closeHref="/habilitations" />
      </div>
    </>
  );
}
