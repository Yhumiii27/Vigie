import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { firstMinuteReason, sevesoLabel } from '@/components/prevention/model';
import { SiteMapScreen } from '@/components/sitemap/SiteMapScreen';
import { isRealDate } from '@/components/sitemap/model';
import { Icon, ToneTag } from '@/components/ui';
import { canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSitemap } from '@/lib/data/sitemap';

const TITLE = 'Carte du site et coactivité';
export const metadata: Metadata = { title: TITLE };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// Même forme que PageProps<'/prevention/carte'> (types de routes générés par Next au prochain démarrage).
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SiteMapPage({ searchParams }: Props) {
  const { role, demo } = await guard('prevention');
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
    `${plural(today, 'activité', 'activités')} aujourd'hui`,
    data.conflictsToday.length ? plural(data.conflictsToday.length, 'situation de coactivité', 'situations de coactivité') : 'aucune situation de coactivité',
    data.toPosition.length ? plural(data.toPosition.length, 'intervention à positionner', 'interventions à positionner') : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader title={TITLE} sub={sub} />
      <div className="vg-page">
        <div className="vg-tabs">
          {data.tabs
            ? data.tabs.map((t) => (
              <Link key={t.id} href={`/prevention/carte?site=${t.id}`} scroll={false} className={`vg-tab${t.id === data.site.id ? ' is-on' : ''}`}
                title={t.conflicts ? `${plural(t.conflicts, 'situation de coactivité', 'situations de coactivité')} aujourd'hui` : undefined}>
                <span>{t.label}</span>
                {t.conflicts > 0 && <span style={{ fontSize: 11, color: 'var(--tone-danger-fg)' }}>{t.conflicts}</span>}
              </Link>
            ))
            : <span className="vg-tab is-on" style={{ cursor: 'default' }}>{data.site.label}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6, flexWrap: 'wrap' }}>
            {(rule.seveso || rule.ppFromFirstMinute) && (
              <span title={rule.ppFromFirstMinute ? `${firstMinuteReason(rule)} d'une entreprise extérieure.` : sevesoLabel(rule.seveso)}>
                <ToneTag tone={rule.seveso === 'seuil_haut' ? 'danger' : 'warn'}>
                  {rule.seveso === 'seuil_haut' ? 'Seveso seuil haut' : rule.seveso === 'seuil_bas' ? 'Seveso seuil bas' : 'Règle interne'}
                  {rule.ppFromFirstMinute ? ' · plan de prévention dès la 1re minute' : ''}
                </ToneTag>
              </span>
            )}
            <Link href="/prevention" className="btn btn-secondary vg-btn-sm"><Icon name="ph-clipboard-text" size={13} />Plans de prévention et permis</Link>
            {/* QR codes de signalement des zones (en démonstration : depuis l'aperçu mobile). */}
            {canManage(role) && !demo && (
              <Link href={`/signaler/postes?site=${encodeURIComponent(data.site.id)}`} className="btn btn-secondary vg-btn-sm"><Icon name="ph-qr-code" size={13} />QR codes des postes</Link>
            )}
          </span>
        </div>
        <SiteMapScreen key={`${data.site.id}|${plan ?? ''}|${permit ?? ''}`} data={data} canManage={canManage(role)} initialDate={initialDate} />
      </div>
    </>
  );
}
