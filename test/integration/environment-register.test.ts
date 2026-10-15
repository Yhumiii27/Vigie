import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadEnvironment, loadEnvironmentSignals, loadWasteRegisterCsv } from '@/lib/data/environment';
import { deleteWasteStream, saveSiteSiret, saveWasteEntry, saveWasteStream } from '@/server/environment';
import { saveAction } from '@/server/plan';
import { abandonAction } from '@/server/plan-ui';

// Registre chronologique des déchets : mentions de l'arrêté du 31 mai 2021 (DOC-02) — SIRET de l'établissement, mentions
// du collecteur et de l'installation sur la filière, copies figées sur chaque enlèvement, signalement et export.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const BENNE = '[Transports Benne Express]';
const TRANSPORTER_GAPS = ['SIRET du transporteur', 'Adresse du transporteur', 'Récépissé du transporteur'];

const stream = async (id: string) => (await (await getDb()).select().from(t.wasteStreams).where(eq(t.wasteStreams.id, id)))[0];
const entry = async (id: number) => (await (await getDb()).select().from(t.wasteEntries).where(eq(t.wasteEntries.id, id)))[0];

/** Formulaire de la fiche filière tel qu'envoyé, valeurs enregistrées éventuellement modifiées. */
async function streamForm(id: string, changes: Record<string, string> = {}) {
  const s = await stream(id);
  return form({
    id: s.id, label: s.label, ewcCode: s.ewcCode, treatmentCode: s.treatmentCode, channel: s.channel, collector: s.collector, destination: s.destination,
    siteId: s.siteId, unit: s.unit, pop: s.pop ? 'on' : '', qualification: s.qualification ?? '', collectorSiret: s.collectorSiret ?? '',
    collectorAddress: s.collectorAddress ?? '', collectorReceipt: s.collectorReceipt ?? '', destinationSiret: s.destinationSiret ?? '',
    destinationAddress: s.destinationAddress ?? '', ...changes,
  });
}

describe('droits et site', () => {
  it('Chef de service : registre, filières et SIRET refusés', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveWasteStream({}, await streamForm('FD-01', { label: 'Huiles' }))).toEqual({ error: DENIED });
    expect(await saveWasteEntry({}, form({ streamId: 'FD-01', removedOn: '2026-10-01', quantity: '100' }))).toEqual({ error: DENIED });
    expect(await saveSiteSiret({}, form({ siteId: 'ville-a', siret: '00000000000109' }))).toEqual({ error: APPROVERS_ONLY });
  });

  it('autre site que celui sélectionné : refusé', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveWasteStream({}, await streamForm('FD-01', { label: 'Huiles' }))).toEqual({ error: expect.stringContaining('autre site') });
    expect(await saveSiteSiret({}, form({ siteId: 'ville-a', siret: '00000000000109' }))).toEqual({ error: expect.stringContaining('autre site') });
    expect((await stream('FD-01')).label).toBe('Huiles hydrauliques usagées');
  });
});

describe('saveSiteSiret', () => {
  it('SIRET contrôlé, enregistré sans espaces, journalisé sur le site ; sans changement, rien n’est journalisé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const invalid = await saveSiteSiret({}, form({ siteId: 'ville-a', siret: '12345678901234' }));
    expect(invalid.fieldErrors?.siret).toBe('SIRET invalide : 14 chiffres, clé de contrôle incorrecte.');
    expect(await saveSiteSiret({}, form({ siteId: 'inconnu', siret: '' }))).toMatchObject({ error: 'Site inconnu.' });

    expect(await saveSiteSiret({}, form({ siteId: 'ville-a', siret: '000 000 000 00109' }))).toEqual({ ok: true, id: 'ville-a' });
    const db = await getDb();
    expect((await db.select().from(t.sites).where(eq(t.sites.id, 'ville-a')))[0].siret).toBe('00000000000109');
    const log = await lastLog('site', 'ville-a');
    expect(log).toMatchObject({ action: 'update', summary: "SIRET de l'établissement modifié", reason: null, byId: 'clefevre' });
    expect(log?.details).toEqual([{ field: 'SIRET', from: '000 000 000 00018', to: '000 000 000 00109' }]);

    expect(await saveSiteSiret({}, form({ siteId: 'ville-a', siret: '00000000000109' }))).toEqual({ ok: true, id: 'ville-a' });
    expect((await lastLog('site', 'ville-a'))?.id).toBe(log?.id);
  });

  it('site archivé : SIRET modifiable (registre dû 3 ans)', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await saveSiteSiret({}, form({ siteId: 'ville-c', siret: '00000000000174' }))).toEqual({ ok: true, id: 'ville-c' });
    expect(await lastLog('site', 'ville-c')).toMatchObject({ summary: "SIRET de l'établissement renseigné", details: [{ field: 'SIRET', from: null, to: '000 000 000 00174' }] });
  });
});

