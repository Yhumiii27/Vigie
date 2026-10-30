'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import {
  DECLARANT_MAX, MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_PHOTOS, MAX_PUBLIC_PHOTOS, MAX_PUBLIC_PHOTO_BYTES, REPORT_TRAP_FIELD,
} from '@/lib/rules/events';
import { createReport } from '@/server/events';
import { EVENT_TYPES, REPORT_TYPE_KEYS } from '@/lib/domain';

type Props = {
  siteLabel: string;
  /** Site du QR code de poste (sinon : site de la session, choisi par le serveur). */
  siteId?: string;
  defaultLocation: string;
  topPadding?: number;
  /** Lien vers « Mes signalements » (en-tête et écran de confirmation). */
  myReportsHref?: string;
  /** Type présélectionné (/signaler?type=ENV depuis l'écran Environnement). */
  defaultType?: string;
  /** Jeton du QR code de poste (/signaler?jeton=…), transmis au serveur qui en tire le site. */
  token?: string;
  /**
   * Formulaire sans compte (QR code de poste, EVT-07) : anonyme ou nom + entreprise déclarés, champ piège anti-robot,
   * photos limitées, pas de « Mes signalements ».
   */
  publicMode?: boolean;
  /** Lien « Se connecter » du formulaire sans compte (signaler en son nom et suivre ses signalements). */
  loginHref?: string;
  /**
   * Zones en service du site (EVT-19), proposées comme lieu quand il n'est pas pré-rempli par le QR code du poste ;
   * `defaultZoneId` : zone d'un ancien QR code.
   */
  zones?: readonly { id: number; name: string }[];
  defaultZoneId?: number;
  /** Message du QR code d'une zone archivée (« ce poste n'existe plus, choisissez le lieu »). */
  notice?: string;
  /** Zone fixée par le QR code du poste (DUE-20 : ses risques sont proposés). */
  postZoneId?: number;
  /** DUE-20 : risques de l'unité de travail de chaque zone (clé : identifiant de la zone), à rattacher au signalement. */
  zoneRisks?: Record<string, { id: number; label: string }[]>;
};

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void };
/** `cleaned` : photo réencodée sur le téléphone, donc sans métadonnées (position GPS, appareil). */
type Photo = { key: number; file: File; url: string; cleaned: boolean };
type Shrunk = { file: File; cleaned: boolean };
type Sent = { id: string; anonymous: boolean; warning?: string };

const DECLARED_IDENTITY_NOTE = 'Sans compte Vigie : votre nom et votre entreprise sont transmis tels que vous les saisissez.';

const GRAVES = ['Non', 'Peut-être', 'Oui'];
const MAX_EDGE = 1920;
const MB = 1024 * 1024;

const isImage = (f: File) => f.type.startsWith('image/') || (!f.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));

// Champs à 16 px (pas de zoom automatique d'iOS) et cibles tactiles de 44 px (UX-02).
const FIELD_FONT = 16;
const TOUCH = 44;
/** Dictée vocale disponible sur ce navigateur (le micro n'est proposé que dans ce cas) ; jamais au rendu serveur. */
const noSubscribe = () => () => {};
const hasDictation = () => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
};

/**
 * Réduit la photo (1920 px au plus, JPEG) avant l'envoi : l'envoi reste léger sur réseau mobile et le
 * réencodage retire les métadonnées (position GPS, appareil). Si le navigateur ne sait pas décoder la photo
 * (HEIC hors Safari, mémoire insuffisante…), le fichier d'origine est rendu tel quel, avec `cleaned: false`.
 */
async function shrinkPhoto(file: File): Promise<Shrunk> {
  const raw = { file, cleaned: false };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return raw; }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) return raw;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return { file: new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified }), cleaned: true };
  } catch {
    return raw;
  }
}

