import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { eq, is, sql } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { CONTEXT_KINDS } from '@/lib/domain';
import { HEALTH_FIELDS } from '@/lib/rules/events';
import { SEVESO_LEVELS } from '@/lib/rules/prevention';
import { ZONE_KINDS } from '@/lib/rules/sitemap';
import { STALE_EDIT, entityVersion, staleEditError } from '@/server/versions';

// Demande M-19 de Matrix (décision du 05/11/2026) : la DSI corrige les données de Vigie depuis la visionneuse de Matrix par
// vigie.pub_editer (migration 0027), qui n'ouvre que les tables et colonnes du registre external_edit_tables /
// external_edit_columns, applique les contrôles de la saisie dans Vigie et écrit le journal de Vigie dans la même
// transaction. PGlite, ou PostgreSQL avec TEST_DATABASE_URL (schéma vigie). Spec : docs/specs/edition-matrix-m19.md.

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;
const SIGNATURE = 'text, text, jsonb, jsonb, text, text';
const PAR = 'Jeanne Martin';
const MOTIF = 'Correction demandée par le responsable du site';

type Call = { table: string; action: string; cle?: unknown; valeurs?: unknown; par?: string | null; motif?: string | null };
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

/** Appel de la fonction comme Matrix le fait (arguments typés) ; renvoie la ligne après modification. */
async function edit(c: Call): Promise<Row> {
  const [r] = await rows(sql`select pub_editer(${c.table}, ${c.action}, ${json(c.cle)}::jsonb, ${json(c.valeurs)}::jsonb,
    ${c.par === undefined ? PAR : c.par}, ${c.motif === undefined ? MOTIF : c.motif}) as r`);
  return (typeof r.r === 'string' ? JSON.parse(r.r) : r.r) as Row;
}

/** Refus de la fonction : SQLSTATE et message (PGlite ou node-postgres, éventuellement enveloppés par Drizzle). */
async function refusal(c: Call): Promise<{ code?: string; message: string }> {
  try {
    await edit(c);
  } catch (err) {
    const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    return { code: e.cause?.code ?? e.code, message: e.cause?.message ?? e.message ?? '' };
  }
  throw new Error(`appel accepté : ${JSON.stringify(c)}`);
}

const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const tables = Object.values(t).filter((v) => is(v, PgTable)) as PgTable[];
const tableConfig = (name: string) => {
  const found = tables.find((x) => getTableConfig(x).name === name);
  if (!found) throw new Error(`table ${name} absente de schema.ts`);
  return getTableConfig(found);
};
const count = async (table: string) => Number((await rows(sql.raw(`select count(*)::int as n from ${table}`)))[0].n);

