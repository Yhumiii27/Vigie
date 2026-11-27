import type { Metadata } from 'next';
import { LOGIN_PATH } from '@/lib/auth/paths';
import { AuthNotice, NoticeBody } from '@/components/AuthNotice';
import { getI18n } from '@/i18n/server';

// Manifeste du signalement installable (EVT-20) : pages /signaler seulement.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Sign-out'), manifest: null };
}

/** Retour de la déconnexion Microsoft (post_logout_redirect_uri), hors session. */
export default async function SignedOutPage() {
  const { t } = await getI18n();
  return (
    <AuthNotice title={t('You are signed out')}>
      <NoticeBody>{t('Your Vigie session and your Microsoft session have ended on this device.')}</NoticeBody>
      <a href={LOGIN_PATH} className="btn btn-primary">{t('Sign in again')}</a>
    </AuthNotice>
  );
}