describe('saveWasteStream : mentions par défaut de la filière', () => {
  it('SIRET invalide et qualification incohérente refusés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const badSiret = await saveWasteStream({}, await streamForm('FD-01', { collectorSiret: '123' }));
    expect(badSiret.fieldErrors?.collectorSiret).toEqual(expect.stringContaining('SIRET'));
    const badQualification = await saveWasteStream({}, await streamForm('FD-01', { qualification: 'elimination' }));
    expect(badQualification.fieldErrors?.qualification).toBe('Une opération de valorisation (R) ne peut pas être qualifiée « Élimination ».');
    const d9 = await saveWasteStream({}, await streamForm('FD-04', { qualification: 'recyclage' }));
    expect(d9.fieldErrors?.qualification).toBe("Une opération d'élimination (D) se qualifie « Élimination ».");
  });

  it('transit (R13) sans qualification : admis, à préciser à chaque enlèvement ; code R sans qualification : proposée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const base = {
      label: 'Batteries au plomb', ewcCode: '16 06 01*', channel: 'Regroupement', collector: '[Collecteur DD Ouest]', destination: '[Plateforme de regroupement]',
      siteId: 'ville-a', unit: 'kg', qualification: '', collectorSiret: '', collectorAddress: '', collectorReceipt: '', destinationSiret: '', destinationAddress: '',
    };
    const transit = await saveWasteStream({}, form({ ...base, treatmentCode: 'R13' }));
    expect(transit).toMatchObject({ ok: true });
    const created = await stream(transit.id!);
    expect(created).toMatchObject({ treatmentCode: 'R13', qualification: null, pop: false, collectorSiret: null });
    expect(await lastLog('waste_stream', transit.id!)).toMatchObject({ action: 'create', summary: 'Filière créée : Batteries au plomb' });

    const recycled = await saveWasteStream({}, form({ ...base, label: 'Batteries (recyclage)', treatmentCode: 'R4', destinationSiret: 'DE123456789' }));
    expect(await stream(recycled.id!)).toMatchObject({ qualification: 'recyclage', destinationSiret: 'DE123456789' });
  });
});

