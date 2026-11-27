import { AUDIT_KINDS, FINDING_KINDS, canSee } from '@/lib/domain';
import { auditReportFileName, buildAuditReportPdf, type AuditReportData } from '@/lib/audit-report-pdf';
import { auditReportRef } from '@/lib/rules/audits';
import { loadAuditReport } from '@/lib/data/audits';
import { getSession } from '@/lib/session';
import { getI18n } from '@/i18n/server';
import { labelT } from '@/i18n/labels';

// Rapport d'audit en PDF (AUD-39) : /audits/rapport/<identifiant de l'élément du programme>. Mêmes lecteurs que l'écran
// Audits (le Salarié n'y a pas accès : 403), élément visible (site sélectionné et périmètre, AUD-22), réalisé, hors revue de
// direction (404 sinon, sans rien révéler). Téléchargé en pièce jointe, jamais conservé ni envoyé.

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/audits/rapport/[id]'>) {
  const [{ role, user }, { t }] = await Promise.all([getSession(), getI18n()]);
  const l = labelT(t);
  if (!canSee(role, 'audits')) return text(403, t('Access denied'));
  const { id } = await ctx.params;
  const n = /^\d{1,9}$/.test(id) ? Number(id) : null;
  const report = n ? await loadAuditReport(n) : null;
  if (!report) return text(404, t('Audit not found or not carried out'));
  const { item, findings, now } = report;
  const data: AuditReportData = {
    ref: auditReportRef(item),
    title: item.detail ?? item.label,
    kindLabel: AUDIT_KINDS[item.auditKind] ? l(AUDIT_KINDS[item.auditKind].label) : item.kind,
    track: item.track,
    site: item.site,
    doneOn: item.doneOn,
    auditor: item.auditorLabel,
    scope: item.scope,
    owner: item.owner,
    findings: findings.map((f) => ({
      kindLabel: FINDING_KINDS[f.kind] ? l(FINDING_KINDS[f.kind].label) : f.kind, clause: f.clause, text: f.text, foundOn: f.foundOn, responseDueOn: f.responseDueOn,
      actions: f.actions.map((a) => ({ id: a.id, title: a.action?.title ?? null, status: a.action?.status ? l(a.action.status) : null })),
    })),
    generatedOn: now,
    generatedBy: user.name,
  };
  const bytes = await buildAuditReportPdf(data, t);
  const name = auditReportFileName(data, t);
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