describe('registre des tables et colonnes ouvertes', () => {
  it('cohérent avec schema.ts : colonnes existantes, types pris en charge, aucune donnée de santé ni colonne refusée', async () => {
    const db = await getDb();
    const registered = await db.select().from(t.externalEditTables);
    const columns = await db.select().from(t.externalEditColumns);
    expect(registered.map((r) => r.tableName).sort()).toEqual([
      'certifications', 'context_items', 'contractors', 'controls', 'emergency_situations', 'map_zones', 'qhse_objectives',
      'requirements', 'sites', 'training_titles', 'waste_streams',
    ]);
    const health = new Set([...HEALTH_FIELDS.map(snake), 'health']);
    for (const r of registered) {
      const cfg = tableConfig(r.tableName);
      const byName = new Map(cfg.columns.map((c) => [c.name, c]));
      expect(r.label.trim(), r.tableName).not.toBe('');
      expect(r.entityType.trim(), r.tableName).not.toBe('');
      expect(byName.get(r.keyColumn)?.primary, `${r.tableName}.${r.keyColumn} clé primaire`).toBe(true);
      if (r.entityIdColumn) expect(byName.has(r.entityIdColumn)).toBe(true);
      const opened = columns.filter((c) => c.tableName === r.tableName);
      expect(opened.length, r.tableName).toBeGreaterThan(0);
      for (const c of opened) {
        const col = byName.get(c.columnName);
        const where = `${r.tableName}.${c.columnName}`;
        expect(col, where).toBeDefined();
        expect(c.label.trim(), where).not.toBe('');
        expect(health.has(c.columnName), where).toBe(false);
        expect(['PgText', 'PgBoolean', 'PgInteger'], where).toContain(col!.columnType);
        if (col!.columnType === 'PgInteger') expect([c.minValue, c.maxValue], where).not.toContain(null);
        if (col!.columnType === 'PgText' && c.columnName !== 'site_id') expect(c.maxLength ?? c.choices, where).toBeTruthy();
        // Refus inscrits dans la base : jamais une colonne du registre, sauf le site d'une création.
        const [denied] = await rows(sql`select external_edit_denied(${r.tableName}, ${c.columnName}, 'corriger') as d`);
        expect(denied.d, where).toBe(c.columnName === 'site_id' ? 'le site ne change pas depuis Matrix (règles de Vigie)' : null);
        if (c.columnName === 'site_id') expect(r.canAdd, where).toBe(true);
      }
      // Ajout : clé générée par la base et toute colonne obligatoire sans valeur par défaut ouverte.
      if (r.canAdd) {
        expect(byName.get(r.keyColumn)!.hasDefault, r.tableName).toBe(true);
        for (const col of cfg.columns.filter((x) => x.notNull && !x.hasDefault)) {
          expect(opened.map((c) => c.columnName), `${r.tableName}.${col.name}`).toContain(col.name);
        }
      }
      // Retrait = archivage : triplet archived_at / archived_by_id / archive_reason.
      if (r.canRemove) for (const name of ['archived_at', 'archived_by_id', 'archive_reason']) expect(byName.has(name), `${r.tableName}.${name}`).toBe(true);
    }
  });

  it('listes de valeurs identiques à celles de l’interface (libellés du journal)', async () => {
    const db = await getDb();
    const choices = new Map((await db.select().from(t.externalEditColumns)).filter((c) => c.choices).map((c) => [`${c.tableName}.${c.columnName}`, c.choices]));
    expect(choices.get('map_zones.kind')).toEqual(Object.fromEntries(Object.entries(ZONE_KINDS).map(([k, v]) => [k, v.label])));
    expect(choices.get('context_items.kind')).toEqual(Object.fromEntries(Object.entries(CONTEXT_KINDS).map(([k, v]) => [k, v.label])));
    expect(choices.get('sites.seveso')).toEqual(Object.fromEntries(SEVESO_LEVELS));
    expect([...choices.keys()].sort()).toEqual(['context_items.kind', 'map_zones.kind', 'sites.seveso']);
  });

  it('refus inscrits : toutes les données de santé, identifiants, états, triplets et clés des autres outils', async () => {
    const denied = async (table: string, column: string, action = 'corriger') => (await rows(sql`select external_edit_denied(${table}, ${column}, ${action}) as d`))[0].d;
    for (const f of [...HEALTH_FIELDS.map(snake), 'health']) expect(await denied('events', f), f).toBe('donnée de santé');
    for (const f of ['id', 'sort', 'status', 'matrix_state', 'cursus_state', 'archived_at', 'archive_reason', 'cancelled_by_id', 'created_at', 'qr_version', 'polygon', 'hidden_at']) {
      expect(await denied('controls', f), f).toBe('identifiant, ordre, état ou suivi tenu par Vigie');
    }
    for (const [table, f] of [['contractors', 'supplier_id'], ['events', 'keystone_project_code'], ['process_safety_studies', 'capex_code'], ['controls', 'equipment_code'], ['sites', 'label'], ['training_titles', 'label'], ['training_titles', 'validity_months']]) {
      expect(await denied(table, f), `${table}.${f}`).toBe('donnée ou clé tenue par un autre outil');
    }
    expect(await denied('emergency_situations', 'site_id', 'ajouter')).toBeNull();
    expect(await denied('emergency_situations', 'label')).toBeNull();
  });
});

