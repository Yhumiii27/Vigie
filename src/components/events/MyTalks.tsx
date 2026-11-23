'use client';

import { ActionForm } from '@/components/form';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { MyTalk } from '@/lib/data/safety-talks';
import { signSafetyTalk } from '@/server/safety-talks';

const card = { display: 'grid', gap: 8, padding: 12, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' } as const;
const muted = { fontSize: 12, color: 'var(--color-neutral-500)' } as const;

/** Feuilles d'émargement des causeries de la personne (CNF-09) : signature en un clic, horodatée, sa session seulement. */
export function MyTalks({ talks }: { talks: MyTalk[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {talks.map((x) => (
        <li key={x.id} style={card}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, ...muted }}>
            <span>{fmtDate(x.heldOn)}</span>{x.animator && <><span>·</span><span>{x.animator}</span></>}
            <ToneTag tone={x.signedAt ? 'ok' : 'warn'} style={{ marginLeft: 'auto' }}>{x.signedAt ? `Signée le ${fmtDate(x.signedAt.slice(0, 10))} à ${x.signedAt.slice(11, 16)}` : 'À signer'}</ToneTag>
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.35 }}>{x.theme}</span>
          {!x.signedAt && (
            <ActionForm action={signSafetyTalk} hidden={{ id: x.id }} submitLabel="Signer la feuille d'émargement" submitIcon="ph-signature">
              <span style={muted}>J&apos;atteste avoir participé à cette causerie (signature horodatée à mon nom).</span>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}
