import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtDate, today } from '../dates';
import { REQUIREMENT_EVAL, type Tone } from '../domain';
import { actionView, controlStatus, loadControls, loadPeople } from '../queries';
import { attachmentUrl } from '../uploads';

// ─── Veille et contrôles ────────────────────────────────────────────────────

/** Filtres de l'onglet « Contrôles périodiques » (paramètre `statut`). */
export type ControlFilter = 'depasses' | 'sous-30-j' | 'planifies';
export const CONTROL_FILTERS: { key: ControlFilter; label: string }[] = [
  { key: 'depasses', label: 'Dépassés' },
  { key: 'sous-30-j', label: 'Sous 30 j' },
  { key: 'planifies', label: 'Planifiés' },
];

/** Évaluations qui appellent une action dans le plan d'actions unique. */
const NEEDS_ACTION = new Set(['ecart', 'analyse']);

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

const fileIcon = (mime: string) =>
  mime === 'application/pdf' ? 'ph-file-pdf' : mime.startsWith('image/') ? 'ph-file-image' : mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv' ? 'ph-file-xls' : mime.includes('word') ? 'ph-file-doc' : 'ph-file-text';

/**
 * Exigences réglementaires (toute l'entreprise) et contrôles périodiques (site sélectionné),
 * avec l'action liée de chaque exigence et l'historique des contrôles réalisés.
 */
export async function loadWatch() {
  const db = await getDb();
  const now = today();
  const [people, reqs, controls, sites] = await Promise.all([
    loadPeople(),
    db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id)),
    loadControls(),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));

  // Les actions liées aux exigences sont lues sans filtre de site : la veille vaut pour toute l'entreprise.
  const actionIds = [...new Set(reqs.map((r) => r.actionId).filter((id): id is string => !!id))];
  const controlIds = controls.map((c) => c.id);
  const [actions, records] = await Promise.all([
    actionIds.length ? db.select().from(t.actions).where(inArray(t.actions.id, actionIds)) : Promise.resolve([]),
    controlIds.length
      ? db.select().from(t.controlRecords).where(inArray(t.controlRecords.controlId, controlIds)).orderBy(desc(t.controlRecords.performedOn), desc(t.controlRecords.id))
      : Promise.resolve([]),
  ]);
  const files = records.length
    ? await db.select().from(t.attachments)
      .where(and(eq(t.attachments.entityType, 'control_record'), inArray(t.attachments.entityId, records.map((r) => String(r.id)))))
      .orderBy(asc(t.attachments.createdAt))
    : [];
  const actionById = new Map(actions.map((a) => [a.id, actionView(a, people, now)]));

  const requirements = reqs.map((r) => {
    const ev = REQUIREMENT_EVAL[r.evaluation] ?? { label: r.evaluation, tone: 'neutral' as Tone };
    const a = r.actionId ? actionById.get(r.actionId) : undefined;
    return {
      ...r,
      due: [r.dueOn && fmtDate(r.dueOn), r.dueNote].filter(Boolean).join(' · '),
      evalLabel: r.evaluationNote ? `${ev.label} · ${r.evaluationNote}` : ev.label,
      tone: ev.tone,
      pilot: name(r.pilotId),
      lastEvaluated: r.lastEvaluatedOn ? fmtDate(r.lastEvaluatedOn) : null,
      needsAction: NEEDS_ACTION.has(r.evaluation) && !r.actionId,
      action: a ? { id: a.id, title: a.title, statusLabel: a.statusLabel, tone: a.tone, due: fmtDate(a.dueOn), late: a.late } : null,
    };
  });

  const recordsByControl = new Map<number, ReturnType<typeof recordView>[]>();
  function recordView(r: (typeof records)[number]) {
    return {
      id: r.id,
      performedOn: r.performedOn,
      date: fmtDate(r.performedOn),
      organization: r.organization,
      reserves: r.reserves,
      notes: r.notes,
      recordedBy: name(r.recordedById),
      files: files.filter((f) => f.entityId === String(r.id)).map((f) => ({ id: f.id, name: f.fileName, url: attachmentUrl(f.id), size: fmtSize(f.size), icon: fileIcon(f.mimeType) })),
    };
  }
  records.forEach((r) => recordsByControl.set(r.controlId, [...(recordsByControl.get(r.controlId) ?? []), recordView(r)]));

  return {
    requirements,
    controls: controls.map((c) => {
      const s = controlStatus(c, now);
      const filter: ControlFilter = s.days < 0 ? 'depasses' : s.days <= 30 ? 'sous-30-j' : 'planifies';
      return {
        ...c,
        period: `${c.periodMonths} mois`,
        last: fmtDate(c.lastOn),
        next: fmtDate(c.nextOn),
        status: s.label,
        tone: s.tone,
        days: s.days,
        filter,
        responsible: name(c.responsibleId),
        siteLabel: c.siteId ? siteLabel.get(c.siteId) ?? c.siteId : 'Tous les sites',
        records: recordsByControl.get(c.id) ?? [],
      };
    }),
  };
}

export type WatchData = Awaited<ReturnType<typeof loadWatch>>;
export type RequirementView = WatchData['requirements'][number];
export type ControlView = WatchData['controls'][number];
export type ControlRecordView = ControlView['records'][number];
