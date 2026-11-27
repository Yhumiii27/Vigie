'use client';

import { ActionForm } from '@/components/form';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { MyTalk } from '@/lib/data/safety-talks';
import { signSafetyTalk } from '@/server/safety-talks';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

const card = { display: 'grid', gap: 8, padding: 12, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' } as const;
const muted = { fontSize: 12, color: 'var(--color-neutral-500)' } as const;

/** Feuilles d'émargement des causeries de la personne (CNF-09) : signature en un clic, horodatée, sa session seulement. */
export function MyTalks({ talks }: { talks: MyTalk[] }) {
  const { t } = useI18n();
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {talks.map((x) => (
        <li key={x.id} style={card}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, ...muted }}>
            <span>{fmtDate(x.heldOn)}</span>{x.animator && <><span>·</span><span>{x.animator}</span></>}
            <ToneTag tone={x.signedAt ? 'ok' : 'warn'} style={{ marginLeft: 'auto' }}>{x.signedAt ? fill(t('Signed on {date} at {time}'), { date: fmtDate(x.signedAt.slice(0, 10)), time: x.signedAt.slice(11, 16) }) : t('To sign')}</ToneTag>
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.35 }}>{x.theme}</span>
          {!x.signedAt && (
            <ActionForm action={signSafetyTalk} hidden={{ id: x.id }} submitLabel={t('Sign the attendance sheet')} submitIcon="ph-signature">
              <span style={muted}>{t('I certify that I took part in this talk (time-stamped signature in my name).')}</span>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}
