import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, file, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { AT_CLOSE_RESTRICTED, HEALTH_DENIED, LOCATION_UNSPECIFIED } from '@/lib/rules/events';
import { fromParisLocal, toParisLocal } from '@/lib/dates';
import { loadEventChangeLog, loadEventDetail } from '@/lib/data/events';
import { loadVisibleTodo } from '@/lib/data/todo';
import {
  addEventFiles, advanceEvent, cancelCpamWaiver, classifyEventFileAsMedical, createEvent, createReport, removeEventFile, saveEvent, waiveCpamDeclaration,
} from '@/server/events';

// Accident du travail (lot 2) : rubriques de la déclaration (EVT-01) et données de santé restreintes, pièces médicales
// comprises (SEC-06) ; données exigées à la qualification (EVT-05) ; clôture d'un AT sans déclaration CPAM refusée sauf
// motif tracé (EVT-02) ; délai de 48 h hors dimanches et fériés à compter de la connaissance (EVT-03).

freshDemoDatabase();

const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = "Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.";

/** Formulaire « Modifier » d'un événement d'après la fiche enregistrée ; `health` : avec ses données de santé. */
async function formOf(id: string, over: Record<string, string> = {}, { health = false } = {}) {
  const db = await getDb();
  const [e] = await db.select().from(t.events).where(eq(t.events.id, id));
  const s = (v: string | number | null) => (v == null ? '' : String(v));
  return form({
    id: e.id, type: e.type, title: e.title, occurredOn: e.occurredOn, occurredTime: s(e.occurredTime), location: e.location, equipment: s(e.equipment),
    keystoneProject: s(e.keystoneProject), pilotId: s(e.pilotId), severity: s(e.severity), siteId: e.siteId, description: e.description,
    immediateMeasures: e.immediateMeasures, ncOrigin: s(e.ncOrigin), controlId: s(e.controlId), riskId: s(e.riskId), documentId: s(e.documentId),
    preventionPlanId: s(e.preventionPlanId), permitId: s(e.permitId),
    victimKind: s(e.victimKind), victimId: s(e.victimId), victimName: s(e.victimName), victimCompany: s(e.victimCompany), workSchedule: s(e.workSchedule),
    knownAt: e.knownAt ? toParisLocal(e.knownAt) : '', activity: s(e.activity), circumstances: s(e.circumstances), witnesses: s(e.witnesses), thirdParty: s(e.thirdParty),
    customer: s(e.customer), customerRef: s(e.customerRef), envAspect: s(e.envAspect), envMedium: s(e.envMedium),
    ...(health ? {
      injury: s(e.injury), lostDays: s(e.lostDays), cpamDeclaredOn: s(e.cpamDeclaredOn), lesionNature: s(e.lesionNature), lesionSite: s(e.lesionSite),
      careGiven: s(e.careGiven), reservesOn: s(e.reservesOn),
    } : {}),
    ...over,
  });
}

const row = async (id: string) => (await (await getDb()).select().from(t.events).where(eq(t.events.id, id)))[0];
const cpamTodo = async (id: string) => (await loadVisibleTodo()).find((x) => x.kind === 'Déclaration AT à la CPAM' && x.title.startsWith(`${id} `));

/** Nouvel événement saisi depuis Vigie (étape « Déclaré »). */
async function created(fields: Record<string, string>) {
  const r = await createEvent({}, form({ title: 'Événement de test', occurredOn: '2026-10-08', location: 'Atelier montage', severity: '2', siteId: 'ville-a', declarantId: 'tnguyen', pilotId: 'sbenali', ...fields }));
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r.id!;
}

