import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { DgiNoticeList, RecordDgiButton } from '@/components/events/DgiRegister';
import { referenceNow, toParisLocal } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadDgiRegister } from '@/lib/data/dgi';
import { DGI_PRINT_PATH, DGI_REGISTER_PATH, canReadDgi } from '@/lib/rules/dgi';
import { today } from '@/lib/today';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export const metadata: Metadata = { title: 'Registre des dangers graves et imminents' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Registre spécial des dangers graves et imminents d'un site (CNF-01 ; L. 4132-2, D. 4132-1 et D. 4132-2) : animateur QHSE,
// direction et membres du CSE (groupe Entra VIGIE_CSE_GROUP), quel que soit leur rôle ; les autres sont renvoyés vers
// /evenements. ?site= (par défaut : le site sélectionné), ?avis= (avis mis en évidence, lien des échéances).
export default async function DgiRegisterPage({ searchParams }: PageProps<'/evenements/registre-dgi'>) {
  const session = await guard('events');
  if (!canReadDgi(session)) redirect('/evenements');
  const { t } = await getI18n();
  const sp = await searchParams;
  const register = await loadDgiRegister(str(sp.site) ?? null);
  if (!register) redirect('/evenements');
  const avis = Number(str(sp.avis));
  const site = register.site;
  return (
    <>
      <PageHeader title={t('Register of serious and imminent dangers')} sub={site ? `${site.label} · ${fill(t('{n} notices'), { n: register.notices.length })}` : t('One register per establishment')}
        actions={site && (
          <>
            <a href={`${DGI_PRINT_PATH}?site=${encodeURIComponent(site.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
              <i className="ph ph-printer" aria-hidden />{t('Print the register')}
            </a>
            {register.rights.record && (
              <RecordDgiButton sites={register.sites.map((s) => [s.id, s.label] as const)} siteId={site.id} nowLocal={toParisLocal(referenceNow(today()))}
                defaultName={session.cse ? session.user.name : ''} signs={session.cse} />
            )}
          </>
        )} />
      <div className="vg-page">
        <p style={{ margin: 0, fontSize: 12.5, textWrap: 'pretty' }} className="vg-muted">
          {t('Kept under art. L. 4131-2, L. 4132-2, D. 4132-1 and D. 4132-2 of the French Labour Code: each notice of a staff representative on the CSE is dated and signed, with the workstations concerned, the nature and cause of the danger and the name of the exposed workers; the employer records the measures taken in it.')}
          {' '}{t('Access reserved to the QHSE coordinator, the management and the CSE members.')}
        </p>
        {!site ? (
          <div className="card" style={{ gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>{register.unknown ? t('Unknown site or outside your scope. ') : ''}{t('Choose the site’s register:')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {register.sites.map((s) => <a key={s.id} href={`${DGI_REGISTER_PATH}?site=${encodeURIComponent(s.id)}`} className="btn btn-secondary vg-btn-sm">{s.label.split(' — ')[0]}</a>)}
            </div>
          </div>
        ) : <DgiNoticeList notices={register.notices} rights={register.rights} openId={Number.isInteger(avis) ? avis : undefined} />}
      </div>
    </>
  );
}
