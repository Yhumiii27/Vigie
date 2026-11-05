import { redirect } from 'next/navigation';
import { guard } from '@/lib/guard';
import { ENGINEERING_PATH, engineeringHref, engineeringKind } from '@/lib/rules/engineering';

/**
 * Lien profond d'une fiche (D12, décision CV-06) : /modifications-techniques/<ECO-…> (Keystone, contrat NEW-D4-1) et
 * /modifications-techniques/<ECR-…> (Codex) ouvrent le registre sur la fiche (`?sel=`, onglet des demandes pour un ECR).
 * Numéro inconnu ou hors du périmètre : bandeau commun du registre (MissingNotice), rien de révélé.
 */
export default async function ModificationLink({ params }: PageProps<'/modifications-techniques/[numero]'>) {
  await guard('engineering');
  const { numero } = await params;
  const ref = decodeURIComponent(numero).trim().toUpperCase();
  redirect(engineeringKind(ref) ? engineeringHref(ref) : `${ENGINEERING_PATH}?sel=${encodeURIComponent(ref.slice(0, 40))}`);
}