describe('déclaration d’accident du travail (EVT-01, SEC-06)', () => {
  const AT = 'EV-2026-119'; // accident avec arrêt, site B, données de santé du jeu de démonstration

  it('rubriques de la déclaration : saisies par l’encadrement ; lésions, soins et réserves refusés aux rôles non habilités', async () => {
    actAs('Chef de service', 'ville-b');
    const r = await saveEvent({}, await formOf(AT, {
      victimKind: 'interimaire', victimId: '', victimName: 'J. Martin', victimCompany: 'Intérim Plus', occurredTime: '15:40', workSchedule: '8 h – 16 h',
      circumstances: 'Faux pas sur la dernière marche en descendant.', witnesses: '[J. Petit]', thirdParty: '',
    }));
    expect(r).toEqual({ ok: true, id: AT });
    expect(await row(AT)).toMatchObject({
      victimKind: 'interimaire', victimId: null, victimName: 'J. Martin', victimCompany: 'Intérim Plus', occurredTime: '15:40', workSchedule: '8 h – 16 h',
      // Données de santé conservées.
      injury: 'arret', lostDays: 3, lesionNature: 'Entorse', lesionSite: 'Cheville droite',
    });
    expect((await lastLog('event', AT))?.details).toEqual(expect.arrayContaining([
      { field: 'Statut de la victime', from: "Salarié de l'effectif", to: 'Intérimaire' },
      { field: 'Circonstances', from: '(texte précédent)', to: '(texte modifié)' },
    ]));
    for (const role of ['Chef de service', 'Chef de projet'] as const) {
      actAs(role, 'ville-b');
      for (const [field, value] of Object.entries({ lesionNature: 'Fracture', lesionSite: 'Poignet', careGiven: 'Urgences', reservesOn: '2026-09-12' })) {
        expect(await saveEvent({}, await formOf(AT, { [field]: value })), `${role} ${field}`).toEqual({ error: HEALTH_DENIED });
      }
    }
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveEvent({}, await formOf(AT, { victimKind: 'salarie', victimId: 'amartin', lesionSite: 'Cheville gauche', reservesOn: '2026-09-15' }, { health: true }))).toEqual({ ok: true, id: AT });
    expect(await row(AT)).toMatchObject({ victimKind: 'salarie', victimId: 'amartin', victimName: null, lesionSite: 'Cheville gauche', reservesOn: '2026-09-15' });
    // Réserves : jamais avant la déclaration ; connaissance de l'accident : ni avant l'accident ni dans le futur.
    expect(await saveEvent({}, await formOf(AT, { reservesOn: '2026-09-01' }, { health: true }))).toMatchObject({ fieldErrors: { reservesOn: expect.any(String) } });
    expect(await saveEvent({}, await formOf(AT, { knownAt: '2026-09-07T10:00' }))).toMatchObject({ fieldErrors: { knownAt: "La date ne peut pas précéder l'accident." } });
    expect(await saveEvent({}, await formOf(AT, { knownAt: '2027-01-01T10:00' }))).toMatchObject({ fieldErrors: { knownAt: 'La date ne peut pas être postérieure à maintenant.' } });
    expect(await saveEvent({}, await formOf(AT, { knownAt: 'demain' }))).toMatchObject({ fieldErrors: { knownAt: 'Date et heure invalides.' } });
  });

  it('fiche et journal : lésions, soins et réserves absents de la charge des rôles non habilités', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const full = await loadEventDetail(AT);
    expect(full).toMatchObject({ health: true, event: { lesionNature: 'Entorse', lesionSite: 'Cheville gauche' }, accident: { victim: '[A. Martin]', occurredTime: '15:40' } });
    expect(full?.cpam?.reserves?.label).toBe('Réserves motivées adressées le 15/09/2026');
    expect((await loadEventChangeLog(AT)).flatMap((e) => e.details.map((d) => d.field))).toEqual(expect.arrayContaining(['Siège des lésions', 'Réserves motivées']));
    for (const role of ['Chef de service', 'Chef de projet'] as const) {
      actAs(role, 'ville-b');
      const d = await loadEventDetail(AT);
      expect(d).toMatchObject({ health: false, cpam: null, register: null, medical: [], accident: { victim: '[A. Martin]', circumstances: expect.any(String) } });
      expect(JSON.stringify(d), role).not.toMatch(/Cheville|Entorse|urgences|"reservesOn":"/i);
      const log = await loadEventChangeLog(AT);
      expect(JSON.stringify(log), role).not.toMatch(/Siège des lésions|Réserves motivées|Cheville/);
      // La modification des rubriques non médicales reste visible.
      expect(log.flatMap((e) => e.details.map((x) => x.field))).toContain('Statut de la victime');
    }
  });

  it('intitulé neutre d’un accident signalé du terrain', async () => {
    actAs('Salarié', 'ville-a');
    const r = await createReport(form({ type: 'AT', description: 'Coupure au doigt en ébavurant, saignement.', location: 'Atelier usinage · T-4' }));
    expect((await row(r.id!)).title).toBe('Accident · Atelier usinage · T-4');
  });
});

