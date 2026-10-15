import { describe, expect, it, vi } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { AuthState } from '@/lib/auth';
import { toParisLocal } from '@/lib/dates';
import { loadBenignRegister, loadEventChangeLog, loadEventDetail, loadFirstAiders } from '@/lib/data/events';
import { loadVisibleTodo } from '@/lib/data/todo';
import {
  cancelBenignAccident, createEvent, dismissEvent, escalateBenignAccident, registerBenignAccident, saveEvent, signBenignAccident,
} from '@/server/events';

// Registre des accidents du travail bénins (EVT-04, art. L. 441-4 et D. 441-1 à D. 441-4 CSS) : un registre par site,
// accident sans arrêt ni soins médicaux soigné par un secouriste SST valide ou un professionnel de santé, numéro d'ordre
// jamais réattribué, visas du registre imprimé, bascule en déclaration CPAM, annulation motivée ; données de santé
// (animateur QHSE et direction seulement, journal réservé).

// Identité imposée par un test (périmètre restreint), sinon rôle de démonstration (cookie).
const auth = vi.hoisted(() => ({ override: null as AuthState | null }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, getAuthState: async () => auth.override ?? real.getAuthState() };
});

freshDemoDatabase();

const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = "Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.";
const OUTSIDE = 'Cet élément appartient à un site hors de votre périmètre.';

/** Accident bénin (premiers soins) saisi par l'animateur QHSE, étape « Déclaré ». */
async function benignAt(siteId = 'ville-a') {
  actAs('Animateur QHSE', siteId);
  const r = await createEvent({}, form({
    type: 'AT', title: 'Accident · atelier', occurredOn: '2026-10-08', occurredTime: '09:30', location: 'Atelier montage', severity: '1', siteId,
    declarantId: 'tnguyen', pilotId: 'sbenali', injury: 'soins', victimKind: 'salarie', victimId: 'tnguyen', circumstances: 'Main éraflée sur un carter.',
    lesionNature: 'Éraflure', lesionSite: 'Dos de la main droite',
  }));
  expect(r).toMatchObject({ ok: true });
  return r.id!;
}
const inscription = (id: string, over: Record<string, string> = {}) => form({
  id, careGivenAt: '2026-10-08T09:45', caregiverKind: 'staff', caregiverId: 'sbenali', care: 'Désinfection et pansement', ...over,
});
const entryOf = async (eventId: string) => (await (await getDb()).select().from(t.benignAccidents)
  .where(and(eq(t.benignAccidents.eventId, eventId), isNull(t.benignAccidents.cancelledAt))))[0];
const formOf = async (id: string, over: Record<string, string> = {}) => {
  const [e] = await (await getDb()).select().from(t.events).where(eq(t.events.id, id));
  const s = (v: string | number | null) => (v == null ? '' : String(v));
  return form({
    id, type: e.type, title: e.title, occurredOn: e.occurredOn, occurredTime: s(e.occurredTime), location: e.location, severity: s(e.severity), siteId: e.siteId,
    pilotId: s(e.pilotId), description: e.description, immediateMeasures: e.immediateMeasures, victimKind: s(e.victimKind), victimId: s(e.victimId),
    circumstances: s(e.circumstances), injury: s(e.injury), lostDays: s(e.lostDays), cpamDeclaredOn: s(e.cpamDeclaredOn), ...over,
  });
};