describe('vigie.pub_editer : protections', () => {
  it('SECURITY DEFINER, search_path fixé au schéma de Vigie puis pg_temp, aucune exécution pour PUBLIC', async () => {
    const funcs = await rows(sql`select p.proname as name, p.prosecdef as definer, p.proconfig::text as config, n.nspname as schema,
        (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('pub_editer', 'external_edit_denied', 'external_edit_shown') order by 1`);
    expect(funcs.map((f) => f.name)).toEqual(['external_edit_denied', 'external_edit_shown', 'pub_editer']);
    for (const f of funcs) expect(f.public_exec, String(f.name)).toBe(0);
    const main = funcs.find((f) => f.name === 'pub_editer')!;
    expect(main.definer).toBe(true);
    expect(main.config).toContain(`search_path=${main.schema}, pg_temp`);
    expect(main.schema).toBe(process.env.TEST_DATABASE_URL ? 'vigie' : 'public');
    const [comment] = await rows(sql`select obj_description(p.oid, 'pg_proc') as c from pg_proc p where p.proname = 'pub_editer'`);
    expect(String(comment.c)).toMatch(/^Contrat M-19 v1/);
  });

  it.runIf(!!process.env.TEST_DATABASE_URL)('PostgreSQL : un rôle quelconque ne peut pas l’exécuter (droit accordé par Matrix seulement)', async () => {
    const role = `vigie_essai_${Date.now()}`;
    await rows(sql.raw(`create role ${role} nologin`));
    try {
      for (const fn of [`vigie.pub_editer(${SIGNATURE})`, 'vigie.external_edit_denied(text, text, text)', 'vigie.external_edit_shown(jsonb, jsonb)']) {
        const [r] = await rows(sql.raw(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') as can`));
        expect(r.can, fn).toBe(false);
      }
      const [tbl] = await rows(sql.raw(`select has_table_privilege('${role}', 'vigie.external_edit_columns', 'INSERT') as can`));
      expect(tbl.can).toBe(false);
    } finally {
      await rows(sql.raw(`drop role ${role}`));
    }
  });

  it('arguments : action, personne, motif (règle reasonError), clé et valeurs contrôlés ; refus P0V03 en français', async () => {
    const db = await getDb();
    const [ctrl] = await db.select().from(t.controls).where(sql`${t.controls.archivedAt} is null`).limit(1);
    const cle = { id: ctrl.id };
    const before = await lastLog('control', ctrl.id);
    for (const [c, message] of [
      [{ table: 'controls', action: 'supprimer', cle }, 'Action inconnue'],
      [{ table: 'controls', action: 'corriger', cle, valeurs: { tolerance: 'x' }, par: '  ' }, 'p_par) obligatoire'],
      [{ table: 'controls', action: 'corriger', cle, valeurs: { tolerance: 'x' }, par: 'A\nB' }, 'p_par) invalide'],
      [{ table: 'controls', action: 'corriger', cle, valeurs: { tolerance: 'x' }, par: 'x'.repeat(201) }, 'p_par) invalide'],
      [{ table: 'controls', action: 'corriger', cle, valeurs: { tolerance: 'x' }, motif: '   ' }, 'Motif obligatoire.'],
      [{ table: 'controls', action: 'corriger', cle, valeurs: { tolerance: 'x' }, motif: 'x'.repeat(1001) }, 'Motif : 1000 caractères au maximum.'],
      [{ table: 'controls', action: 'corriger', cle: { id: ctrl.id, site_id: 'site_a' }, valeurs: { tolerance: 'x' } }, 'Clé (p_cle) invalide'],
      [{ table: 'controls', action: 'corriger', cle: null, valeurs: { tolerance: 'x' } }, 'Clé (p_cle) invalide'],
      [{ table: 'controls', action: 'corriger', cle, valeurs: {} }, 'Valeurs (p_valeurs) obligatoires'],
      [{ table: 'controls', action: 'corriger', cle: { id: 999999 }, valeurs: { tolerance: 'x' } }, 'Contrôle périodique introuvable : 999999.'],
      [{ table: 'controls', action: 'corriger', cle: { id: 'abc' }, valeurs: { tolerance: 'x' } }, 'Contrôle périodique introuvable : abc.'],
    ] as [Call, string][]) {
      const r = await refusal(c);
      expect(r.code, message).toBe('P0V03');
      expect(r.message, message).toContain(message);
    }
    // 1000 caractères : admis (même borne que reasonError).
    await edit({ table: 'controls', action: 'corriger', cle, valeurs: { tolerance: '± 0,5 bar' }, motif: `  ${'m'.repeat(1000)}  ` });
    expect((await lastLog('control', ctrl.id))!.reason).toBe('m'.repeat(1000));
    expect((await lastLog('control', ctrl.id))!.id).not.toBe(before?.id);
  });

  it('tables : fermées (métier à circuit, journaux, personnes, santé) ou non ouvertes, refusées', async () => {
    for (const table of ['events', 'event_steps', 'benign_accidents', 'attachments', 'people', 'actions', 'change_log', 'access_log', 'inbound_requests', 'keystone_assignments', 'external_edit_columns']) {
      const r = await refusal({ table, action: 'corriger', cle: { id: 'x' }, valeurs: { label: 'x' } });
      expect(r, table).toEqual({ code: 'P0V03', message: `Table fermée à l'édition depuis Matrix : ${table}.` });
    }
    for (const table of ['risks', 'work_units', 'audit_plan_tracks', 'process_safety_studies', 'nimporte']) {
      expect((await refusal({ table, action: 'corriger', cle: { id: 1 }, valeurs: { label: 'x' } })).message, table).toBe(`Table non ouverte à l'édition depuis Matrix : ${table}.`);
    }
  });

  it('colonnes : non ouvertes, de santé, refusées par nom même si le registre les ouvrait', async () => {
    const db = await getDb();
    const [c] = await db.select().from(t.contractors).limit(1);
    const cle = { id: c.id };
    expect((await refusal({ table: 'contractors', action: 'corriger', cle, valeurs: { name: 'Autre' } })).message).toBe("Colonne non ouverte à l'édition depuis Matrix : contractors.name.");
    expect((await refusal({ table: 'contractors', action: 'corriger', cle, valeurs: { injury: 'arret' } })).message).toBe('Colonne refusée : injury (donnée de santé).');
    expect((await refusal({ table: 'contractors', action: 'corriger', cle, valeurs: { archived_at: '2026-10-01' } })).message).toContain('Colonne refusée : archived_at');
    // Registre erroné : la colonne reste refusée par la fonction.
    await db.insert(t.externalEditColumns).values({ tableName: 'contractors', columnName: 'supplier_id', label: 'Fournisseur Keystone', maxLength: 64 });
    try {
      expect((await refusal({ table: 'contractors', action: 'corriger', cle, valeurs: { supplier_id: null } })).message).toBe('Colonne refusée : supplier_id (donnée ou clé tenue par un autre outil).');
    } finally {
      await db.delete(t.externalEditColumns).where(sql`${t.externalEditColumns.tableName} = 'contractors' and ${t.externalEditColumns.columnName} = 'supplier_id'`);
    }
    // Changement de site : jamais par « corriger ».
    const [s] = await db.select().from(t.emergencySituations).limit(1);
    expect((await refusal({ table: 'emergency_situations', action: 'corriger', cle: { id: s.id }, valeurs: { site_id: 'site_b' } })).message)
      .toBe('Colonne refusée : site_id (le site ne change pas depuis Matrix (règles de Vigie)).');
  });
});

describe('corriger', () => {
  it('valeur écrite, journal de la fiche (auteur nul, Matrix, motif, valeurs changées), version QUA-12 changée', async () => {
    const db = await getDb();
    const [ctrl] = await db.select().from(t.controls).where(sql`${t.controls.archivedAt} is null`).orderBy(t.controls.id).limit(1);
    const version = await entityVersion(db, 'control', ctrl.id);
    const out = await edit({ table: 'controls', action: 'corriger', cle: { id: ctrl.id }, valeurs: { equipment: `  ${ctrl.equipment} (pont 2)  `, organization: ctrl.organization, tolerance: '   ' } });
    expect(Object.keys(out).sort()).toEqual(['archived_at', 'control_type', 'equipment', 'id', 'organization', 'tolerance']);
    expect(out).toMatchObject({ id: ctrl.id, equipment: `${ctrl.equipment} (pont 2)`, tolerance: null, archived_at: null });
    const [after] = await db.select().from(t.controls).where(eq(t.controls.id, ctrl.id));
    expect(after).toEqual({ ...ctrl, equipment: `${ctrl.equipment} (pont 2)`, tolerance: null });
    const log = await lastLog('control', ctrl.id);
    const [{ who }] = await rows(sql`select session_user::text as who`);
    expect(log).toMatchObject({ action: 'update', byId: null, reason: MOTIF, summary: `Corrigé depuis Matrix par ${PAR} (${String(who)})` });
    expect(log!.details).toEqual([
      { field: 'Équipement', from: ctrl.equipment, to: `${ctrl.equipment} (pont 2)` },
      ...(ctrl.tolerance ? [{ field: 'Tolérance (EMT)', from: ctrl.tolerance, to: null }] : []),
    ]);
    // Une saisie ouverte avant la correction est refusée comme périmée.
    expect(await entityVersion(db, 'control', ctrl.id)).not.toBe(version);
    expect(await staleEditError(db, 'control', ctrl.id, version)).toBe(STALE_EDIT);
    // Aucune valeur changée : rien d'écrit, rien au journal.
    const n = (await rows(sql`select count(*)::int as n from change_log`))[0].n;
    await edit({ table: 'controls', action: 'corriger', cle: { id: String(ctrl.id) }, valeurs: { equipment: `${ctrl.equipment} (pont 2)` } });
    expect((await rows(sql`select count(*)::int as n from change_log`))[0].n).toBe(n);
  });

  it('booléens et listes : libellés du journal de Vigie (site, zone de la carte journalisée sur le site, titre)', async () => {
    const db = await getDb();
    const [site] = await db.select().from(t.sites).where(eq(t.sites.id, 'site_a'));
    await edit({ table: 'sites', action: 'corriger', cle: { id: 'site_a' }, valeurs: { seveso: 'seuil_bas', alsace_moselle: !site.alsaceMoselle } });
    expect((await lastLog('site', 'site_a'))!.details).toEqual(expect.arrayContaining([
      { field: 'Classement Seveso', from: site.seveso ? Object.fromEntries(SEVESO_LEVELS)[site.seveso] : null, to: 'Seuil bas' },
      { field: 'Droit local d’Alsace-Moselle', from: site.alsaceMoselle ? 'oui' : 'non', to: site.alsaceMoselle ? 'non' : 'oui' },
    ]));
    const [zone] = await db.select().from(t.mapZones).where(sql`${t.mapZones.archivedAt} is null`).limit(1);
    await edit({ table: 'map_zones', action: 'corriger', cle: { id: zone.id }, valeurs: { kind: zone.kind === 'atex' ? 'quai' : 'atex' } });
    const log = await lastLog('site_map', zone.siteId);
    expect(log!.summary).toMatch(new RegExp(`^Corrigé depuis Matrix par ${PAR} \\(.+\\) · Zone de la carte n° ${zone.id}$`));
    expect(log!.details).toEqual([{ field: 'Type', from: ZONE_KINDS[zone.kind as keyof typeof ZONE_KINDS].label, to: zone.kind === 'atex' ? 'Quai' : 'Zone ATEX' }]);
    const [title] = await db.select().from(t.trainingTitles).where(sql`${t.trainingTitles.archivedAt} is null`).limit(1);
    const out = await edit({ table: 'training_titles', action: 'corriger', cle: { id: title.id }, valeurs: { awareness: !title.awareness } });
    expect(out).toEqual({ id: title.id, first_aid: title.firstAid, awareness: !title.awareness, internal_auditor: title.internalAuditor, archived_at: null });
    expect((await lastLog('training_title', title.id))!.details).toEqual([{ field: 'Sensibilisation', from: title.awareness ? 'oui' : 'non', to: title.awareness ? 'non' : 'oui' }]);
  });

  it('contrôles de la saisie : obligatoire, longueur, liste, format, type, bornes ; contrainte de la base en message lisible', async () => {
    const db = await getDb();
    const [ctrl] = await db.select().from(t.controls).limit(1);
    const [zone] = await db.select().from(t.mapZones).limit(1);
    const [c] = await db.select().from(t.contractors).limit(1);
    const [s] = await db.select().from(t.emergencySituations).limit(1);
    const [item] = await db.select().from(t.contextItems).where(sql`${t.contextItems.kind} = 'risque' and ${t.contextItems.archivedAt} is null`).limit(1);
    for (const [call, message] of [
      [{ table: 'controls', cle: { id: ctrl.id }, valeurs: { equipment: '  ' } }, '« Équipement » : champ obligatoire.'],
      [{ table: 'controls', cle: { id: ctrl.id }, valeurs: { equipment: null } }, '« Équipement » : champ obligatoire.'],
      [{ table: 'controls', cle: { id: ctrl.id }, valeurs: { equipment: 'x'.repeat(161) } }, '« Équipement » : 160 caractères au maximum.'],
      [{ table: 'controls', cle: { id: ctrl.id }, valeurs: { equipment: 12 } }, '« Équipement » : texte attendu.'],
      [{ table: 'map_zones', cle: { id: zone.id }, valeurs: { kind: 'piscine' } }, '« Type » : valeur non autorisée (valeurs admises : atelier, atex, autre, batiment, essais, exterieur, parking, quai, stockage).'],
      [{ table: 'contractors', cle: { id: c.id }, valeurs: { contact_email: 'pas-une-adresse' } }, '« E-mail » : format invalide.'],
      [{ table: 'sites', cle: { id: 'site_a' }, valeurs: { alsace_moselle: 'oui' } }, '« Droit local d’Alsace-Moselle » : oui ou non attendu (true ou false).'],
      [{ table: 'emergency_situations', cle: { id: s.id }, valeurs: { drill_months: 0 } }, '« Périodicité des exercices (mois) » : minimum 1.'],
      [{ table: 'emergency_situations', cle: { id: s.id }, valeurs: { drill_months: 61 } }, '« Périodicité des exercices (mois) » : maximum 60.'],
      [{ table: 'emergency_situations', cle: { id: s.id }, valeurs: { drill_months: 6.5 } }, '« Périodicité des exercices (mois) » : nombre entier attendu.'],
      [{ table: 'emergency_situations', cle: { id: s.id }, valeurs: { drill_months: '12' } }, '« Périodicité des exercices (mois) » : nombre entier attendu.'],
      [{ table: 'context_items', cle: { id: item.id }, valeurs: { treatment: ' ' } }, '« Traitement » : indiquez le traitement prévu (actions, maîtrise, surveillance).'],
    ] as [Omit<Call, 'action'>, string][]) {
      expect(await refusal({ ...call, action: 'corriger' }), message).toEqual({ code: 'P0V03', message });
    }
    // Contrainte CHECK de la base (registre sans borne, par essai) : refus lisible, rien d'écrit.
    await db.update(t.externalEditColumns).set({ maxValue: null }).where(sql`${t.externalEditColumns.columnName} = 'drill_months'`);
    try {
      expect(await refusal({ table: 'emergency_situations', action: 'corriger', cle: { id: s.id }, valeurs: { drill_months: 61 } })).toEqual({
        code: 'P0V03', message: "Valeur refusée par les règles de Vigie (emergency_situations_drill_months_check) : rien n'a été modifié.",
      });
    } finally {
      await db.update(t.externalEditColumns).set({ maxValue: 60 }).where(sql`${t.externalEditColumns.columnName} = 'drill_months'`);
    }
    expect((await db.select().from(t.emergencySituations).where(eq(t.emergencySituations.id, s.id)))[0]).toEqual(s);
    // Format admis ; texte vide d'une colonne obligatoire en base mais facultative à la saisie : chaîne vide (comme Vigie).
    await edit({ table: 'contractors', action: 'corriger', cle: { id: c.id }, valeurs: { contact_email: 'hse@exemple.fr', contact_phone: '' } });
    expect((await db.select().from(t.contractors).where(eq(t.contractors.id, c.id)))[0]).toMatchObject({ contactEmail: 'hse@exemple.fr', contactPhone: null });
    const [cert] = await db.select().from(t.certifications).limit(1);
    await edit({ table: 'certifications', action: 'corriger', cle: { id: cert.id }, valeurs: { note: '  ' } });
    expect((await db.select().from(t.certifications).where(eq(t.certifications.id, cert.id)))[0].note).toBe('');
  });
});

describe('ajouter', () => {
  it('élément du contexte : ajouté à la suite, journal de création ; règle du traitement reprise', async () => {
    const db = await getDb();
    expect((await refusal({ table: 'context_items', action: 'ajouter', valeurs: { kind: 'opportunite', label: 'Marché de l’hydrogène' } })).message)
      .toBe('« Traitement » : indiquez le traitement prévu (actions, maîtrise, surveillance).');
    expect((await refusal({ table: 'context_items', action: 'ajouter', valeurs: { label: 'Sans nature' } })).message).toBe('« Nature » : champ obligatoire.');
    expect((await refusal({ table: 'context_items', action: 'ajouter', cle: { id: 1 }, valeurs: { kind: 'enjeu_interne', label: 'x' } })).message).toContain('Clé (p_cle) inutile');
    const [{ m }] = await rows(sql`select max(sort) as m from context_items`);
    const n = await count('context_items');
    const out = await edit({ table: 'context_items', action: 'ajouter', valeurs: { kind: 'opportunite', label: ' Marché de l’hydrogène ', treatment: 'Veille marché' } });
    expect(out).toMatchObject({ kind: 'opportunite', label: 'Marché de l’hydrogène', treatment: 'Veille marché', detail: '', archived_at: null });
    expect(await count('context_items')).toBe(n + 1);
    const [row] = await db.select().from(t.contextItems).where(eq(t.contextItems.id, Number(out.id)));
    expect(row).toMatchObject({ sort: Number(m) + 1, createdById: null });
    const log = await lastLog('context_item', String(out.id));
    expect(log).toMatchObject({ action: 'create', byId: null, reason: MOTIF });
    expect(log!.summary).toMatch(/^Ajouté depuis Matrix par Jeanne Martin \(/);
    expect(log!.details).toEqual([
      { field: 'Nature', from: null, to: 'Opportunité' },
      { field: 'Intitulé', from: null, to: 'Marché de l’hydrogène' },
      { field: 'Traitement', from: null, to: 'Veille marché' },
    ]);
  });

  it('situation d’urgence : site existant et suivi exigé ; ajout refusé aux tables sans création ouverte', async () => {
    const db = await getDb();
    await db.insert(t.sites).values({ id: 'site_ferme', label: 'Site fermé', archivedAt: new Date(), archiveReason: 'Site cédé' });
    const valeurs = { site_id: 'site_ferme', label: 'Fuite d’ammoniac', drill_months: 12 };
    expect((await refusal({ table: 'emergency_situations', action: 'ajouter', valeurs })).message).toBe('« Site » : site inconnu ou archivé dans Vigie (site_ferme).');
    expect((await refusal({ table: 'emergency_situations', action: 'ajouter', valeurs: { ...valeurs, site_id: 'site_inconnu' } })).message).toContain('site inconnu ou archivé');
    expect((await refusal({ table: 'emergency_situations', action: 'ajouter', valeurs: { label: 'x', drill_months: 12 } })).message).toBe('« Site » : champ obligatoire.');
    const out = await edit({ table: 'emergency_situations', action: 'ajouter', valeurs: { ...valeurs, site_id: 'site_b' } });
    expect(out).toMatchObject({ site_id: 'site_b', label: 'Fuite d’ammoniac', drill_months: 12, scenario: '', response: '' });
    expect(await lastLog('emergency_situation', String(out.id))).toMatchObject({ action: 'create', byId: null });
    for (const table of ['controls', 'contractors', 'waste_streams', 'sites', 'certifications']) {
      expect((await refusal({ table, action: 'ajouter', valeurs: { label: 'x' } })).message, table).toMatch(/ajout non ouvert depuis Matrix \(création à faire dans Vigie\)\.$/);
    }
  });
});

describe('retirer (archivage motivé, jamais une suppression)', () => {
  it('filière : archivée avec le motif, journal ; deuxième retrait et correction refusés ; aucune ligne supprimée', async () => {
    const db = await getDb();
    const [stream] = await db.select().from(t.wasteStreams).where(sql`${t.wasteStreams.archivedAt} is null`).limit(1);
    const n = await count('waste_streams');
    expect((await refusal({ table: 'waste_streams', action: 'retirer', cle: { id: stream.id }, valeurs: { channel: 'x' } })).message).toContain('inutiles pour « retirer »');
    const out = await edit({ table: 'waste_streams', action: 'retirer', cle: { id: stream.id }, motif: '  Filière remplacée par le contrat 2027  ' });
    expect(out.archived_at).not.toBeNull();
    expect(await count('waste_streams')).toBe(n);
    const [row] = await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, stream.id));
    expect(row).toMatchObject({ archivedById: null, archiveReason: 'Filière remplacée par le contrat 2027', label: stream.label });
    expect(await lastLog('waste_stream', stream.id)).toMatchObject({ action: 'archive', byId: null, reason: 'Filière remplacée par le contrat 2027', details: null });
    expect((await lastLog('waste_stream', stream.id))!.summary).toMatch(/^Retiré \(archivé\) depuis Matrix par Jeanne Martin/);
    const again = await refusal({ table: 'waste_streams', action: 'retirer', cle: { id: stream.id } });
    expect(again).toEqual({ code: 'P0V03', message: `Ligne archivée : Filière de déchets ${stream.id} ne se modifie plus depuis Matrix (à réactiver d'abord dans Vigie).` });
    expect((await refusal({ table: 'waste_streams', action: 'corriger', cle: { id: stream.id }, valeurs: { channel: 'Autre' } })).message).toMatch(/^Ligne archivée/);
  });

  it('refusé aux tables sans retrait ouvert (règles d’archivage propres à Vigie, ou sans archivage)', async () => {
    const db = await getDb();
    const [c] = await db.select().from(t.contractors).limit(1);
    const [cert] = await db.select().from(t.certifications).limit(1);
    const [zone] = await db.select().from(t.mapZones).limit(1);
    const [title] = await db.select().from(t.trainingTitles).limit(1);
    for (const [table, id] of [['contractors', c.id], ['certifications', cert.id], ['map_zones', zone.id], ['training_titles', title.id], ['sites', 'site_a'], ['requirements', 1]] as const) {
      expect((await refusal({ table, action: 'retirer', cle: { id } })).message, table).toMatch(/retrait non ouvert depuis Matrix/);
    }
    expect(await count('contractors')).toBeGreaterThan(0);
  });

  it('élément du contexte, objectif, contrôle, situation d’urgence : retrait ouvert', async () => {
    const db = await getDb();
    for (const [table, entity, rowsOf] of [
      ['context_items', 'context_item', () => db.select({ id: t.contextItems.id }).from(t.contextItems).where(sql`archived_at is null`).limit(1)],
      ['qhse_objectives', 'qhse_objective', () => db.select({ id: t.qhseObjectives.id }).from(t.qhseObjectives).where(sql`archived_at is null`).limit(1)],
      ['controls', 'control', () => db.select({ id: t.controls.id }).from(t.controls).where(sql`archived_at is null`).limit(1)],
      ['emergency_situations', 'emergency_situation', () => db.select({ id: t.emergencySituations.id }).from(t.emergencySituations).where(sql`archived_at is null`).limit(1)],
    ] as const) {
      const [{ id }] = await rowsOf();
      const n = await count(table);
      await edit({ table, action: 'retirer', cle: { id } });
      expect(await count(table), table).toBe(n);
      expect(await lastLog(entity, id), table).toMatchObject({ action: 'archive', reason: MOTIF });
    }
  });
});
