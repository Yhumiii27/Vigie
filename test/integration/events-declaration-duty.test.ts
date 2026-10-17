import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freezeClock, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { LOCATION_UNSPECIFIED } from '@/components/events/shared';
import { fromParisLocal } from '@/lib/dates';
import { loadDashboard } from '@/lib/data/dashboard';
import { loadEventDetail } from '@/lib/data/events';
import { loadVisibleTodo } from '@/lib/data/todo';
import { advanceEvent, createEvent, registerBenignAccident, saveEvent, waiveCpamDeclaration } from '@/server/events';

// Déclaration d'un AT selon la victime (revue de conformité du lot 2) : salarié de l'effectif, CPAM sous 48 h ; intérimaire,
// information de l'ETT sous 24 h (R. 412-2 CSS), pas de déclaration CPAM par l'entreprise ; personne extérieure, déclarée
// par son employeur (aucune échéance) ; clôture subordonnée à un motif tracé hors de l'effectif (EVT-02). Accident bénin :
// échéance d'inscription au registre (48 h), mentions du registre exigées, déclaration CPAM possible au lieu du registre.
// Indicateurs (TF1 / TG, jours sans AT, pyramide) : accidents de l'effectif seulement.

freshDemoDatabase();
// Soins saisis le jour de démonstration à 15 h 15 : « maintenant » fixé à 18 h (heure de Paris), quelle que soit l'heure du test.
freezeClock('2026-10-09T18:00:00+02:00');

const db = async () => getDb();
const row = async (id: string) => (await (await db()).select().from(t.events).where(eq(t.events.id, id)))[0];
/** Échéances de déclaration de l'événement (hors « Signalement à qualifier »). */
const todoOf = async (id: string) => (await loadVisibleTodo())
  .filter((x) => x.title.startsWith(`${id} `) && x.kind !== 'Signalement à qualifier').map((x) => ({ kind: x.kind, date: x.date }));
const CPAM = 'Déclaration AT à la CPAM';
const ETT = "Information de l'ETT (AT d'un intérimaire)";
const REGISTER = 'Inscription au registre des accidents bénins';

/** AT saisi par l'animateur QHSE (site A), connu de l'employeur le vendredi 09/10/2026 à 15 h. */
async function accident(fields: Record<string, string>) {
  actAs('Animateur QHSE', 'ville-a');
  const r = await createEvent({}, form({
    type: 'AT', title: 'Accident · quai', occurredOn: '2026-10-09', location: 'Quai de chargement', severity: '2', siteId: 'ville-a',
    declarantId: 'tnguyen', pilotId: 'sbenali', circumstances: 'Pied pris sous une palette.', ...fields,
  }));
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  await (await db()).update(t.events).set({ knownAt: fromParisLocal('2026-10-09T15:00') }).where(eq(t.events.id, r.id!));
  return r.id!;
}

/** Fiche à l'étape « Efficacité vérifiée », avec une action liée Vérifiée : seule la déclaration bloque la clôture. */
async function readyToClose(id: string, actionId: string) {
  const d = await db();
  await d.update(t.events).set({ step: 4, analysisMethod: '5m' }).where(eq(t.events.id, id));
  // Analyse des causes exigée à la clôture (EVT-11).
  await d.insert(t.eventAnalyses).values({ eventId: id, method: '5m', content: [['Milieu', 'Quai encombré']] });
  await d.insert(t.actions).values({
    id: actionId, detail: 'Baliser le quai', source: 'evenement', originRef: id, eventId: id, siteId: 'ville-a', pilotId: 'sbenali',
    openedOn: '2026-10-09', dueOn: '2026-10-20', initialDueOn: '2026-10-20', status: 'verifiee', doneOn: '2026-10-09', closedOn: '2026-10-09',
  });
}

describe('indicateurs sécurité : accidents de l’effectif seulement', () => {
  it('TF1 / TG, jours sans accident avec arrêt et pyramide inchangés par un intérimaire ou une personne extérieure', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const snapshot = async () => {
      const d = await loadDashboard();
      return {
        tf1: d.safety.tf1, tg: d.safety.tg,
        days: d.kpis.find((k) => k.label === 'Jours sans accident avec arrêt')?.value,
        pyramid: d.pyramid.filter((p) => p.label.startsWith('Accidents') || p.label === 'Soins').map((p) => p.n),
      };
    };
    const before = await snapshot();
    const d = await db();
    const base = { siteId: 'ville-a', type: 'AT', title: 'Accident · quai', location: 'Quai', severity: 2, step: 1, injury: 'arret', lostDays: 20, occurredOn: '2026-09-28' };
    await d.insert(t.events).values([
      { ...base, id: 'EV-2026-T21', victimKind: 'externe', victimName: 'K. Weber' },
      { ...base, id: 'EV-2026-T22', victimKind: 'interimaire', victimName: 'J. Martin' },
      { ...base, id: 'EV-2026-T23', injury: 'soins', lostDays: null, victimKind: 'externe', victimName: 'L. Roux' },
    ]);
    expect(await snapshot()).toEqual(before);
    // Salarié de l'effectif : compté.
    await d.insert(t.events).values({ ...base, id: 'EV-2026-T24', victimKind: 'salarie', victimId: 'mgirard' });
    const after = await snapshot();
    expect(after.tf1).toBeGreaterThan(before.tf1!);
    expect(after.days).toBe('11'); // 28/09 → 09/10
    expect(after.pyramid[0]).toBe(before.pyramid[0] + 1);
  });
});

