import type { Metadata } from 'next';
import Link from 'next/link';
import { Segments, Toolbar } from '@/components/Segments';
import { PageHeader } from '@/components/PageHeader';
import { firstMinuteReasonMsg, sevesoLabel } from '@/lib/rules/prevention';
import { SiteMapScreen } from '@/components/sitemap/SiteMapScreen';
import { isRealDate } from '@/lib/rules/sitemap';
import { Icon, ToneTag } from '@/components/ui';
import { canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSitemap } from '@/lib/data/sitemap';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import { msgT } from '@/i18n/msg';
import { labelT } from '@/i18n/labels';

const TITLE = 'Site map and co-activity';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Site map and co-activity') };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });

// Même forme que PageProps<'/prevention/carte'> (types de routes générés par Next au prochain démarrage).
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SiteMapPage({ searchParams }: Props) {
  const { role, demo } = await guard('prevention');
  const { t } = await getI18n();
  const sp = await searchParams;
  const plan = str(sp.plan), permit = str(sp.permis);
  // Aucune liste du formulaire d'action : la carte ne crée pas d'action QSE (réponses du service QHSE du 15/10/2026).
  const data = await loadSitemap({ site: str(sp.site), plan, permit });
  const requested = str(sp.date);
  const initialDate = isRealDate(requested) ? requested : data.now;
  const rule = { seveso: data.site.seveso, ppFromFirstMinute: data.site.ppFromFirstMinute };

  const today = data.activities.filter((a) => a.startOn <= data.now && data.now <= a.endOn).length;
  const sub = [
    data.site.label,
    plural(today, t('{n} activity today'), t('{n} activities today')),
    data.conflictsToday.length ? plural(data.conflictsToday.length, t('{n} co-activity situation'), t('{n} co-activity situations')) : t('no co-activity situation'),
    data.toPosition.length ? plural(data.toPosition.length, t('{n} intervention to position'), t('{n} interventions to position')) : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader title={t(TITLE)} sub={sub} />
      <div className="vg-page">
        <Toolbar end={(
          <>
            {(rule.seveso || rule.ppFromFirstMinute) && (
              <span title={rule.ppFromFirstMinute ? fill(t('{reason} of an external company.'), { reason: msgT(t)(firstMinuteReasonMsg(rule)) }) : labelT(t)(sevesoLabel(rule.seveso))}>
                <ToneTag tone={rule.seveso === 'seuil_haut' ? 'danger' : 'warn'}>
                  {rule.seveso === 'seuil_haut' ? t('Upper-tier Seveso') : rule.seveso === 'seuil_bas' ? t('Lower-tier Seveso') : t('Internal rule')}
                  {rule.ppFromFirstMinute ? t(' · prevention plan from the 1st minute') : ''}
                </ToneTag>
              </span>
            )}
            <Link href="/prevention" className="btn btn-secondary vg-btn-sm"><Icon name="ph-clipboard-text" size={13} />{t('Prevention plans and permits')}</Link>
            {/* QR codes de signalement des zones (en démonstration : depuis l'aperçu mobile). */}
            {canManage(role) && !demo && (
              <Link href={`/signaler/postes?site=${encodeURIComponent(data.site.id)}`} className="btn btn-secondary vg-btn-sm"><Icon name="ph-qr-code" size={13} />{t('Station QR codes')}</Link>
            )}
          </>
        )}>
          <Segments label={t('Sites')} items={data.tabs
            ? data.tabs.map((s) => ({
              key: s.id, label: s.label, href: `/prevention/carte?site=${s.id}`, on: s.id === data.site.id,
              count: s.conflicts > 0 ? <span style={{ color: 'var(--tone-danger-fg)' }}>{s.conflicts}</span> : undefined,
              title: s.conflicts ? plural(s.conflicts, t('{n} co-activity situation today'), t('{n} co-activity situations today')) : undefined,
            }))
            : [{ key: data.site.id, label: data.site.label, href: `/prevention/carte?site=${data.site.id}`, on: true }]} />
        </Toolbar>
        <SiteMapScreen key={`${data.site.id}|${plan ?? ''}|${permit ?? ''}`} data={data} canManage={canManage(role)} initialDate={initialDate} />
      </div>
    </>
  );
}
