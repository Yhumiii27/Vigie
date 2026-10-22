import type { Metadata } from 'next';
import { LOGIN_PATH } from '@/lib/auth/paths';
import { AuthNotice, NoticeBody } from '@/components/AuthNotice';

// Manifeste du signalement installable (EVT-20) : pages /signaler seulement.
export const metadata: Metadata = { title: 'Déconnexion', manifest: null };

/** Retour de la déconnexion Microsoft (post_logout_redirect_uri), hors session. */
export default function SignedOutPage() {
  return (
    <AuthNotice title="Vous êtes déconnecté">
      <NoticeBody>Votre session Vigie et votre session Microsoft sont terminées sur cet appareil.</NoticeBody>
      <a href={LOGIN_PATH} className="btn btn-primary">Se reconnecter</a>
    </AuthNotice>
  );
}