describe('obligation de déclaration selon la victime', () => {
  it('salarié de l’effectif : déclaration CPAM sous 48 h', async () => {
    const id = await accident({ injury: 'arret', victimKind: 'salarie', victimId: 'mgirard' });
    expect(await todoOf(id)).toEqual([{ kind: CPAM, date: '2026-10-12' }]);
    expect((await loadEventDetail(id))?.cpam).toMatchObject({ duty: 'cpam', dueOn: '2026-10-12', canWaive: true });
  });

  it('intérimaire : ETT à informer sous 24 h, pas d’échéance CPAM ; clôture après le motif (journalisé)', async () => {
    const id = await accident({ injury: 'arret', victimKind: 'interimaire', victimName: 'J. Martin', victimCompany: 'Intérim Plus' });
    expect(await todoOf(id)).toEqual([{ kind: ETT, date: '2026-10-10' }]);
    const cpam = (await loadEventDetail(id))?.cpam;
    expect(cpam).toMatchObject({ duty: 'ett', dueOn: '2026-10-10', tone: 'warn', canWaive: true });
    expect(cpam?.label).toBe("ETT à informer avant le 10/10/2026 à 15 h 00 (copie CARSAT et inspection du travail) : elle déclare l'accident");
    // Échéance réservée aux rôles habilités aux données de santé.
    actAs('Chef de service', 'ville-a');
    expect(await todoOf(id)).toEqual([]);

    await readyToClose(id, 'A-971');
    actAs('Animateur QHSE', 'ville-a');
    expect(await advanceEvent(id)).toEqual({ error: "Victime intérimaire : l'entreprise de travail temporaire déclare l'accident ; indiquez quand elle a été informée (motif) avant la clôture." });
    const reason = 'ETT Intérim Plus informée le 09/10 à 17 h par lettre recommandée ; copies CARSAT et inspection du travail';
    expect(await waiveCpamDeclaration({}, form({ id, reason }))).toEqual({ ok: true, id });
    expect(await lastLog('event', id)).toMatchObject({ action: 'cpam-waiver', reason, byId: 'clefevre' });
    expect(await todoOf(id)).toEqual([]);
    expect((await loadEventDetail(id))?.cpam).toMatchObject({ label: "Déclaration par l'entreprise de travail temporaire", waiver: { reason } });
    expect(await advanceEvent(id)).toEqual({});
    expect((await row(id)).step).toBe(5);
  });

  it('personne extérieure : aucune échéance (son employeur déclare) ; clôture après le motif', async () => {
    const id = await accident({ injury: 'arret', victimKind: 'externe', victimName: 'K. Weber', victimCompany: 'Levage Est' });
    expect(await todoOf(id)).toEqual([]);
    expect((await loadEventDetail(id))?.cpam).toMatchObject({ duty: 'employer', dueOn: null, tone: 'neutral', canWaive: true });
    await readyToClose(id, 'A-972');
    expect(await advanceEvent(id)).toEqual({ error: "Victime extérieure : son employeur déclare l'accident ; indiquez-le (motif) avant la clôture." });
    expect(await waiveCpamDeclaration({}, form({ id, reason: 'Déclaré par Levage Est, informée le 09/10' }))).toEqual({ ok: true, id });
    expect(await advanceEvent(id)).toEqual({});
  });
});