describe('inscription au registre', () => {
  let id = '';
  it('droits : animateur QHSE et direction seulement', async () => {
    id = await benignAt();
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role, 'ville-a');
      expect(await registerBenignAccident({}, inscription(id)), role).toEqual({ error: APPROVERS_ONLY });
    }
  });

  it('site : site sélectionné, puis périmètre', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await registerBenignAccident({}, inscription(id))).toEqual({ error: OTHER_SITE });
    // Direction au périmètre restreint au site B ([J. Petit], rattaché au site B).
    auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role: 'Direction', siteIds: ['ville-b'] } };
    cookieJar.set('vigie_site', 'ville-b');
    expect(await registerBenignAccident({}, inscription(id))).toEqual({ error: OUTSIDE });
    expect(await loadBenignRegister('ville-a')).toBeNull();
    expect(await loadBenignRegister('ville-b')).toMatchObject({ site: { id: 'ville-b' } });
    auth.override = null;
  });

  it('conditions : premiers soins seulement, une inscription active par accident', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await registerBenignAccident({}, inscription('EV-2026-119'))).toEqual({ error: 'Seul un accident sans arrêt ni soins médicaux (premiers soins) s’inscrit au registre des accidents bénins.' });
    actAs('Animateur QHSE', 'ville-a');
    expect(await registerBenignAccident({}, inscription('EV-2026-118'))).toEqual({ error: 'Accident déjà inscrit au registre des accidents bénins (n° 1).' });
    expect(await registerBenignAccident({}, inscription('EV-2026-131'))).toEqual({ error: "Seul un accident du travail s'inscrit au registre des accidents bénins." });
  });

  it('donneur de soins : secouriste SST valide à la date des soins, ou professionnel de santé qualifié', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const noSst = 'Sans titre de secouriste du travail (SST) valide à la date des soins sur ce site.';
    expect(await registerBenignAccident({}, inscription(id, { caregiverId: 'kbernard' }))).toMatchObject({ fieldErrors: { caregiverId: noSst } });
    // Titre SST expiré avant les soins.
    await (await getDb()).insert(t.qualifications).values({ personId: 'kbernard', titleId: 'sst', obtainedOn: '2024-01-15', expiresOn: '2026-01-15' });
    expect((await loadFirstAiders('ville-a', '2025-06-01')).map((a) => a.id)).toContain('kbernard');
    expect((await loadFirstAiders('ville-a', '2026-10-08')).map((a) => a.id)).not.toContain('kbernard');
    expect(await registerBenignAccident({}, inscription(id, { caregiverId: 'kbernard' }))).toMatchObject({ fieldErrors: { caregiverId: noSst } });
    // Secouriste d'un autre site : non proposé.
    expect(await registerBenignAccident({}, inscription(id, { caregiverId: 'amartin' }))).toMatchObject({ fieldErrors: { caregiverId: noSst } });
    expect(await registerBenignAccident({}, inscription(id, { caregiverKind: 'pro', caregiverId: '', caregiverName: 'Dr Weber' }))).toMatchObject({ fieldErrors: { caregiverQualification: 'Choix obligatoire.' } });
    expect(await registerBenignAccident({}, inscription(id, { caregiverKind: 'pro', caregiverName: 'Dr Weber', caregiverQualification: 'sst' }))).toMatchObject({ fieldErrors: { caregiverQualification: 'Valeur non autorisée.' } });
    expect(await registerBenignAccident({}, inscription(id, { careGivenAt: '2026-10-07T09:00' }))).toMatchObject({ fieldErrors: { careGivenAt: "Les soins ne peuvent pas précéder l'accident." } });
    expect(await registerBenignAccident({}, inscription(id, { care: '' }))).toMatchObject({ fieldErrors: { care: 'Champ obligatoire.' } });
    expect(await registerBenignAccident({}, inscription(id))).toEqual({ ok: true, id });
  });

  it('numérotation par site : suite du registre du site A, registre distinct du site B', async () => {
    expect(await entryOf(id)).toMatchObject({ siteId: 'ville-a', number: 3, caregiverId: 'sbenali', caregiverQualification: 'sst', createdById: 'clefevre' });
    const b = await benignAt('ville-b');
    actAs('Animateur QHSE', 'ville-b');
    expect(await registerBenignAccident({}, inscription(b, { caregiverKind: 'pro', caregiverId: '', caregiverName: 'Dr Weber', caregiverQualification: 'medecin' }))).toEqual({ ok: true, id: b });
    expect(await entryOf(b)).toMatchObject({ siteId: 'ville-b', number: 1, caregiverId: null, caregiverName: 'Dr Weber', caregiverQualification: 'medecin' });
  });

  it('journal réservé ; fiche : inscription pour l’animateur QHSE, rien pour les autres rôles', async () => {
    expect(await lastLog('event', id)).toMatchObject({
      action: 'register', summary: 'Inscrit au registre des accidents bénins', byId: 'clefevre', details: [{ field: 'Registre des accidents bénins', from: null, to: 'n° 3 · Site de [Ville A]' }],
    });
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadEventChangeLog(id)).map((e) => e.summary)).toContain('Inscrit au registre des accidents bénins');
    const d = await loadEventDetail(id);
    expect(d?.register).toMatchObject({ canRegister: false, entry: { number: 3, caregiver: '[S. Benali]', care: 'Désinfection et pansement', signedOn: null } });
    expect(d?.cpam).toMatchObject({ label: 'Non requise · inscrit au registre des accidents bénins (n° 3)', canWaive: false });
    expect(d?.blocker).toBeNull();
    actAs('Chef de service', 'ville-a');
    expect((await loadEventChangeLog(id)).map((e) => e.summary)).not.toContain('Inscrit au registre des accidents bénins');
    const restricted = await loadEventDetail(id);
    expect(restricted).toMatchObject({ register: null, cpam: null });
    expect(JSON.stringify(restricted)).not.toMatch(/registre|bénin|soins"/i);
  });

  it('fiche verrouillée par l’inscription : blessure et type conservés, classement refusé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveEvent({}, await formOf(id, { injury: 'arret' }))).toMatchObject({ fieldErrors: { injury: 'Inscrit au registre des accidents bénins : utilisez « Basculer en déclaration CPAM ».' } });
    expect(await saveEvent({}, await formOf(id, { type: 'PA' }))).toMatchObject({ fieldErrors: { type: "Inscrit au registre des accidents bénins : annulez d'abord l'inscription." } });
    // Changement de site admis (« Tous les sites ») : l'inscription reste au registre du site A.
    actAs('Animateur QHSE', 'all');
    expect(await saveEvent({}, await formOf(id, { siteId: 'ville-b' }))).toEqual({ ok: true, id });
    expect(await entryOf(id)).toMatchObject({ siteId: 'ville-a', number: 3 });
    expect(await saveEvent({}, await formOf(id, { siteId: 'ville-a' }))).toEqual({ ok: true, id });
    expect(await dismissEvent({}, form({ id, reason: 'Doublon' }))).toEqual({ error: "Annulez d'abord l'inscription au registre des accidents bénins." });
  });
});

