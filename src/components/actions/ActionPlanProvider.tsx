'use client';

import { createContext, useCallback, useContext, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog } from '@/components/Dialog';
import { Icon } from '@/components/ui';
import type { PlanAction } from '@/lib/data/actions';
import type { FormOptions } from '@/lib/data/options';
import { TONE } from '@/lib/domain';
import { ActionDetail } from './ActionDetail';

type Ctx = { open: (id: string) => void };
const ActionPlanCtx = createContext<Ctx | null>(null);

function useActionPlan() {
  const ctx = useContext(ActionPlanCtx);
  if (!ctx) throw new Error('useActionPlan doit être utilisé dans <ActionPlanProvider>.');
  return ctx;
}

type ProviderProps = {
  /** Actions affichées (après filtres). */
  actions: PlanAction[];
  /** Action ouverte par lien direct, même hors filtres ou clôturée depuis plus de 30 jours. */
  linked: PlanAction | null;
  /** Identifiant passé dans ?action=… (fiche à ouvrir au chargement). */
  initialOpenId: string | null;
  /** Action demandée par ?action=… mais rattachée à un autre site que celui sélectionné (libellé « site de [Ville B] »). */
  moved: { id: string; site: string } | null;
  options: Pick<FormOptions, 'people' | 'origins' | 'sites'>;
  canManage: boolean;
  canApprove: boolean;
  today: string;
  /** Date proposée pour la vérification d'efficacité (J+30). */
  verifyDefault: string;
  children: ReactNode;
};

/**
 * Fiche d'action en fenêtre modale, partagée par les trois vues du plan.
 * L'URL porte l'action ouverte (?action=A-214) pour les liens directs ; la fermeture retire le paramètre.
 */
export function ActionPlanProvider({ actions, linked, initialOpenId, moved, options, canManage, canApprove, today, verifyDefault, children }: ProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const byId = useMemo(() => new Map([...actions, ...(linked ? [linked] : [])].map((a) => [a.id, a])), [actions, linked]);

  const [openId, setOpenId] = useState(initialOpenId);
  // Un nouveau lien direct reçu du serveur (navigation vers /actions?action=…) rouvre la fiche correspondante,
  // sauf si l'action ouverte vient de quitter le site sélectionné : la fiche reste ouverte pour le signaler.
  const [prevInitial, setPrevInitial] = useState(initialOpenId);
  if (initialOpenId !== prevInitial) {
    setPrevInitial(initialOpenId);
    if (!(moved && moved.id === openId)) setOpenId(initialOpenId);
  }

  // Fiche ouverte = version renvoyée par le serveur à chaque actualisation : l'URL porte ?action=…, qui la charge
  // même hors filtres. Jamais de copie antérieure : une action passée sur un autre site est signalée comme telle.
  const current = openId ? byId.get(openId) ?? null : null;
  const away = !current && moved && moved.id === openId ? moved : null;
  const [lastTitle, setLastTitle] = useState<[string, string] | null>(current ? [current.id, current.title] : null);
  if (current && (lastTitle?.[0] !== current.id || lastTitle[1] !== current.title)) setLastTitle([current.id, current.title]);
  const title = current?.title ?? (away ? (lastTitle?.[0] === away.id ? lastTitle[1] : `Action ${away.id}`) : '');

  const open = useCallback((id: string) => {
    setOpenId(id);
    const params = new URLSearchParams(window.location.search);
    params.set('action', id);
    window.history.replaceState(null, '', `${pathname}?${params}`);
  }, [pathname]);

  const close = () => {
    setOpenId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete('action');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const ctx = useMemo(() => ({ open }), [open]);

  return (
    <ActionPlanCtx.Provider value={ctx}>
      {children}
      <Dialog open={!!(current || away)} onClose={close} title={title} kicker="Plan d'actions unique" width={640}>
        {current && (
          <ActionDetail key={current.id} a={current} options={options} canManage={canManage} canApprove={canApprove} today={today} verifyDefault={verifyDefault} />
        )}
        {away && <MovedNotice id={away.id} site={away.site} onClose={close} />}
      </Dialog>
    </ActionPlanCtx.Provider>
  );
}

/** Fiche d'une action qui vient d'être rattachée à un autre site : elle sort du plan affiché. */
function MovedNotice({ id, site, onClose }: { id: string; site: string; onClose: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, textWrap: 'pretty' }}>
        <Icon name="ph-map-pin-line" size={15} style={{ color: TONE.warn.dot, flex: 'none', marginTop: 1 }} />
        <span>
          L&apos;action {id} relève désormais du {site} : elle n&apos;apparaît plus dans le plan d&apos;actions du site sélectionné.
          Sélectionnez ce site ou « Tous les sites » dans la barre latérale pour la consulter.
        </span>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** Lien vers la fiche d'une action : ouvre la fenêtre (clic simple) ou un nouvel onglet (clic molette, ⌘/Ctrl). */
export function ActionLink({ id, className, style, children }: { id: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const { open } = useActionPlan();
  return (
    <a href={`/actions?action=${encodeURIComponent(id)}`} className={className} style={style}
      onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); open(id); }}>
      {children}
    </a>
  );
}

/** Ligne de tableau ouvrant la fiche de l'action (la cellule de référence garde un vrai lien). */
export function ActionTableRow({ id, children }: { id: string; children: ReactNode }) {
  const { open } = useActionPlan();
  return (
    <tr className="is-clickable" onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; open(id); }}>
      {children}
    </tr>
  );
}
