import { TONE } from '@/lib/domain';
import { FRANCE_PATH, MAP_HEIGHT, MAP_WIDTH, siteSummary, siteTone, type MapSite } from '@/lib/rules/sites-map';

// Carte des sites (PRV-24) : sous « Tous les sites », carte SVG sans fond externe (contour simplifié de la France) et
// tableau des mêmes indicateurs (alternative textuelle, lue par les lecteurs d'écran). Chaque point est un lien vers la ligne
// du site dans le tableau, nommé par le résumé de ses indicateurs. Composant serveur, sans script.

type Placed = MapSite & { x: number; y: number };

const rowId = (id: string) => `carte-site-${id}`;

export function SitesMap({ placed, unplaced, all, message }: { placed: Placed[]; unplaced: MapSite[]; all: MapSite[]; message: string | null }) {
  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="card-title" style={{ fontSize: 14, margin: 0 }}>Carte des sites</h2>
        <span className="vg-muted" style={{ fontSize: 11.5 }}>Coordonnées publiées par Matrix · {all.length} site{all.length > 1 ? 's' : ''} suivi{all.length > 1 ? 's' : ''}</span>
      </div>
      {message && <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--tone-warn-fg)' }}>{message}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 14, alignItems: 'start' }}>
        <svg viewBox={`-10 -10 ${MAP_WIDTH + 20} ${MAP_HEIGHT + 20}`} role="group" aria-label="Carte des sites suivis en France métropolitaine"
          style={{ width: '100%', maxWidth: 420, height: 'auto', justifySelf: 'center' }}>
          <path d={FRANCE_PATH} fill="var(--color-neutral-800)" stroke="var(--color-neutral-600)" strokeWidth={1} aria-hidden />
          {placed.map((s) => {
            const tone = TONE[siteTone(s.indicators)];
            return (
              <a key={s.id} href={`#${rowId(s.id)}`} aria-label={siteSummary(s.label, s.indicators)}>
                <title>{siteSummary(s.label, s.indicators)}</title>
                <circle cx={s.x} cy={s.y} r={7} fill={tone.dot} stroke="var(--color-bg, #fff)" strokeWidth={2} />
                <text x={s.x + 10} y={s.y + 4} fontSize={11} fill="currentColor">{s.label}</text>
              </a>
            );
          })}
        </svg>
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="group" aria-label="Indicateurs par site, défilement horizontal sur petit écran">
          <table className="table" style={{ fontSize: 12.5 }}>
            <caption className="vg-sr-only">Indicateurs par site</caption>
            <thead>
              <tr><th scope="col">Site</th><th scope="col">Événements ouverts</th><th scope="col">Actions en retard</th><th scope="col">Jours sans accident avec arrêt</th><th scope="col">Plans de prévention ouverts</th></tr>
            </thead>
            <tbody>
              {all.map((s) => (
                <tr key={s.id} id={rowId(s.id)}>
                  <th scope="row" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{s.label}</th>
                  <td>{s.indicators.openEvents}</td>
                  <td style={s.indicators.lateActions ? { color: 'var(--tone-danger-fg)' } : undefined}>{s.indicators.lateActions}</td>
                  <td>{s.indicators.daysWithoutAccident ?? '—'}</td>
                  <td>{s.indicators.openPlans}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {unplaced.length > 0 && (
        <p style={{ margin: 0, fontSize: 12 }} className="vg-muted">
          Sans coordonnées dans Matrix (absents de la carte, présents dans le tableau) : {unplaced.map((s) => s.label).join(', ')}.
        </p>
      )}
    </div>
  );
}