/** Formulaire de signalement terrain (mobile) — crée l'événement à l'étape « Déclaré ». */
export function ReportForm({ siteLabel, siteId, defaultLocation, topPadding = 62, myReportsHref, defaultType, token, publicMode = false, loginHref, zones = [], defaultZoneId, notice, postZoneId, zoneRisks = {} }: Props) {
  const maxPhotos = publicMode ? MAX_PUBLIC_PHOTOS : MAX_PHOTOS;
  const maxFileBytes = publicMode ? MAX_PUBLIC_PHOTO_BYTES : MAX_FILE_BYTES;
  const [type, setType] = useState<string | null>(defaultType ?? null);
  const [location, setLocation] = useState(defaultLocation);
  const [editLocation, setEditLocation] = useState(!defaultLocation);
  const [zoneId, setZoneId] = useState(defaultZoneId && zones.some((z) => z.id === defaultZoneId) ? String(defaultZoneId) : '');
  // Lieu choisi dans les zones du site (EVT-19) : le texte reprend le nom de la zone tant qu'il n'est pas saisi.
  const [riskId, setRiskId] = useState('');
  // DUE-20 : risques de l'unité de la zone du poste (QR code) ou de la zone choisie.
  const riskOptions = zoneRisks[String(postZoneId ?? zoneId)] ?? [];
  const pickZone = (value: string) => {
    const previous = zones.find((z) => String(z.id) === zoneId)?.name ?? '';
    setZoneId(value);
    setRiskId('');
    const z = zones.find((x) => String(x.id) === value);
    if (!location.trim() || location === previous) setLocation(z?.name ?? '');
  };
  const [description, setDescription] = useState('');
  const [grave, setGrave] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [declarant, setDeclarant] = useState('');
  const [company, setCompany] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [pending, start] = useTransition();
  const canDictate = useSyncExternalStore(noSubscribe, hasDictation, () => false);
  const rec = useRef<Recognition | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const urls = useRef(new Set<string>());
  const trap = useRef<HTMLInputElement>(null);

  // Libère les aperçus encore affichés quand le formulaire disparaît.
  useEffect(() => {
    const live = urls.current;
    return () => live.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const release = (list: Photo[]) => list.forEach((p) => { URL.revokeObjectURL(p.url); urls.current.delete(p.url); });

  const reset = () => { setSent(null); setType(defaultType ?? null); setGrave(null); setAnonymous(false); setDescription(''); setRiskId(''); setError(null); };

  const dictate = () => {
    if (listening) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) { setError("La dictée vocale n'est pas disponible sur ce navigateur."); return; }
    const r = new Ctor();
    r.lang = 'fr-FR';
    r.interimResults = false;
    r.onresult = (e) => setDescription((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}${e.results[0][0].transcript}`);
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  // Chaque photo est d'abord allégée, puis contrôlée (taille, anonymat) : une photo refusée n'écarte pas les autres.
  const addPhotos = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = '';
    if (!picked.length) return;
    const accepted = picked.slice(0, maxPhotos - photos.length);
    const notes = new Set<string>();
    const images = accepted.filter((f) => {
      if (isImage(f)) return true;
      notes.add(`« ${f.name} » n'est pas une photo.`);
      return false;
    });
    setPreparing(true);
    const shrunk = await Promise.all(images.map(shrinkPhoto));
    setPreparing(false);
    const kept = shrunk.filter(({ file, cleaned }) => {
      if (file.size > maxFileBytes) {
        notes.add(`« ${file.name} » dépasse ${maxFileBytes / MB} Mo${cleaned ? ' même allégée' : ' et ne peut pas être allégée sur ce téléphone'}.`);
        return false;
      }
      if (anonymous && !cleaned) {
        notes.add(`« ${file.name} » ne peut pas être allégée sur ce téléphone : elle n'est pas jointe au signalement anonyme.`);
        return false;
      }
      return true;
    });
    const added = kept.map(({ file, cleaned }) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { key: seq.current++, file, url, cleaned };
    });
    setPhotos((p) => [...p, ...added]);
    const skipped = picked.length - accepted.length;
    if (skipped > 0) notes.add(`${maxPhotos} photos au maximum : ${skipped} photo${skipped > 1 ? 's' : ''} non ajoutée${skipped > 1 ? 's' : ''}.`);
    setError(notes.size ? [...notes].join(' ') : null);
  };

  const removePhoto = (key: number) => {
    release(photos.filter((p) => p.key === key));
    setPhotos((list) => list.filter((p) => p.key !== key));
  };

  // Photos non allégées en mode anonyme (ajoutées avant d'activer l'option) : leurs métadonnées pourraient identifier le déclarant.
  const uncleaned = anonymous ? photos.filter((p) => !p.cleaned).length : 0;

  const submit = () => {
    if (uncleaned) {
      const s = uncleaned > 1;
      setError(`Signalement anonyme : ${uncleaned} photo${s ? 's' : ''} n'${s ? 'ont' : 'a'} pas pu être allégée${s ? 's' : ''} sur ce téléphone et ${s ? 'pourraient' : 'pourrait'} vous identifier (position, appareil). Retirez-${s ? 'les' : 'la'} avant l'envoi.`);
      return;
    }
    if (photos.reduce((s, p) => s + p.file.size, 0) > MAX_BATCH_BYTES) {
      setError(`Les photos dépassent ${MAX_BATCH_BYTES / MB} Mo au total : retirez-en une.`);
      return;
    }
    if (publicMode && !anonymous && !declarant.trim()) {
      setError('Indiquez votre nom, ou choisissez de rester anonyme.');
      return;
    }
    const fd = new FormData();
    fd.set('type', type ?? '');
    fd.set('location', location);
    if (zoneId) fd.set('zoneId', zoneId);
    if (riskId && riskOptions.some((r) => String(r.id) === riskId)) fd.set('riskId', riskId);
    if (siteId) fd.set('siteId', siteId);
    fd.set('description', description);
    if (grave) fd.set('gravity', grave);
    if (anonymous) fd.set('anonymous', '1');
    if (token) fd.set('jeton', token);
    if (publicMode) {
      if (!anonymous) { fd.set('declarant', declarant); fd.set('declarantCompany', company); }
      fd.set(REPORT_TRAP_FIELD, trap.current?.value ?? '');
    }
    // Signalement anonyme (SEC-09) : nom d'origine de la photo non transmis (le serveur le remplace aussi).
    photos.forEach((p, i) => fd.append('photos', p.file, anonymous ? `photo-${i + 1}.jpg` : p.file.name));
    start(async () => {
      try {
        const res = await createReport(fd);
        if (res.error) { setError(res.error); return; }
        setError(null);
        release(photos);
        setPhotos([]);
        setSent({ id: res.id ?? '', anonymous, warning: res.warning });
      } catch {
        setError("L'envoi a échoué. Vérifiez la connexion puis réessayez.");
      }
    });
  };

  const shell = { minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', padding: `${topPadding}px 18px 40px`, display: 'grid', gap: 16, alignContent: 'start', fontSize: 14 } as const;

  if (sent !== null) {
    return (
      <div style={shell}>
        <div style={{ display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center', paddingTop: 120 }}>
          <span style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', display: 'grid', placeItems: 'center' }}><i className="ph ph-check" style={{ fontSize: 30 }} aria-hidden /></span>
          <span style={{ fontSize: 20, fontWeight: 500 }}>Signalement envoyé</span>
          <span style={{ fontSize: 13.5, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
            {sent.id ? <>Référence {sent.id}. </> : null}L&apos;animateur QHSE le qualifie sous 48 h.{' '}
            {publicMode
              ? <>Notez sa référence pour en parler avec l&apos;animateur QHSE ou votre responsable.</>
              : sent.anonymous
                ? <>Envoyé anonymement, il n&apos;apparaîtra pas dans « Mes signalements » : notez sa référence.</>
                : <>Vous suivrez son avancement dans « Mes signalements ».</>}
          </span>
          {sent.warning && <span role="alert" style={{ fontSize: 12.5, color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>{sent.warning}</span>}
          <button type="button" className="btn btn-secondary" onClick={reset} style={{ minHeight: 44 }}>Nouveau signalement</button>
          {myReportsHref && !publicMode && (
            <Link href={myReportsHref} className="btn btn-ghost" style={{ minHeight: 44, fontSize: 13.5 }}>
              <i className="ph ph-list-checks" style={{ fontSize: 16 }} aria-hidden />Mes signalements
            </Link>
          )}
        </div>
      </div>
    );
  }

  const full = photos.length >= maxPhotos;

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.015em' }}>Signaler</span>
        <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-neutral-500)' }}><i className="ph ph-factory" aria-hidden />{siteLabel}</span>
          {myReportsHref && !publicMode && (
            <Link href={myReportsHref} style={{ display: 'flex', alignItems: 'center', gap: 5, minHeight: TOUCH, fontSize: 12, color: 'var(--color-accent)', textDecoration: 'none' }}>
              <i className="ph ph-list-checks" aria-hidden />Mes signalements
            </Link>
          )}
          {publicMode && loginHref && (
            <a href={loginHref} style={{ display: 'flex', alignItems: 'center', gap: 5, minHeight: TOUCH, fontSize: 12, color: 'var(--color-accent)', textDecoration: 'none' }}>
              <i className="ph ph-sign-in" aria-hidden />Se connecter
            </a>
          )}
        </span>
      </div>

      <div role="radiogroup" aria-label="Type de signalement" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {REPORT_TYPE_KEYS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={type === k} className={`vg-choice${type === k ? ' is-on' : ''}`} onClick={() => setType(k)}>
            <i className={`ph ${EVENT_TYPES[k].icon}`} aria-hidden />{EVENT_TYPES[k].label}
          </button>
        ))}
      </div>

      {notice && (
        <div role="status" className="vg-warn-note"><i className="ph ph-qr-code" aria-hidden /><span>{notice}</span></div>
      )}

      {editLocation && zones.length > 0 && (
        <div className="field">
          <label htmlFor="report-zone">Zone du site</label>
          <select id="report-zone" className="input" value={zoneId} onChange={(e) => pickZone(e.target.value)} style={{ fontSize: FIELD_FONT, minHeight: TOUCH }}>
            <option value="">Choisir une zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="report-location">{editLocation && zones.length > 0 ? 'Lieu précis' : 'Lieu'}</label>
        {editLocation ? (
          <input id="report-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Atelier, poste, zone…" style={{ fontSize: FIELD_FONT }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 0 10px', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
            <i className="ph ph-qr-code" style={{ fontSize: 16, color: 'var(--color-accent)' }} aria-hidden />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, padding: '9px 0' }}>{location}</span>
            <button type="button" onClick={() => setEditLocation(true)}
              style={{ minHeight: TOUCH, minWidth: TOUCH, padding: '0 10px', fontSize: 12, color: 'var(--color-accent)', background: 'none', border: 0, cursor: 'pointer' }}>Modifier</button>
          </div>
        )}
        {!editLocation && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>Pré-rempli par le QR code du poste</span>}
      </div>

      {riskOptions.length > 0 && (
        <div className="field">
          <label htmlFor="report-risk">Risque du poste concerné (facultatif)</label>
          <select id="report-risk" className="input" value={riskId} onChange={(e) => setRiskId(e.target.value)} style={{ fontSize: FIELD_FONT, minHeight: TOUCH }}>
            <option value="">Je ne sais pas</option>
            {riskOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>Risques du document unique pour ce poste</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="report-desc">Description</label>
        <div style={{ position: 'relative' }}>
          <textarea id="report-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Que s'est-il passé ?"
            style={{ minHeight: 96, fontSize: FIELD_FONT, paddingRight: canDictate ? 56 : undefined }} />
          {canDictate && (
            <button type="button" onClick={dictate} aria-label={listening ? 'Arrêter la dictée' : 'Dicter la description'} aria-pressed={listening}
              style={{ position: 'absolute', right: 6, bottom: 6, width: TOUCH, height: TOUCH, borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', background: listening ? 'color-mix(in srgb, var(--color-accent) 20%, transparent)' : 'transparent', cursor: 'pointer' }}>
              <i className="ph ph-microphone" style={{ fontSize: 18 }} aria-hidden />
            </button>
          )}
        </div>
        {type === 'AT' && (
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
            Décrivez les faits : l&apos;animateur QHSE précisera les blessures (données réservées).
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
        <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={preparing || full}
          style={{ justifyContent: 'flex-start', minHeight: 44, fontSize: 13.5 }}>
          <i className="ph ph-camera" style={{ fontSize: 18 }} aria-hidden />
          {preparing ? 'Préparation de la photo…' : full ? `${maxPhotos} photos au maximum` : photos.length ? 'Ajouter une autre photo' : 'Ajouter une photo'}
          {photos.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{photos.length}/{maxPhotos}</span>}
        </button>
        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${MAX_PHOTOS}, minmax(0, 1fr))`, gap: 8 }}>
            {photos.map((p, i) => (
              <div key={p.key} style={{ position: 'relative', aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', display: 'grid', placeItems: 'center' }}>
                <i className="ph ph-image" style={{ fontSize: 20, color: 'var(--color-neutral-600)' }} aria-hidden />
                {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) avant envoi */}
                <img src={p.url} alt={`Photo ${i + 1}`} onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                {anonymous && !p.cleaned && (
                  <span role="img" aria-label="Photo non allégée : métadonnées conservées" title="Photo non allégée : métadonnées conservées (position, appareil)"
                    style={{ position: 'absolute', left: 4, bottom: 4, width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--tone-warn-fg)', background: 'rgba(0, 0, 0, .55)' }}>
                    <i className="ph ph-warning" style={{ fontSize: 13 }} aria-hidden />
                  </span>
                )}
                {/* Zone tactile de 44 px, pastille visible de 26 px dans le coin. */}
                <button type="button" onClick={() => removePhoto(p.key)} aria-label={`Retirer la photo ${i + 1}`}
                  style={{ position: 'absolute', top: 0, right: 0, width: TOUCH, height: TOUCH, padding: 0, display: 'grid', placeItems: 'center', border: 0, cursor: 'pointer', background: 'none' }}>
                  <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', background: 'rgba(0, 0, 0, .55)' }}>
                    <i className="ph ph-x" style={{ fontSize: 13 }} aria-hidden />
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label id="report-gravity-label">Ça aurait pu être grave ?</label>
        <div role="radiogroup" aria-labelledby="report-gravity-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {GRAVES.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={grave === g} className={`vg-pill${grave === g ? ' is-on' : ''}`} onClick={() => setGrave(g)} style={{ minHeight: TOUCH }}>{g}</button>
          ))}
        </div>
      </div>

      <button type="button" role="switch" aria-checked={anonymous} onClick={() => setAnonymous((a) => !a)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, cursor: 'pointer', background: 'none', border: 0, color: 'inherit', padding: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><i className="ph ph-eye-slash" style={{ fontSize: 17, color: 'var(--color-neutral-500)' }} aria-hidden />Rester anonyme</span>
        <span className={`vg-switch${anonymous ? ' is-on' : ''}`}><span /></span>
      </button>

      {publicMode && !anonymous && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="field">
            <label htmlFor="report-name">Votre nom</label>
            <input id="report-name" className="input" value={declarant} onChange={(e) => setDeclarant(e.target.value)} maxLength={DECLARANT_MAX}
              autoComplete="name" placeholder="Prénom et nom" style={{ fontSize: FIELD_FONT }} />
          </div>
          <div className="field">
            <label htmlFor="report-company">Entreprise</label>
            <input id="report-company" className="input" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={DECLARANT_MAX}
              autoComplete="organization" placeholder="Intérim, sous-traitant, visiteur…" style={{ fontSize: FIELD_FONT }} />
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>{DECLARED_IDENTITY_NOTE}</span>
          </div>
        </div>
      )}

      {publicMode && (
        // Champ piège : hors de l'écran et du parcours clavier, ignoré des lecteurs d'écran ; seul un robot le remplit.
        <div aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="report-trap">Ne pas remplir ce champ</label>
          <input ref={trap} id="report-trap" name={REPORT_TRAP_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
      )}

      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--tone-danger-fg)' }}>{error}</div>}

      <button type="button" className="btn btn-primary btn-block" onClick={submit} disabled={pending || preparing} style={{ minHeight: 48, fontSize: 15 }}>
        <i className="ph ph-paper-plane-right" style={{ fontSize: 17 }} aria-hidden />{pending ? 'Envoi…' : 'Envoyer le signalement'}
      </button>
    </div>
  );
}