describe('visas, bascule et annulation', () => {
  let id = '';
  it('visas : date entre les soins et aujourd’hui, journal réservé', async () => {
    id = await benignAt();
    expect(await registerBenignAccident({}, inscription(id, { caregiverId: 'proux' }))).toEqual({ ok: true, id });
    const entry = await entryOf(id);
    expect(entry.number).toBe(4);
    actAs('Chef de service', 'ville-a');
    expect(await signBenignAccident({}, form({ id: String(entry.id), signedOn: '2026-10-09' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-b');
    expect(await signBenignAccident({}, form({ id: String(entry.id), signedOn: '2026-10-09' }))).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'ville-a');
    expect(await signBenignAccident({}, form({ id: String(entry.id), signedOn: '2026-10-07' }))).toMatchObject({ fieldErrors: { signedOn: 'Les visas ne peuvent pas précéder les soins.' } });
    expect(await signBenignAccident({}, form({ id: String(entry.id), signedOn: '2026-10-10' }))).toMatchObject({ fieldErrors: { signedOn: "La date ne peut pas être postérieure à aujourd'hui." } });
    expect(await signBenignAccident({}, form({ id: String(entry.id), signedOn: '2026-10-09' }))).toEqual({ ok: true, id });
    expect((await entryOf(id)).signedOn).toBe('2026-10-09');
    expect(await lastLog('event', id)).toMatchObject({ action: 'register-sign', details: [{ field: 'Registre des accidents bénins', from: 'n° 4 · visas à recueillir', to: 'n° 4 · visé le 09/10/2026' }] });
  });

  it('bascule en déclaration CPAM : blessure, échéance de 48 h depuis la connaissance de l’arrêt, retour aux premiers soins refusé', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await escalateBenignAccident({}, form({ id, injury: 'arret', knownAt: '2026-10-08T18:00' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-a');
    expect(await escalateBenignAccident({}, form({ id, injury: 'soins', knownAt: '2026-10-08T18:00' }))).toMatchObject({ fieldErrors: { injury: 'Valeur non autorisée.' } });
    expect(await escalateBenignAccident({}, form({ id, injury: 'arret', knownAt: '2026-10-08T09:00' }))).toMatchObject({ fieldErrors: { knownAt: 'La date ne peut pas précéder les soins inscrits au registre.' } });
    expect(await escalateBenignAccident({}, form({ id, injury: 'arret', lostDays: '2', knownAt: '2026-10-08T18:00' }))).toEqual({ ok: true, id });
    const [ev] = await (await getDb()).select().from(t.events).where(eq(t.events.id, id));
    expect(ev).toMatchObject({ injury: 'arret', lostDays: 2 });
    expect(toParisLocal((await entryOf(id)).escalatedAt!)).toBe('2026-10-08T18:00');
    expect(await lastLog('event', id)).toMatchObject({
      action: 'register-escalate',
      details: [
        { field: 'Blessure', from: 'Premiers soins · accident bénin', to: 'Avec arrêt de travail' },
        { field: 'Jours perdus', from: null, to: '2' },
        { field: 'Registre des accidents bénins', from: 'Inscrit (n° 4)', to: 'Basculé en déclaration CPAM' },
      ],
    });
    // Jeudi 08/10 à 18 h : vendredi et samedi décomptés → samedi 10/10 à 18 h.
    const todo = (await loadVisibleTodo()).find((x) => x.kind === 'Déclaration AT à la CPAM' && x.title.startsWith(`${id} `));
    expect(todo).toMatchObject({ date: '2026-10-10', health: true });
    expect((await loadEventDetail(id))?.cpam?.label).toBe('À déclarer avant le 10/10/2026 à 18 h 00');
    expect(await escalateBenignAccident({}, form({ id, injury: 'arret', knownAt: '2026-10-08T18:00' }))).toEqual({ error: 'Accident déjà basculé en déclaration CPAM.' });
    expect(await saveEvent({}, await formOf(id, { injury: 'soins', lostDays: '' }))).toMatchObject({ fieldErrors: { injury: 'Accident basculé en déclaration CPAM : la blessure ne revient pas aux premiers soins.' } });
    expect(await saveEvent({}, await formOf(id, { injury: 'sans_arret', lostDays: '' }))).toEqual({ ok: true, id });
    actAs('Chef de service', 'ville-a');
    expect(JSON.stringify(await loadEventChangeLog(id))).not.toMatch(/registre|Blessure|Jours perdus/i);
  });

  it('annulation : motif obligatoire, journal, numéro jamais réattribué', async () => {
    const entry = await entryOf(id);
    actAs('Salarié', 'ville-a');
    expect(await cancelBenignAccident({}, form({ id: String(entry.id), reason: 'Erreur' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-a');
    expect(await cancelBenignAccident({}, form({ id: String(entry.id) }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelBenignAccident({}, form({ id: String(entry.id), reason: 'Inscrit sur le mauvais accident' }))).toEqual({ ok: true, id });
    expect(await cancelBenignAccident({}, form({ id: String(entry.id), reason: 'Encore' }))).toEqual({ error: 'Inscription annulée.' });
    const [cancelled] = await (await getDb()).select().from(t.benignAccidents).where(eq(t.benignAccidents.id, entry.id));
    expect(cancelled).toMatchObject({ number: 4, cancelledById: 'clefevre', cancelReason: 'Inscrit sur le mauvais accident' });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(await lastLog('event', id)).toMatchObject({ action: 'register-cancel', reason: 'Inscrit sur le mauvais accident', details: [{ field: 'Registre des accidents bénins', from: 'n° 4', to: 'Inscription annulée' }] });
    // Inscription suivante : n° 5 (le n° 4 reste au registre, annulé).
    const next = await benignAt();
    expect(await registerBenignAccident({}, inscription(next))).toEqual({ ok: true, id: next });
    expect((await entryOf(next)).number).toBe(5);
    expect((await changeLog('event', next)).map((e) => e.action)).toEqual(['create', 'register']);
  });
});

describe('registre imprimable', () => {
  it('rôles habilités : inscriptions du site (annulées comprises) et secouristes ; null pour les autres', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await loadBenignRegister('ville-a')).toBeNull();
    actAs('Animateur QHSE', 'ville-a');
    expect(await loadBenignRegister(null)).toMatchObject({ site: null, sites: [{ id: 'ville-a' }, { id: 'ville-b' }] });
    expect(await loadBenignRegister('inconnu')).toBeNull();
    const reg = await loadBenignRegister('ville-a');
    expect(reg?.site).toEqual({ id: 'ville-a', label: 'Site de [Ville A]' });
    expect(reg?.entries.map((e) => e.number)).toEqual([1, 2, 3, 4, 5]);
    expect(reg?.entries[0]).toMatchObject({
      ref: 'EV-2026-118', victim: '[T. Nguyen]', lesionNature: 'Pincement', lesionSite: 'Majeur droit', caregiver: '[S. Benali]',
      qualification: 'Sauveteur secouriste du travail (SST)', careGivenAt: '2026-09-07T11:05', signedOn: null, escalated: null, cancelled: null,
    });
    expect(reg?.entries[1]).toMatchObject({ ref: 'EV-2026-120', signedOn: '2026-09-11' });
    expect(reg?.entries[3]).toMatchObject({ escalated: { at: '2026-10-08T18:00', injuryLabel: 'Soins médicaux sans arrêt', cpamDeclaredOn: null }, cancelled: { by: '[C. Lefèvre]', reason: 'Inscrit sur le mauvais accident' } });
    expect(reg?.years).toEqual([2026]);
    expect(reg?.firstAiders.map((a) => a.id)).toEqual(expect.arrayContaining(['sbenali', 'proux', 'tnguyen']));
    expect(reg?.firstAiders.map((a) => a.id)).not.toContain('amartin'); // site B
    expect(reg?.firstAiders.map((a) => a.id)).not.toContain('ylambert'); // sorti de l'effectif
    expect((await loadBenignRegister('ville-a', 2025))?.entries).toEqual([]);
  });

  it('titre de secourisme : drapeau first_aid, à défaut le libellé « SST »', async () => {
    const db = await getDb();
    await db.update(t.trainingTitles).set({ firstAid: false }).where(eq(t.trainingTitles.id, 'sst'));
    expect((await loadFirstAiders('ville-a', '2026-10-08')).map((a) => a.id)).toContain('sbenali');
    await db.update(t.trainingTitles).set({ label: 'Secourisme' }).where(eq(t.trainingTitles.id, 'sst'));
    expect(await loadFirstAiders('ville-a', '2026-10-08')).toEqual([]);
    await db.update(t.trainingTitles).set({ label: 'SST', firstAid: true }).where(eq(t.trainingTitles.id, 'sst'));
  });
});
