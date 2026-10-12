import type { Metadata } from 'next';
import { LOGIN_PATH, LOGOUT_PATH, type AccessMotif } from '@/lib/auth/paths';
import { entraMissing, isDemo } from '@/lib/config';
import { AuthNotice, NoticeBody } from '@/components/AuthNotice';

export const metadata: Metadata = { title: 'Accès' };

const TEXTS: Record<AccessMotif, { title: string; body: string }> = {
  configuration: {
    title: 'Configuration incomplète',
    body: "L'authentification Microsoft Entra ID n'est pas configurée sur ce serveur : Vigie refuse tout accès plutôt que d'attribuer un rôle par défaut. L'administrateur doit renseigner les variables ci-dessous (voir .env.example), puis redémarrer le serveur.",
  },
  'non-autorise': {
    title: 'Accès non autorisé',
    body: "Votre compte n'a pas de rôle Vigie, ou aucun site ne vous est ouvert. Demandez à l'administrateur de l'annuaire Microsoft de vous attribuer un rôle de l'application Vigie, puis reconnectez-vous.",
  },
  adresse: {
    title: 'Compte Microsoft non rattaché',
    body: "Vigie n'a pas pu rattacher votre compte Microsoft à une fiche du personnel : l'adresse e-mail transmise par Microsoft n'est pas une adresse vérifiée d'un domaine de l'entreprise. Prévenez l'animateur QHSE ou l'administrateur de l'annuaire, qui vérifiera l'adresse de votre fiche et la configuration de Vigie.",
  },
  connexion: {
    title: 'Connexion requise',
    body: 'Connectez-vous avec votre compte Microsoft professionnel pour accéder à Vigie.',
  },
  echec: {
    title: 'Connexion interrompue',
    body: "La connexion Microsoft n'a pas abouti (délai dépassé, page de connexion ouverte deux fois ou service indisponible). Réessayez ; si le problème persiste, prévenez l'administrateur.",
  },
};

/** Refus d'accès expliqué, hors session (cible des redirections de getSession, du proxy et de /auth/retour). */
export default async function AccessPage({ searchParams }: PageProps<'/auth/acces'>) {
  const { motif } = await searchParams;
  const key: AccessMotif = motif === 'configuration' || motif === 'non-autorise' || motif === 'adresse' || motif === 'echec' ? motif : 'connexion';
  const text = TEXTS[key];
  const missing = key === 'configuration' ? entraMissing() : [];
  return (
    <AuthNotice title={text.title}>
      <NoticeBody>{text.body}</NoticeBody>
      {missing.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12.5 }}>
          {missing.map((m) => <li key={m}><code>{m}</code></li>)}
        </ul>
      )}
      {(key === 'connexion' || key === 'echec') && <a href={LOGIN_PATH} className="btn btn-primary">{key === 'echec' ? 'Réessayer' : 'Se connecter'}</a>}
      {(key === 'non-autorise' || key === 'adresse') && !isDemo() && <a href={LOGOUT_PATH} className="btn btn-secondary">Changer de compte</a>}
    </AuthNotice>
  );
}