describe('saveWasteEntry : copies des mentions', () => {
  it('inscription sans transporteur : mentions du collecteur et de l’installation copiées, qualification de la filière', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const result = await saveWasteEntry({}, form({ streamId: 'FD-01', removedOn: '2026-10-08', quantity: '300', bsdNumber: 'BSD-20261008-TEST0001' }));
    expect(result).toMatchObject({ ok: true });
    const fd01 = await stream('FD-01');
    expect(await entry(Number(result.id))).toMatchObject({
      transporter: fd01.collector, transporterSiret: fd01.collectorSiret, transporterAddress: fd01.collectorAddress, transporterReceipt: fd01.collectorReceipt,
      destinationSiret: '00000000000075', destinationAddress: fd01.destinationAddress, qualification: 'recyclage', pop: false, pickupAddress: null,
    });
    expect(await lastLog('waste_entry', result.id!)).toMatchObject({ action: 'create' });
  });

  it('transporteur propre : SIRET contrôlé ; qualification incohérente avec le code figé refusée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const bad = await saveWasteEntry({}, form({ streamId: 'FD-01', removedOn: '2026-10-08', quantity: '50', transporter: '[Transports Durand]', transporterSiret: '00000000000001' }));
    expect(bad.fieldErrors?.transporterSiret).toEqual(expect.stringContaining('SIRET'));
    const elimination = await saveWasteEntry({}, form({ streamId: 'FD-01', removedOn: '2026-10-08', quantity: '50', qualification: 'elimination' }));
    expect(elimination.fieldErrors?.qualification).toEqual(expect.stringContaining('valorisation (R)'));

    const own = await saveWasteEntry({}, form({
      streamId: 'FD-05', removedOn: '2026-10-08', quantity: '1200', transporter: '[Transports Durand]', transporterSiret: '000 000 000 00182',
      transporterAddress: '[ZA Nord, Ville A]', transporterReceipt: 'Exempté', pickupAddress: '[Chantier K-2025-042, Ville J]',
    }));
    expect(own).toMatchObject({ ok: true });
    expect(await entry(Number(own.id))).toMatchObject({
      transporter: '[Transports Durand]', transporterSiret: '00000000000182', transporterReceipt: 'Exempté', pickupAddress: '[Chantier K-2025-042, Ville J]',
    });
  });

  it('modification de la filière : un enlèvement inscrit garde sa copie ; une copie vide suit la filière si l’installation est la même', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    expect(await saveWasteStream({}, await streamForm('FD-01', { destinationSiret: '00000000000190' }))).toEqual({ ok: true, id: 'FD-01' });
    expect(await lastLog('waste_stream', 'FD-01')).toMatchObject({
      action: 'update', summary: 'Filière modifiée', details: [{ field: "SIRET de l'installation", from: '000 000 000 00075', to: '000 000 000 00190' }],
    });

    const rows = await db.select().from(t.wasteEntries).where(and(eq(t.wasteEntries.streamId, 'FD-01'), isNull(t.wasteEntries.cancelledAt)));
    const [kept, legacy, moved] = rows.filter((r) => r.removedOn.startsWith('2026-0')).sort((a, b) => a.removedOn.localeCompare(b.removedOn));
    await db.update(t.wasteEntries).set({ destinationSiret: null }).where(eq(t.wasteEntries.id, legacy.id));
    await db.update(t.wasteEntries).set({ destinationSiret: null, destination: '[Autre raffinerie]' }).where(eq(t.wasteEntries.id, moved.id));

    const { entries } = await loadEnvironment(2026);
    const view = (id: number) => entries.find((e) => e.id === id)!;
    expect(view(kept.id)).toMatchObject({ destinationSiret: '00000000000075', gaps: [] });
    expect(view(legacy.id)).toMatchObject({ destinationSiret: '00000000000190', gaps: [] });
    expect(view(moved.id)).toMatchObject({ destinationSiret: null, gaps: ["SIRET de l'installation de destination"] });

    // Enregistrement suivant de l'enlèvement à copie vide : la valeur résolue est copiée, jamais remplacée ensuite.
    expect(await saveWasteEntry({}, form({
      id: String(legacy.id), streamId: 'FD-01', removedOn: legacy.removedOn, quantity: String(legacy.quantity), transporter: legacy.transporter,
      bsdNumber: legacy.bsdNumber ?? '', bsdStatus: legacy.bsdStatus ?? '',
    }))).toEqual({ ok: true, id: String(legacy.id) });
    expect((await entry(legacy.id)).destinationSiret).toBe('00000000000190');
  });
});

