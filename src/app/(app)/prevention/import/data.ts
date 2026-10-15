import 'server-only';
import { asc, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadFormOptions } from '@/lib/data/options';
import { today } from '@/lib/today';
import { config } from '@/lib/config';
import { aiStatus } from '@/lib/pp-import/ai';
import { IMPORT_FORMATS, readMapping } from '@/lib/pp-import/schemas';
import type { ImportScreenData } from '@/lib/pp-import/types';
import { currentSiteId, getSession } from '@/lib/session';

const parisDay = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Données de l'écran d'import (référentiels des formulaires, modèles enregistrés), sur le site sélectionné ou les sites actifs. */
export async function loadImportScreen(): Promise<ImportScreenData> {
  const [db, session, selectedSite, options] = await Promise.all([getDb(), getSession(), currentSiteId(), loadFormOptions()]);
  const [templates, contractors, sites, people] = await Promise.all([
    db.select().from(t.ppImportTemplates).orderBy(asc(t.ppImportTemplates.name)),
    // Entreprises archivées exclues : ni proposées, ni reconnues par leur nom dans le formulaire importé.
    db.select({ id: t.contractors.id, name: t.contractors.name, trade: t.contractors.trade }).from(t.contractors).where(isNull(t.contractors.archivedAt)),
    db.select().from(t.sites).where(isNull(t.sites.archivedAt)).orderBy(asc(t.sites.sort)),
    db.select({ id: t.people.id, name: t.people.name }).from(t.people),
  ]);
  const personName = new Map(people.map((p) => [p.id, p.name]));
  return {
    templates: templates.map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      format: IMPORT_FORMATS.find((f) => f === tpl.format) ?? 'scan',
      signature: tpl.signature,
      mapping: readMapping(tpl.mapping) ?? {},
      updatedOn: parisDay.format(tpl.createdAt),
      updatedBy: tpl.updatedById ? personName.get(tpl.updatedById) ?? null : null,
    })),
    contractors: contractors.sort((a, b) => a.name.replace(/^\[/, '').localeCompare(b.name.replace(/^\[/, ''), 'fr', { sensitivity: 'base' })),
    sites: sites
      .filter((s) => !selectedSite || s.id === selectedSite)
      .map((s) => ({ id: s.id, label: s.label, seveso: s.seveso, ppFromFirstMinute: s.ppFromFirstMinute })),
    defaultSiteId: selectedSite ?? sites[0]?.id ?? '',
    siteLocked: !!selectedSite,
    people: options.people,
    projects: options.projects,
    today: today(),
    currentUserId: session.user.id,
    aiStatus: aiStatus(config()),
  };
}
