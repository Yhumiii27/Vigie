import type { Metadata } from 'next';
import { LOGIN_PATH, LOGOUT_PATH, type AccessMotif } from '@/lib/auth/paths';
import { entraMissing, isDemo } from '@/lib/config';
import { AuthNotice, NoticeBody } from '@/components/AuthNotice';
import { getI18n } from '@/i18n/server';

// Manifeste du signalement installable (EVT-20) : pages /signaler seulement.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Access'), manifest: null };
}

/** Chaînes sources anglaises, rendues par t() (VG-N01). */
const TEXTS: Record<AccessMotif, { title: string; body: string }> = {
  configuration: {
    title: 'Incomplete configuration',
    body: 'Microsoft Entra ID authentication is not configured on this server: Vigie refuses all access rather than grant a default role. The administrator must set the variables below (see .env.example), then restart the server.',
  },
  'non-autorise': {
    title: 'Access not authorised',
    body: 'Your account has no Vigie role, or no site is open to you. Ask the administrator of the Microsoft directory to give you a role of the Vigie application, then sign in again.',
  },
  adresse: {
    title: 'Microsoft account not linked',
    body: 'Vigie could not link your Microsoft account to a staff record: the e-mail address sent by Microsoft is not a verified address of a company domain. Tell the QHSE coordinator or the directory administrator, who will check the address of your record and the configuration of Vigie.',
  },
  connexion: {
    title: 'Sign-in required',
    body: 'Sign in with your work Microsoft account to access Vigie.',
  },
  echec: {
    title: 'Sign-in interrupted',
    body: 'The Microsoft sign-in did not complete (time-out, sign-in page opened twice or service unavailable). Try again; if the problem persists, tell the administrator.',
  },
};

/** Refus d'accès expliqué, hors session (cible des redirections de getSession, du proxy et de /auth/retour). */
export default async function AccessPage({ searchParams }: PageProps<'/auth/acces'>) {
  const [{ motif }, { t }] = await Promise.all([searchParams, getI18n()]);
  const key: AccessMotif = motif === 'configuration' || motif === 'non-autorise' || motif === 'adresse' || motif === 'echec' ? motif : 'connexion';
  const text = TEXTS[key];
  const missing = key === 'configuration' ? entraMissing() : [];
  return (
    <AuthNotice title={t(text.title)}>
      <NoticeBody>{t(text.body)}</NoticeBody>
      {missing.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12.5 }}>
          {missing.map((m) => <li key={m}><code>{m}</code></li>)}
        </ul>
      )}
      {(key === 'connexion' || key === 'echec') && <a href={LOGIN_PATH} className="btn btn-primary">{key === 'echec' ? t('Try again') : t('Sign in')}</a>}
      {(key === 'non-autorise' || key === 'adresse') && !isDemo() && <a href={LOGOUT_PATH} className="btn btn-secondary">{t('Change account')}</a>}
    </AuthNotice>
  );
}