describe('qualification : données propres au type (EVT-05)', () => {
  it('passage à « Qualifié » refusé tant qu’elles manquent, admis une fois saisies', async () => {
    actAs('Chef de service', 'ville-a');
    const cases: [Record<string, string>, string, Record<string, string>][] = [
      [{ type: 'PA', location: LOCATION_UNSPECIFIED }, 'lieu', { location: 'Atelier montage · poste M3' }],
      [{ type: 'NC' }, 'origine', { ncOrigin: 'Fabrication' }],
      [{ type: 'RC' }, 'client, référence client (commande, affaire ou projet Keystone)', { customer: '[Client C]', customerRef: 'CMD-4471' }],
      [{ type: 'ENV' }, 'aspect environnemental, milieu concerné', { envAspect: 'Déversement', envMedium: 'Sol' }],
      [{ type: 'AT' }, 'victime, circonstances', { victimKind: 'salarie', victimId: 'kbernard', circumstances: 'Main prise entre deux caisses.' }],
    ];
    for (const [fields, labels, fill] of cases) {
      const id = await created(fields);
      expect(await advanceEvent(id), fields.type).toEqual({ error: `Complétez la fiche (Modifier) avant le passage à l'étape « Qualifié » : ${labels}.` });
      expect(await saveEvent({}, await formOf(id, fill)), fields.type).toEqual({ ok: true, id });
      expect(await advanceEvent(id), fields.type).toEqual({});
      expect((await row(id)).step).toBe(1);
    }
  });

  it('un événement qualifié garde ses données : enregistrement refusé si elles sont effacées', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveEvent({}, await formOf('EV-2026-127', { circumstances: '' }))).toMatchObject({ fieldErrors: { circumstances: 'Requis pour un événement qualifié.' } });
    expect(await saveEvent({}, await formOf('EV-2026-127', { victimKind: '' }))).toMatchObject({ fieldErrors: { victimKind: 'Requis pour un événement qualifié.' } });
    expect(await saveEvent({}, await formOf('EV-2026-130', { ncOrigin: '' }))).toMatchObject({ fieldErrors: { ncOrigin: 'Requis pour un événement qualifié.' } });
    expect(await saveEvent({}, await formOf('EV-2026-127', { location: LOCATION_UNSPECIFIED }))).toMatchObject({ fieldErrors: { location: 'Requis pour un événement qualifié.' } });
  });
});