describe('registre : mentions incomplètes, échéance, export', () => {
  it('transporteur non référencé : trois mentions manquantes ; sans SIRET du site, toutes les lignes le signalent', async () => {
    actAs('Animateur QHSE', 'ville-a');
    let { entries } = await loadEnvironment(2026);
    const benne = entries.filter((e) => e.transporter === BENNE && !e.cancelled);
    expect(benne.map((e) => e.removedOn).sort()).toEqual(['2026-01-14', '2026-04-15', '2026-07-08']);
    benne.forEach((e) => expect(e.gaps).toEqual(TRANSPORTER_GAPS));
    expect(entries.filter((e) => e.cancelled).every((e) => e.gaps.length === 0)).toBe(true);

    expect(await saveSiteSiret({}, form({ siteId: 'ville-a', siret: '' }))).toEqual({ ok: true, id: 'ville-a' });
    expect(await lastLog('site', 'ville-a')).toMatchObject({ summary: "SIRET de l'établissement retiré", details: [{ field: 'SIRET', from: '000 000 000 00109', to: null }] });
    ({ entries } = await loadEnvironment(2026));
    expect(entries.filter((e) => !e.cancelled).every((e) => e.gaps.includes("SIRET de l'établissement"))).toBe(true);
    expect(entries.find((e) => e.transporter === BENNE && !e.cancelled)?.gaps).toEqual(["SIRET de l'établissement", ...TRANSPORTER_GAPS]);
  });

  it('échéance « mentions incomplètes » : à traiter, hors badge', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { todo } = await loadEnvironmentSignals();
    const item = todo.find((i) => i.siteId === 'ville-a' && i.title.startsWith('Registre des déchets 2026') && i.title.includes('mentions incomplètes'));
    expect(item).toMatchObject({ kind: 'Déchets', tone: 'warn', count: 0 });
    expect(item?.href).toContain('vue=mentions-incompletes');
  });

  it('export CSV : colonnes de l’arrêté, quantité en tonnes', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { csv } = await loadWasteRegisterCsv(2026);
    const [header, ...lines] = csv.replace(/^﻿/, '').trimEnd().split('\r\n').map((l) => l.split(';'));
    for (const h of ["Date d'expédition (enlèvement)", "SIRET de l'établissement", 'POP', 'Quantité (t ou m³)', 'SIRET du transporteur', 'N° de récépissé du transporteur',
      "SIRET de l'installation", 'Qualification du traitement final', 'Mentions manquantes']) {
      expect(header).toContain(h);
    }
    const col = (name: string) => header.indexOf(name);
    const oil = lines.find((l) => l[col("Date d'expédition (enlèvement)")] === '29/09/2026' && l[col('Dénomination usuelle du déchet')] === 'Huiles hydrauliques usagées')!;
    expect(oil[col('Quantité')]).toBe('520');
    expect(oil[col('Quantité (t ou m³)')]).toBe('0,52');
    expect(oil[col('Unité du registre')]).toBe('t');
    expect(oil[col('SIRET du transporteur')]).toBe('00000000000034');
    expect(oil[col('Qualification du traitement final')]).toBe('Recyclage');
    const benne = lines.find((l) => l[col('Transporteur')] === BENNE)!;
    expect(benne[col('Mentions manquantes')]).toBe(["SIRET de l'établissement", ...TRANSPORTER_GAPS].join(' · '));
  });
});

