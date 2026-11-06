import { redirect } from 'next/navigation';
import { guard } from '@/lib/guard';
import { hrefWith } from '@/lib/url-state';
import { ENGINEERING_PATH } from '@/lib/rules/engineering';

/**
 * « Raise ECO » de Keystone (contrat NEW-D4-1 : part, project, title, source=keystone) : ouvre le registre avec le
 * formulaire d'un nouvel ordre prérempli (QHSE ; les autres rôles voient le registre en consultation).
 */
export default async function NewModification({ searchParams }: PageProps<'/modifications-techniques/nouvelle'>) {
  await guard('engineering');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined);
  redirect(hrefWith(ENGINEERING_PATH, {}, {
    nouveau: 'ordre', article: one(sp.part), projet: one(sp.project), titre: one(sp.title), source: one(sp.source) === 'keystone' ? 'keystone' : undefined,
  }));
}