describe('clôture d’un AT sans déclaration CPAM (EVT-02)', () => {
  let id = '';
  it('refusée : rôle non habilité (message sans donnée de santé), déclaration ni saisie ni motivée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    id = await created({ type: 'AT', injury: 'arret', victimKind: 'salarie', victimId: 'mgirard', circumstances: 'Chute de plain-pied.' });
    const db = await getDb();
    await db.update(t.events).set({ step: 4, analysisMethod: '5m' }).where(eq(t.events.id, id));
    // Analyse des causes exigée à la clôture (EVT-11).
    await db.insert(t.eventAnalyses).values({ eventId: id, method: '5m', content: [['Milieu', 'Sol glissant']] });
    await db.insert(t.actions).values({
      id: 'A-960', detail: 'Baliser le passage', source: 'evenement', originRef: id, eventId: id, siteId: 'ville-a', pilotId: 'sbenali',
      openedOn: '2026-10-09', dueOn: '2026-10-20', initialDueOn: '2026-10-20', status: 'verifiee', doneOn: '2026-10-09', closedOn: '2026-10-09',
    });
    expect(await advanceEvent(id)).toEqual({ error: "Saisissez la date de déclaration à la CPAM, ou indiquez pourquoi l'entreprise ne la déclare pas, avant la clôture." });
    expect(await cpamTodo(id)).toMatchObject({ health: true });
    actAs('Chef de service', 'ville-a');
    expect(await advanceEvent(id)).toEqual({ error: AT_CLOSE_RESTRICTED });
    expect((await loadEventDetail(id))?.blocker).toBe(AT_CLOSE_RESTRICTED);
  });

  it('motif d’absence de déclaration : droits, site, motif obligatoire, journal réservé', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await waiveCpamDeclaration({}, form({ id, reason: 'Déclaré par l’ETT' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-b');
    expect(await waiveCpamDeclaration({}, form({ id, reason: 'Déclaré par l’ETT' }))).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'ville-a');
    expect(await waiveCpamDeclaration({}, form({ id }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    const reason = 'Déclaration faite par l’entreprise de travail temporaire (Intérim Plus)';
    expect(await waiveCpamDeclaration({}, form({ id, reason }))).toEqual({ ok: true, id });
    expect(await waiveCpamDeclaration({}, form({ id, reason }))).toEqual({ error: 'Absence de déclaration déjà motivée.' });
    expect(await row(id)).toMatchObject({ cpamWaivedById: 'clefevre', cpamWaiverReason: reason, cpamDeclaredOn: null });
    expect(await lastLog('event', id)).toMatchObject({
      action: 'cpam-waiver', reason, byId: 'clefevre', details: [{ field: 'Déclaration CPAM', from: 'À déclarer', to: "Non déclarée par l'entreprise" }],
    });
    expect((await loadEventDetail(id))?.cpam).toMatchObject({ label: "Non déclarée par l'entreprise", waiver: { reason, by: '[C. Lefèvre]' }, canWaive: false });
    actAs('Chef de projet', 'ville-a');
    expect(JSON.stringify(await loadEventChangeLog(id))).not.toMatch(/CPAM|Intérim Plus/);
    expect(JSON.stringify(await loadEventDetail(id))).not.toMatch(/Intérim Plus|cpamWaiverReason":"/);
  });

  it('clôture possible une fois motivée ; l’échéance disparaît', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await cpamTodo(id)).toBeUndefined();
    expect(await advanceEvent(id)).toEqual({});
    expect((await row(id)).step).toBe(5);
  });

  it('AT clôturé sans déclaration (avant cette règle) : l’échéance reste ; motif admis sur la fiche clôturée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const old = await created({ type: 'AT', injury: 'sans_arret', victimKind: 'salarie', victimId: 'tnguyen', circumstances: 'Chute sur le quai.' });
    await (await getDb()).update(t.events).set({ step: 5 }).where(eq(t.events.id, old));
    expect(await cpamTodo(old)).toMatchObject({ kind: 'Déclaration AT à la CPAM' });
    expect(await waiveCpamDeclaration({}, form({ id: old, reason: 'Déclaration faite sur le registre papier du site' }))).toEqual({ ok: true, id: old });
    expect(await cpamTodo(old)).toBeUndefined();
  });

  it('annulation du motif : motif obligatoire, journal, l’échéance revient', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await cancelCpamWaiver({}, form({ id, reason: 'Erreur' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-a');
    expect(await cancelCpamWaiver({}, form({ id }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelCpamWaiver({}, form({ id, reason: 'L’ETT n’a pas déclaré : déclaration à faire' }))).toEqual({ ok: true, id });
    expect(await row(id)).toMatchObject({ cpamWaivedAt: null, cpamWaivedById: null, cpamWaiverReason: null });
    expect(await lastLog('event', id)).toMatchObject({ action: 'cpam-waiver-cancel', reason: 'L’ETT n’a pas déclaré : déclaration à faire' });
    expect(await cpamTodo(id)).toMatchObject({ overdue: false });
    expect(await cancelCpamWaiver({}, form({ id, reason: 'Encore' }))).toEqual({ error: 'Aucune absence de déclaration motivée sur cet accident.' });
  });
});

describe('délai de déclaration CPAM : 48 h hors dimanches et fériés (EVT-03)', () => {
  it('à compter de la connaissance de l’accident ; fériés d’Alsace-Moselle selon le site', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const id = await created({ type: 'AT', injury: 'arret' });
    const db = await getDb();
    // Connu le vendredi 09/10 à 15 h : samedi décompté, dimanche non → lundi 12/10 à 15 h.
    await db.update(t.events).set({ knownAt: fromParisLocal('2026-10-09T15:00') }).where(eq(t.events.id, id));
    expect(await cpamTodo(id)).toMatchObject({ date: '2026-10-12', overdue: false });
    expect((await loadEventDetail(id))?.cpam?.label).toBe('À déclarer avant le 12/10/2026 à 15 h 00');
    // Jeudi 02/04 à 10 h : Vendredi saint, puis Pâques et lundi de Pâques non décomptés en Alsace-Moselle → mardi 07/04.
    await db.update(t.events).set({ knownAt: fromParisLocal('2026-04-02T10:00') }).where(eq(t.events.id, id));
    expect(await cpamTodo(id)).toMatchObject({ date: '2026-04-04', overdue: true });
    await db.update(t.sites).set({ alsaceMoselle: true }).where(eq(t.sites.id, 'ville-a'));
    expect(await cpamTodo(id)).toMatchObject({ date: '2026-04-07', overdue: true, tone: 'danger' });
    await db.update(t.sites).set({ alsaceMoselle: false }).where(eq(t.sites.id, 'ville-a'));
    // Sans date de connaissance : enregistrement dans Vigie.
    await db.update(t.events).set({ knownAt: null, createdAt: fromParisLocal('2026-10-10T11:00')! }).where(eq(t.events.id, id));
    expect(await cpamTodo(id)).toMatchObject({ date: '2026-10-13' });
  });
});

describe('pièces médicales (SEC-06)', () => {
  const EV = 'EV-2026-118'; // AT de [T. Nguyen] (Salarié de démonstration), site A
  let medical = '', plain = '';

  it('ajout : réservé aux rôles habilités, pièce marquée « santé »', async () => {
    actAs('Chef de service', 'ville-a');
    const certificate = () => file('certificat-medical.pdf');
    const fd = (health: boolean) => { const f = new FormData(); f.set('eventId', EV); if (health) f.set('health', '1'); f.append('files', certificate()); return f; };
    expect(await addEventFiles(fd(true))).toEqual({ error: HEALTH_DENIED });
    expect(await addEventFiles(fd(false))).toEqual({ count: 1 });
    actAs('Animateur QHSE', 'ville-a');
    expect(await addEventFiles(fd(true))).toEqual({ count: 1 });
    const db = await getDb();
    const rows = await db.select().from(t.attachments).where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, EV)));
    medical = rows.find((r) => r.health)!.id;
    plain = rows.find((r) => !r.health)!.id;
    expect(await lastLog('event', EV)).toMatchObject({ action: 'attach', summary: '1 pièce médicale ajoutée', details: [{ field: 'Pièce médicale', from: null, to: 'certificat-medical.pdf' }] });
    const other = await created({ type: 'PA' });
    const f = new FormData(); f.set('eventId', other); f.set('health', '1'); f.append('files', certificate());
    expect(await addEventFiles(f)).toEqual({ error: 'Pièces médicales : réservées aux accidents du travail et aux maladies professionnelles.' });
  });

  it('lecture : /fichiers refuse la pièce médicale aux autres rôles (déclarant compris) ; absente de leur fiche', async () => {
    const { GET } = await import('@/app/fichiers/[id]/route');
    const status = async (id: string) => (await GET(new Request(`http://localhost:3200/fichiers/${id}`), { params: Promise.resolve({ id }) } as never)).status;
    actAs('Animateur QHSE', 'ville-a');
    expect(await status(medical)).toBe(200);
    expect((await loadEventDetail(EV))?.medical.map((m) => m.id)).toEqual([medical]);
    for (const role of ['Chef de service', 'Salarié'] as const) {
      actAs(role, 'ville-a');
      expect(await status(medical), role).toBe(404);
      expect(await status(plain), role).toBe(200);
      const d = await loadEventDetail(EV);
      expect(d?.attachments.map((a) => a.id), role).not.toContain(medical);
      expect(JSON.stringify(d), role).not.toContain(medical);
    }
    actAs('Chef de service', 'ville-a');
    expect(await removeEventFile(medical)).toEqual({ error: 'Pièce jointe introuvable.' });
    expect(JSON.stringify(await loadEventChangeLog(EV))).not.toMatch(/pièces? médicales?/i);
  });

  it('reclassement en pièce médicale : droits, site, journal réservé, sans retour', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await classifyEventFileAsMedical(plain)).toEqual({ error: HEALTH_DENIED });
    actAs('Animateur QHSE', 'ville-b');
    expect(await classifyEventFileAsMedical(plain)).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'ville-a');
    expect(await classifyEventFileAsMedical(plain)).toEqual({});
    expect(await classifyEventFileAsMedical(plain)).toEqual({ error: 'Pièce déjà classée en pièce médicale.' });
    expect(await lastLog('event', EV)).toMatchObject({ action: 'classify', details: [{ field: 'Pièce médicale', from: null, to: 'certificat-medical.pdf' }] });
    actAs('Chef de projet', 'ville-a');
    expect((await loadEventChangeLog(EV)).some((e) => e.summary.includes('médicale'))).toBe(false);
    expect((await loadEventDetail(EV))?.attachments.map((a) => a.id)).not.toContain(plain);
    actAs('Animateur QHSE', 'ville-a');
    expect(await removeEventFile(plain)).toEqual({});
    expect(await lastLog('event', EV)).toMatchObject({ action: 'detach', summary: 'Pièce médicale retirée' });
  });

  it('reclassement : le nom de la pièce disparaît aussi de son ajout au journal, retrait compris', async () => {
    const SICK = 'arret-travail-15-jours-tnguyen.pdf';
    const names = async () => (await loadEventChangeLog(EV)).flatMap((e) => e.details.filter((d) => d.field === 'Fichier').map((d) => d.to ?? d.from));
    actAs('Chef de service', 'ville-a');
    const f = new FormData(); f.set('eventId', EV); f.append('files', file(SICK)); f.append('files', file('photo-poste.pdf'));
    expect(await addEventFiles(f)).toEqual({ count: 2 });
    expect(await names()).toEqual(expect.arrayContaining([SICK, 'photo-poste.pdf']));
    const db = await getDb();
    const [sick] = await db.select({ id: t.attachments.id }).from(t.attachments)
      .where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, EV), eq(t.attachments.fileName, SICK)));
    actAs('Animateur QHSE', 'ville-a');
    expect(await classifyEventFileAsMedical(sick.id)).toEqual({});
    expect(await names()).toContain(SICK);
    for (const role of ['Chef de service', 'Chef de projet'] as const) {
      actAs(role, 'ville-a');
      expect(await names(), role).not.toContain(SICK);
      expect(await names(), role).toContain('photo-poste.pdf');
      expect(JSON.stringify(await loadEventChangeLog(EV)), role).not.toContain(SICK);
    }
    actAs('Animateur QHSE', 'ville-a');
    expect(await removeEventFile(sick.id)).toEqual({});
    actAs('Chef de service', 'ville-a');
    expect(JSON.stringify(await loadEventChangeLog(EV))).not.toContain(SICK);
    expect(await names()).toContain('photo-poste.pdf');
  });
});