describe('deleteWasteStream : filière sans enlèvement', () => {
  const newStream = async (label: string) => {
    const r = await saveWasteStream({}, form({
      label, ewcCode: '16 06 01*', treatmentCode: 'R4', channel: 'Regroupement', collector: '[Collecteur DD Ouest]',
      destination: '[Plateforme de regroupement]', siteId: 'ville-a', unit: 'kg', qualification: '', collectorSiret: '', collectorAddress: '',
      collectorReceipt: '', destinationSiret: '', destinationAddress: '',
    }));
    expect(r).toMatchObject({ ok: true });
    return r.id!;
  };
  const actionFrom = async (streamId: string) => {
    // Contrat FormData du paquet 1 (plan § 2.14) : source « Déchets » imposée par la filière (admissibleSources).
    const r = await saveAction({}, form({
      source: 'dechets', link: `wastestream:${streamId}`, originRef: streamId, pilotId: 'clefevre', priority: 'moyen_terme', domain: 'environnement',
      problem: `Filière ${streamId} : test`, detail: `Action de test · ${streamId}`, dueOn: '2026-11-15', verifyDueOn: '2026-12-15', riskLevel: '', siteId: 'ville-a',
    }));
    expect(r).toMatchObject({ ok: true });
    return r.id!;
  };
  const view = async (id: string) => (await loadEnvironment()).streams.find((s) => s.id === id)!;

  it('droits et site : Chef de service et autre site refusés, filière conservée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const id = await newStream('Batteries (droits)');
    actAs('Chef de service', 'ville-a');
    expect(await deleteWasteStream(id)).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-b');
    expect(await deleteWasteStream(id)).toEqual({ error: expect.stringContaining('autre site') });
    expect(await stream(id)).toBeDefined();
  });

  it('action créée depuis la filière (ACT-01), abandonnée comprise : suppression refusée sans exception, filière conservée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const id = await newStream('Batteries (action)');
    const actionId = await actionFrom(id);
    expect(await view(id)).toMatchObject({ entryCount: 0, cancelledCount: 0, sourceActionCount: 1 });
    expect(await deleteWasteStream(id)).toEqual({ error: `Cette filière porte 1 action du plan (${actionId}) : elle ne peut pas être supprimée.` });
    expect(await stream(id)).toBeDefined();

    // Filière : action listée (libellé du détail), avec la filière pour source.
    expect((await view(id)).actions).toEqual([expect.objectContaining({ id: actionId, label: `Action de test · ${id}`, wasteStreamId: id })]);
    expect(await (await getDb()).select({ source: t.actions.source, wasteStreamId: t.actions.wasteStreamId }).from(t.actions).where(eq(t.actions.id, actionId)))
      .toEqual([{ source: 'dechets', wasteStreamId: id }]);

    // Abandonnée, l'action garde son origine : la filière reste verrouillée.
    expect(await abandonAction({}, form({ id: actionId, from: 'a_faire', reason: 'Doublon de test' }))).toMatchObject({ ok: true });
    expect(await view(id)).toMatchObject({ actions: [], sourceActionCount: 1 });
    expect(await deleteWasteStream(id)).toEqual({ error: expect.stringContaining(actionId) });
    expect(await stream(id)).toBeDefined();
  });

  it('sans enlèvement ni action : supprimée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const id = await newStream('Batteries (libre)');
    expect(await view(id)).toMatchObject({ sourceActionCount: 0 });
    expect(await deleteWasteStream(id)).toEqual({});
    expect(await stream(id)).toBeUndefined();
  });
});

describe('action « BSD manquants » du registre (paquet 1 Actions QSE)', () => {
  const bsdRequirement = async () => {
    const rows = await (await getDb()).select().from(t.requirements);
    return rows.find((r) => /R\.\s?541-45/.test(r.text))!;
  };

  it('sans action rattachée à l’exigence : source « Déchets » proposée (Veille admise), exigence liée, domaine Environnement', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const req = await bsdRequirement();
    await (await getDb()).update(t.requirements).set({ actionId: null }).where(eq(t.requirements.id, req.id));
    const d = await loadEnvironment();
    expect(d.bsdAction).toBeNull();
    expect(d.bsdActionDefaults).toMatchObject({
      source: 'dechets', sourceChoices: ['dechets', 'veille'], link: `requirement:${req.id}`, domain: 'environnement', siteId: 'ville-a',
      originRef: `Registre des déchets ${d.year}`, dueOn: '2026-10-24', verifyDueOn: '2026-11-23',
    });
    expect(d.bsdActionDefaults).not.toHaveProperty('lockSource');
  });

  it('action non close rattachée à l’exigence : retrouvée par ce rattachement (plus par la référence d’origine), sans nouvel élément lié', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const req = await bsdRequirement();
    const open = (await db.select().from(t.actions)).filter((a) => a.siteId === 'ville-a' && ['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'terminee'].includes(a.status))[0];
    await db.update(t.requirements).set({ actionId: open.id }).where(eq(t.requirements.id, req.id));
    const d = await loadEnvironment();
    expect(d.bsdAction).toMatchObject({ id: open.id, label: expect.any(String) });
    expect(d.bsdActionDefaults.link).toBeUndefined();
    // Action close : plus retrouvée, une nouvelle action peut être créée et rattachée à l'exigence.
    await db.update(t.actions).set({ status: 'abandonnee', cancelledAt: new Date(), cancelledById: 'clefevre', cancelReason: 'Test' }).where(eq(t.actions.id, open.id));
    const after = await loadEnvironment();
    expect(after.bsdAction).toBeNull();
    expect(after.bsdActionDefaults.link).toBe(`requirement:${req.id}`);
  });
});