describe('accident bénin (premiers soins)', () => {
  let id = '';
  it('échéance d’inscription au registre ou de déclaration : 48 h hors dimanches et fériés, réservée aux rôles habilités', async () => {
    id = await accident({ injury: 'soins', victimKind: 'salarie', victimId: 'tnguyen' });
    expect(await todoOf(id)).toEqual([{ kind: REGISTER, date: '2026-10-12' }]);
    expect((await loadEventDetail(id))?.cpam).toMatchObject({
      dueOn: '2026-10-12', label: 'Accident bénin : à inscrire au registre ou à déclarer avant le 12/10/2026 à 15 h 00',
    });
    actAs('Chef de service', 'ville-a');
    expect(await todoOf(id)).toEqual([]);
  });

  it('inscription : mentions du registre exigées (victime, circonstances, lieu, nature et siège des lésions)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const bare = await accident({ injury: 'soins', circumstances: '', location: LOCATION_UNSPECIFIED });
    const missing = "Complétez la fiche (Modifier) avant l'inscription au registre : victime, circonstances, lieu, nature des lésions, siège des lésions.";
    const inscription = (eventId: string) => form({ id: eventId, careGivenAt: '2026-10-09T15:15', caregiverKind: 'staff', caregiverId: 'sbenali', care: 'Désinfection et pansement' });
    expect(await registerBenignAccident({}, inscription(bare))).toEqual({ error: missing });
    expect((await loadEventDetail(bare))?.register).toMatchObject({ canRegister: false, hint: missing });
    expect(await registerBenignAccident({}, inscription(id))).toEqual({ error: "Complétez la fiche (Modifier) avant l'inscription au registre : nature des lésions, siège des lésions." });
    // Fiche complétée : inscription, l'échéance disparaît.
    const e = await row(id);
    expect(await saveEvent({}, form({
      id, type: 'AT', title: e.title, occurredOn: e.occurredOn, location: e.location, severity: '2', siteId: 'ville-a', pilotId: 'sbenali',
      victimKind: 'salarie', victimId: 'tnguyen', circumstances: e.circumstances!, injury: 'soins', lesionNature: 'Contusion', lesionSite: 'Pied gauche',
    }))).toEqual({ ok: true, id });
    expect((await loadEventDetail(id))?.register).toMatchObject({ canRegister: true, hint: null });
    expect(await registerBenignAccident({}, inscription(id))).toEqual({ ok: true, id });
    expect(await lastLog('event', id)).toMatchObject({ action: 'register' });
    expect(await todoOf(id)).toEqual([]);
  });

  it('victime hors de l’effectif : pas d’inscription au registre de l’entreprise', async () => {
    const tmp = await accident({ injury: 'soins', victimKind: 'interimaire', victimName: 'J. Martin', lesionNature: 'Éraflure', lesionSite: 'Avant-bras' });
    expect(await todoOf(tmp)).toEqual([{ kind: ETT, date: '2026-10-10' }]);
    const ext = await accident({ injury: 'soins', victimKind: 'externe', victimName: 'K. Weber', lesionNature: 'Éraflure', lesionSite: 'Avant-bras' });
    expect(await todoOf(ext)).toEqual([]);
    const inscription = (eventId: string) => form({ id: eventId, careGivenAt: '2026-10-09T15:15', caregiverKind: 'staff', caregiverId: 'sbenali', care: 'Pansement' });
    expect((await registerBenignAccident({}, inscription(tmp))).error).toMatch(/^Victime intérimaire : l'accident ne s'inscrit pas au registre/);
    expect((await registerBenignAccident({}, inscription(ext))).error).toMatch(/^Victime extérieure : l'accident relève du registre ou de la déclaration de son employeur/);
    const d = await db();
    expect(await d.select().from(t.benignAccidents).where(and(eq(t.benignAccidents.eventId, ext), isNull(t.benignAccidents.cancelledAt)))).toEqual([]);
  });

  it('déclaration CPAM au lieu du registre : date conservée, réserves suivies, inscription alors refusée', async () => {
    const declared = await accident({ injury: 'soins', victimKind: 'salarie', victimId: 'kbernard', lesionNature: 'Coupure', lesionSite: 'Index', cpamDeclaredOn: '2026-10-09' });
    expect(await row(declared)).toMatchObject({ injury: 'soins', cpamDeclaredOn: '2026-10-09' });
    expect((await loadEventDetail(declared))?.cpam).toMatchObject({ declaredOn: '2026-10-09', label: 'Déclarée le 09/10/2026', reserves: { dueOn: '2026-10-19' } });
    expect(await todoOf(declared)).toEqual([]);
    expect(await registerBenignAccident({}, form({ id: declared, careGivenAt: '2026-10-09T15:15', caregiverKind: 'staff', caregiverId: 'sbenali', care: 'Pansement' })))
      .toEqual({ error: 'Accident déjà déclaré à la CPAM : il ne s’inscrit pas au registre.' });
    // Requalification en premiers soins : la date de déclaration déjà saisie est conservée.
    const arret = await accident({ injury: 'sans_arret', victimKind: 'salarie', victimId: 'kbernard', cpamDeclaredOn: '2026-10-09' });
    const e = await row(arret);
    expect(await saveEvent({}, form({
      id: arret, type: 'AT', title: e.title, occurredOn: e.occurredOn, location: e.location, severity: '2', siteId: 'ville-a', pilotId: 'sbenali',
      victimKind: 'salarie', victimId: 'kbernard', circumstances: e.circumstances!, injury: 'soins', cpamDeclaredOn: '2026-10-09',
    }))).toEqual({ ok: true, id: arret });
    expect(await row(arret)).toMatchObject({ injury: 'soins', cpamDeclaredOn: '2026-10-09' });
  });

  it('accident inscrit au registre : date de déclaration refusée (bascule en déclaration CPAM)', async () => {
    const e = await row(id);
    expect(await saveEvent({}, form({
      id, type: 'AT', title: e.title, occurredOn: e.occurredOn, location: e.location, severity: '2', siteId: 'ville-a', pilotId: 'sbenali',
      victimKind: 'salarie', victimId: 'tnguyen', circumstances: e.circumstances!, injury: 'soins', lesionNature: 'Contusion', lesionSite: 'Pied gauche',
      cpamDeclaredOn: '2026-10-09',
    }))).toMatchObject({ fieldErrors: { cpamDeclaredOn: expect.stringMatching(/^Inscrit au registre des accidents bénins/) } });
    expect((await row(id)).cpamDeclaredOn).toBeNull();
  });
});
