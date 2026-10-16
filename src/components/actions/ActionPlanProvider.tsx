'use client';

import { createContext, useCallback, useContext, useMemo, useState, useTransition, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog } from '@/components/Dialog';
import { actionHref } from '@/lib/action-rules';
import type { ActionDetailPayload, ActionFormOptions } from '@/lib/action-view';
import { ActionDetail } from './ActionDetail';

type Ctx = { open: (id: string) => void };
const ActionPlanCtx = createContext<Ctx | null>(null);

function useActionPlan() {
  const ctx = useContext(ActionPlanCtx);
  if (!ctx) throw new Error('useActionPlan doit être utilisé dans <ActionPlanProvider>.');
  return ctx;
}

type ProviderProps = {
  /** Identifiant demandé par ?action=… (null : aucune fiche demandée). */
  requestedId: string | null;
  /** Fiche rendue par le serveur pour ?action=… (loadActionDetail) ; null : introuvable, autre site, ou aucune demande. */
  payload: ActionDetailPayload | null;
  /** Listes du formulaire (vides pour qui n'est pas QHSE). */
  options: ActionFormOptions;
  currentUserId: string;
  today: string;
  /** Date proposée pour la vérification d'efficacité (J+30). */
  verifyDefault: string;
  children: ReactNode;
};

/** URL courante avec ?action= posé (id) ou retiré (null), les autres filtres conservés. */
function withAction(pathname: string, id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id) params.set('action', id);
  else params.delete('action');
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Fiche d'action en fenêtre modale, partagée par les trois vues du plan (plan du paquet 1, flux C, tâche 3). Les lignes
 * de la vue générale ne portent aucun détail : ouvrir une fiche navigue vers ?action=<id> (sans défilement), la page
 * rend alors la fiche côté serveur (loadActionDetail : fil, preuves, historique, droits du lecteur) et ce composant
 * l'affiche ; la fermeture retire ?action=. Fiche refusée ou d'un autre site : la fenêtre se ferme, la page affiche
 * le bandeau correspondant.
 */
export function ActionPlanProvider({ requestedId, payload, options, currentUserId, today, verifyDefault, children }: ProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const serverId = payload?.detail.id ?? null;

  const [openId, setOpenId] = useState<string | null>(serverId);
  // Nouvelle réponse du serveur (navigation, actualisation après une écriture) : la fenêtre suit la fiche rendue.
  const serverKey = `${requestedId ?? ''}|${serverId ?? ''}`;
  const [prevKey, setPrevKey] = useState(serverKey);
  if (serverKey !== prevKey) {
    setPrevKey(serverKey);
    setOpenId(serverId);
  }

  const open = useCallback((id: string) => {
    setOpenId(id);
    startTransition(() => router.push(withAction(pathname, id), { scroll: false }));
  }, [pathname, router]);

  const close = () => {
    setOpenId(null);
    router.replace(withAction(pathname, null), { scroll: false });
  };

  const current = payload && openId === payload.detail.id ? payload : null;
  const title = current ? `${current.detail.id} · ${current.detail.label}` : openId ? `Action ${openId}` : '';
  const ctx = useMemo(() => ({ open }), [open]);

  return (
    <ActionPlanCtx.Provider value={ctx}>
      {children}
      <Dialog open={!!openId} onClose={close} title={title} kicker="Plan d'actions unique" width={720}>
        {current
          ? <ActionDetail key={current.detail.id} detail={current.detail} rights={current.rights} options={options}
              currentUserId={currentUserId} today={today} verifyDefault={verifyDefault} />
          : openId && (
            <div className="vg-muted" style={{ fontSize: 12.5, padding: '8px 0' }} aria-busy={pending}>
              Chargement de la fiche…
            </div>
          )}
      </Dialog>
    </ActionPlanCtx.Provider>
  );
}

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** Lien vers la fiche d'une action : ouvre la fenêtre (clic simple) ou un nouvel onglet (clic molette, ⌘/Ctrl). */
export function ActionLink({ id, className, style, title, children }: { id: string; className?: string; style?: CSSProperties; title?: string; children: ReactNode }) {
  const { open } = useActionPlan();
  return (
    <a href={actionHref(id)} className={className} style={style} title={title}
      onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); open(id); }}>
      {children}
    </a>
  );
}

/** Ligne de tableau ouvrant la fiche de l'action (la cellule de numéro garde un vrai lien). */
export function ActionTableRow({ id, style, children }: { id: string; style?: CSSProperties; children: ReactNode }) {
  const { open } = useActionPlan();
  return (
    <tr className="is-clickable" style={style} onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; open(id); }}>
      {children}
    </tr>
  );
}
