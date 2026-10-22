import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { asc, eq, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { DEMO_EQUIPMENT_CODE } from '@/db/seeds/controls-share';
import { loadWatch } from '@/lib/data/watch';
import { archiveControl, recordControl, saveControl } from '@/server/watch';

// Demande de Crucible du 22/10/2026 (REQUESTS.md) : code commun d'équipement (controls.equipment_code) saisi dans la
// fiche du contrôle, et vue pub_controles (migration 0014, contrat Crucible v1), sur la base de démonstration (PGlite, ou
// PostgreSQL avec TEST_DATABASE_URL).

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;

const controlByEquipment = async (prefix: string) => {
  const all = await (await getDb()).select().from(t.controls).orderBy(asc(t.controls.sort));
  return all.find((c) => c.equipment.startsWith(prefix))!;
};

/** Formulaire de la fiche contrôle tel qu'envoyé (code compris), valeurs enregistrées éventuellement modifiées. */
async function controlForm(id: number, changes: Record<string, string> = {}) {
  const [c] = await (await getDb()).select().from(t.controls).where(eq(t.controls.id, id));
  return form({
    id: String(c.id), equipment: c.equipment, equipmentCode: c.equipmentCode ?? '', controlType: c.controlType, periodMonths: String(c.periodMonths),
    organization: c.organization, responsibleId: c.responsibleId ?? '', siteId: c.siteId ?? '',
    requirementId: c.requirementId != null ? String(c.requirementId) : '', lastOn: c.lastOn, nextOn: c.nextOn, ...changes,
  });
}

/** Ligne publiée d'un contrôle, dates en texte (indépendant du fuseau du client). */
async function published(id: number) {
  const [row] = await rows(sql`select vigie_ref, site_code, equipement, equipement_code, type_controle, organisme, periodicite_mois,
    dernier_le::text as dernier_le, prochain_le::text as prochain_le, reserves, archive, maj_le is not null as date_connue,
    maj_le >= (select max(l.at) from change_log l where l.entity_type = 'control' and l.entity_id = ${String(id)}) as maj_journal
    from pub_controles where vigie_ref = ${String(id)}`);
  return row;
}

describe('pub_controles : contrat Crucible v1', () => {
  it('colonnes dans l’ordre du contrat, types attendus', async () => {
    const cols = await rows(sql`select column_name, data_type from information_schema.columns
      where table_name = 'pub_controles' and table_schema = current_schema() order by ordinal_position`);
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual([
      ['vigie_ref', 'text'], ['site_code', 'text'], ['equipement', 'text'], ['equipement_code', 'text'], ['type_controle', 'text'],
      ['organisme', 'text'], ['periodicite_mois', 'integer'], ['dernier_le', 'date'], ['prochain_le', 'date'], ['reserves', 'text'],
      ['archive', 'boolean'], ['maj_le', 'timestamp with time zone'],
    ]);
  });

  it('tous les contrôles publiés, en vigueur et archivés ; code de démonstration du banc BE-1 et date du journal', async () => {
    const db = await getDb();
    const all = await db.select().from(t.controls);
    const [{ n }] = await rows(sql`select count(*)::int as n from pub_controles`);
    expect(n).toBe(all.length);
    const bench = await controlByEquipment("Banc d'essais BE-1");
    expect(await published(bench.id)).toEqual({
      vigie_ref: String(bench.id), site_code: 'ville-b', equipement: bench.equipment, equipement_code: DEMO_EQUIPMENT_CODE,
      type_controle: 'Inspection ATEX', organisme: bench.organization, periodicite_mois: 12, dernier_le: bench.lastOn, prochain_le: bench.nextOn,
      reserves: bench.reserves, archive: false, date_connue: true, maj_journal: true,
    });
    // Contrôle archivé du jeu (palan réformé) : publié, « archive » le dit.
    const hoist = await controlByEquipment('Palan électrique 2 t');
    expect(await published(hoist.id)).toMatchObject({ archive: true, equipement_code: null, date_connue: true });
    // Sans code, sans journal : date des enregistrements du contrôle.
    const compressor = await controlByEquipment('Compresseur');
    expect(await published(compressor.id)).toMatchObject({ equipement_code: null, archive: false, date_connue: true });
    // Ni journal ni enregistrement (reprise de données, par exemple) : maj_le nul.
    const [bare] = await db.insert(t.controls).values({
      equipment: 'Sans trace', controlType: 'VGP', periodMonths: 12, organization: '[Apave]', lastOn: '2026-01-01', nextOn: '2027-01-01', siteId: 'ville-a',
    }).returning({ id: t.controls.id });
    expect(await published(bare.id)).toMatchObject({ equipement_code: null, date_connue: false });
  });

  it('ni personne ni donnée de santé : aucune colonne de responsable, d’auteur ni de motif', async () => {
    const used = await rows(sql`select table_name, column_name from information_schema.view_column_usage
      where view_name = 'pub_controles' and view_schema = current_schema() order by 1, 2`);
    const columns = used.map((u) => `${u.table_name}.${u.column_name}`);
    for (const forbidden of ['controls.responsible_id', 'controls.archived_by_id', 'controls.archive_reason', 'control_records.recorded_by_id',
      'control_records.notes', 'change_log.by_id', 'change_log.reason', 'change_log.details', 'change_log.summary']) {
      expect(columns).not.toContain(forbidden);
    }
    expect(used.every((u) => ['controls', 'control_records', 'change_log'].includes(String(u.table_name)))).toBe(true);
  });
});

describe('controls.equipment_code : saisie dans la fiche du contrôle', () => {
  it('droits : Salarié et Chef de projet refusés ; site d’un autre contrôle refusé', async () => {
    const forklift = await controlByEquipment('Chariot élévateur');
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role);
      expect(await saveControl({}, await controlForm(forklift.id, { equipmentCode: 'CHE-R489' }))).toEqual({ error: DENIED });
    }
    actAs('Chef de service', 'ville-b');
    expect(await saveControl({}, await controlForm(forklift.id, { equipmentCode: 'CHE-R489' }))).toEqual({ error: expect.stringContaining('autre site') });
    expect((await controlByEquipment('Chariot élévateur')).equipmentCode).toBeNull();
  });

  it('format refusé avec un message par champ, rien d’écrit', async () => {
    const forklift = await controlByEquipment('Chariot élévateur');
    actAs('Animateur QHSE', 'ville-a');
    for (const [code, message] of [['X', /2 à 32/], ['CHE R489', /majuscules/], ['CHE_R489', /majuscules/], ['-CHE', /majuscules/], ['A'.repeat(33), /2 à 32/]] as const) {
      const r = await saveControl({}, await controlForm(forklift.id, { equipmentCode: code }));
      expect(r.fieldErrors?.equipmentCode, code).toMatch(message);
    }
    expect((await controlByEquipment('Chariot élévateur')).equipmentCode).toBeNull();
  });

  it('saisi (mis en majuscules), journalisé, publié avec maj_le ; retiré : null, journalisé ; non unique', async () => {
    const forklift = await controlByEquipment('Chariot élévateur');
    actAs('Chef de service', 'ville-a');
    expect(await saveControl({}, await controlForm(forklift.id, { equipmentCode: ' che-r489 ' }))).toEqual({ ok: true, id: String(forklift.id) });
    expect((await controlByEquipment('Chariot élévateur')).equipmentCode).toBe('CHE-R489');
    expect(await lastLog('control', forklift.id)).toMatchObject({
      action: 'update', byId: expect.any(String), details: [{ field: 'Code équipement', from: null, to: 'CHE-R489' }],
    });
    expect(await published(forklift.id)).toMatchObject({ equipement_code: 'CHE-R489', date_connue: true, maj_journal: true });

    // Non unique : un même équipement porte plusieurs contrôles (VGP et vérification électrique d'un chariot, par exemple).
    const crane = await controlByEquipment('Pont roulant 10 t');
    expect(await saveControl({}, await controlForm(crane.id, { equipmentCode: 'CHE-R489' }))).toEqual({ ok: true, id: String(crane.id) });
    const [{ n }] = await rows(sql`select count(*)::int as n from pub_controles where equipement_code = 'CHE-R489'`);
    expect(n).toBe(2);

    // Champ absent (ancien formulaire) : code conservé, aucune entrée de journal.
    const logs = (await changeLog('control', crane.id)).length;
    const { equipmentCode: _omit, ...rest } = Object.fromEntries((await controlForm(crane.id)).entries()) as Record<string, string>;
    void _omit;
    expect(await saveControl({}, form(rest))).toEqual({ ok: true, id: String(crane.id) });
    expect((await controlByEquipment('Pont roulant 10 t')).equipmentCode).toBe('CHE-R489');
    expect((await changeLog('control', crane.id)).length).toBe(logs);

    expect(await saveControl({}, await controlForm(crane.id, { equipmentCode: '' }))).toEqual({ ok: true, id: String(crane.id) });
    expect((await controlByEquipment('Pont roulant 10 t')).equipmentCode).toBeNull();
    expect((await lastLog('control', crane.id))?.details).toEqual([{ field: 'Code équipement', from: 'CHE-R489', to: null }]);
    expect(await published(crane.id)).toMatchObject({ equipement_code: null });
  });

  it('création avec code ; fiche chargée (loadWatch) ; contrôle enregistré puis archivage publiés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const created = await saveControl({}, form({
      equipment: 'Étuve climatique EC-3', equipmentCode: 'LAB67-EC3', controlType: 'Vérification métrologique', periodMonths: '12', organization: 'Interne — métrologie',
      responsibleId: '', siteId: 'ville-a', requirementId: '', lastOn: '2026-09-01', nextOn: '', reserves: '',
    }));
    expect(created).toMatchObject({ ok: true });
    const id = Number(created.id);
    expect(await lastLog('control', id)).toMatchObject({ action: 'create' });
    expect((await loadWatch()).controls.find((c) => c.id === id)).toMatchObject({ equipmentCode: 'LAB67-EC3' });
    expect(await published(id)).toMatchObject({ equipement_code: 'LAB67-EC3', dernier_le: '2026-09-01', prochain_le: '2027-09-01', archive: false, maj_journal: true });

    expect(await recordControl({}, form({ controlId: String(id), performedOn: '2026-10-05', organization: 'Interne — métrologie', reserves: '', result: 'favorable' })))
      .toMatchObject({ ok: true });
    expect(await published(id)).toMatchObject({ dernier_le: '2026-10-05', prochain_le: '2027-10-05', maj_journal: true });

    expect(await archiveControl({}, form({ id: String(id), reason: 'Étuve réformée' }))).toMatchObject({ ok: true });
    expect(await published(id)).toMatchObject({ archive: true, equipement_code: 'LAB67-EC3', maj_journal: true });
  });
});
