import QRCode from 'qrcode';

const QUIET = 4;

/** QR code en SVG, calculé côté serveur : un seul tracé pour les modules, zone de silence de 4 modules. */
export function QrCode({ value, size = 160, label }: { value: string; size?: number; label: string }) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (modules.get(y, x)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  }
  const box = n + QUIET * 2;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" style={{ display: 'block', flex: 'none' }}>
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
