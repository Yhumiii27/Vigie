const Skel = ({ w, h = 12 }: { w: number | string; h?: number }) => <span className="vg-skel" style={{ width: w, height: h }} />;

/** Squelette pendant le chargement d'un écran (aucun accès aux données). */
export default function Loading() {
  return (
    <>
      <header className="vg-header">
        <div style={{ display: 'grid', gap: 6 }}>
          <Skel w={280} h={22} />
          <Skel w={200} />
        </div>
      </header>
      <div className="vg-page" aria-busy="true" aria-label="Chargement" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card" style={{ gap: 8, padding: '12px 14px' }}>
              <Skel w="70%" h={10} />
              <Skel w={60} h={26} />
              <Skel w="85%" h={10} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="card" style={{ gap: 10 }}>
              <Skel w="55%" h={14} />
              {Array.from({ length: 5 }, (_, j) => <Skel key={j} w={`${90 - j * 12}%`} h={14} />)}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
