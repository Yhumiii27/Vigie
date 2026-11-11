import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { DgiNoticeList, RecordDgiButton } from '@/components/events/DgiRegister';
import { referenceNow, toParisLocal } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadDgiRegister } from '@/lib/data/dgi';
import { DGI_PRINT_PATH, DGI_REGISTER_PATH, canReadDgi } from '@/lib/rules/dgi';
import { today } from '@/lib/today';

export const metadata: Metadata = { title: 'Registre des dangers graves et imminents' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Registre spécial des dangers graves et imminents d'un site (CNF-01 ; L. 4132-2, D. 4132-1 et D. 4132-2) : animateur QHSE,
// direction et membres du CSE (groupe Entra VIGIE_CSE_GROUP), quel que soit leur rôle ; les autres sont renvoyés vers
// /evenements. ?site= (par défaut : le site sélectionné), ?avis= (avis mis en évidence, lien des échéances).
export default async function DgiRegisterPage({ searchParams }: PageProps<'/evenements/registre-dgi'>) {
  const session = await guard('events');
  if (!canReadDgi(session)) redirect('/evenements');
  const sp = await searchParams;
  const register = await loadDgiRegister(str(sp.site) ?? null);
  if (!register) redirect('/evenements');
  const avis = Number(str(sp.avis));
  const site = register.site;
  return (
    <>
      <PageHeader title="Registre des dangers graves et imminents" sub={site ? `${site.label} · ${register.notices.length} avis` : 'Un registre par établissement'}
        actions={site && (
          <>
            <a href={`${DGI_PRINT_PATH}?site=${encodeURIComponent(site.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
              <i className="ph ph-printer" aria-hidden />Imprimer le registre
            </a>
            {register.rights.record && (
              <RecordDgiButton sites={register.sites.map((s) => [s.id, s.label] as const)} siteId={site.id} nowLocal={toParisLocal(referenceNow(today()))}
                defaultName={session.cse ? session.user.name : ''} signs={session.cse} />
            )}
          </>
        )} />
      <div className="vg-page">
        <p style={{ margin: 0, fontSize: 12.5, textWrap: 'pretty' }} className="vg-muted">
          Tenu en application des art. L. 4131-2, L. 4132-2, D. 4132-1 et D. 4132-2 du code du travail : chaque avis d&apos;un représentant du personnel au CSE
          est daté et signé, avec les postes concernés, la nature et la cause du danger et le nom des travailleurs exposés ; l&apos;employeur y consigne les mesures prises.
          Accès réservé à l&apos;animateur QHSE, à la direction et aux membres du CSE.
        </p>
        {!site ? (
          <div className="card" style={{ gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>{register.unknown ? 'Site inconnu ou hors de votre périmètre. ' : ''}Choisissez le registre du site :</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {register.sites.map((s) => <a key={s.id} href={`${DGI_REGISTER_PATH}?site=${encodeURIComponent(s.id)}`} className="btn btn-secondary vg-btn-sm">{s.label.split(' — ')[0]}</a>)}
            </div>
          </div>
        ) : <DgiNoticeList notices={register.notices} rights={register.rights} openId={Number.isInteger(avis) ? avis : undefined} />}
      </div>
    </>
  );
}
