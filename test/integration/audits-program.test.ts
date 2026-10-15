import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadAudits, loadAuditSignals } from '@/lib/data/audits';
import { loadVisibleTodo } from '@/lib/data/todo';
import type { Role } from '@/lib/domain';
import { cancelFinding, cancelPlanItem, reschedulePlanItem, saveFinding, savePlanItem } from '@/server/audits';

// Programme annuel du lot 2 : consultation seule pour l'encadrement (AUD-02), report et annulation d'un élément avec
// motif, sans suppression (AUD-03), échéances des revues de direction verrouillées (AUD-01).
// Server actions : droits, motif, journal (les audits n'ont pas de site : AUD-22).

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const READERS: Role[] = ['Chef de service', 'Chef de projet', 'Salarié'];

/** Élément du programme par son libellé court (les identifiants dépendent de l'ordre d'insertion). */
async function planItem(label: string) {
  const db = await getDb();
  const [p] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.label, label));
  if (!p) throw new Error(`élément ${label} introuvable`);
  return p;
}

describe('AUD-02 : audits en consultation pour l’encadrement', () => {
  it('chef de service, chef de projet et salarié ne modifient ni le programme ni les constats', async () => {
    const be = await planItem('BE · 17/10');
    const db = await getDb();
    const [finding] = await db.select({ id: t.auditFindings.id }).from(t.auditFindings).limit(1);
    for (const role of READERS) {
      actAs(role);
      expect(await savePlanItem({}, form({ id: String(be.id), track: be.track, label: 'X', detail: 'X' })), role).toEqual({ error: DENIED });
      expect(await reschedulePlanItem({}, form({ id: String(be.id), year: '2026', month: '11', reason: 'x' })), role).toEqual({ error: DENIED });
      expect(await cancelPlanItem({}, form({ id: String(be.id), reason: 'x' })), role).toEqual({ error: DENIED });
      expect(await saveFinding({}, form({ planItemId: String(be.id), kind: 'piste', text: 'Constat' })), role).toEqual({ error: DENIED });
      expect(await cancelFinding({}, form({ id: String(finding.id), reason: 'x' })), role).toEqual({ error: DENIED });
    }
    expect((await planItem('BE · 17/10')).detail).toBe('Processus Conception BE');
  });

  it('les échéances des éléments dont ils sont responsables leur parviennent, avec le lien de l’élément', async () => {
    const be = await planItem('BE · 17/10');
    actAs('Chef de projet');
    const forDubois = await loadVisibleTodo();
    expect(forDubois.find((x) => x.title === 'Processus Conception BE')).toMatchObject({ href: `/audits?annee=2026&element=${be.id}` });
    const essais = await planItem('Essais 12/10');
    actAs('Chef de service');
    const forBenali = await loadVisibleTodo();
    expect(forBenali.find((x) => x.title === "Visite trimestrielle — zone d'essais")).toMatchObject({ href: `/audits?annee=2026&element=${essais.id}` });
  });
});

describe('AUD-03 : reporter un élément du programme', () => {
  it('motif obligatoire', async () => {
    actAs('Animateur QHSE');
    const g = await planItem('[Fourn. G]');
    expect(await reschedulePlanItem({}, form({ id: String(g.id), year: '2027', month: '2' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelPlanItem({}, form({ id: String(g.id) }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
  });

  it('[Fourn. G] en retard : novembre occupé, reporté en février 2027 puis au 10/03/2027 (première planification conservée)', async () => {
    actAs('Animateur QHSE');
    const g = await planItem('[Fourn. G]');
    const late = (await loadAuditSignals()).todo.filter((x) => x.href?.endsWith(`element=${g.id}`));
    expect(late).toEqual([expect.objectContaining({ title: '[Fourn. G] — prévu en septembre 2026, à confirmer', overdue: true })]);

    const clash = await reschedulePlanItem({}, form({ id: String(g.id), year: '2026', month: '11', reason: 'Auditeur indisponible' }));
    expect(clash.error).toContain('« [Fourn. F] · NC »');
    expect(clash.fieldErrors).toEqual({ month: 'Mois déjà occupé sur cette ligne.' });
    expect(await reschedulePlanItem({}, form({ id: String(g.id), year: '2026', month: '9', reason: 'x' }))).toMatchObject({ error: 'Choisissez une autre date ou un autre mois.' });
    expect(await reschedulePlanItem({}, form({ id: String(g.id), year: '2027', month: '2', plannedOn: '2027-03-01', reason: 'x' })))
      .toMatchObject({ fieldErrors: { plannedOn: 'La date prévue doit tomber en février 2027.' } });

    expect(await reschedulePlanItem({}, form({ id: String(g.id), year: '2027', month: '2', reason: 'Fournisseur en restructuration' }))).toEqual({ ok: true, id: String(g.id) });
    expect(await planItem('[Fourn. G]')).toMatchObject({ year: 2027, month: 2, plannedOn: null, postponedFrom: '2026-09-01', done: false });
    expect((await loadAuditSignals()).todo.some((x) => x.href?.endsWith(`element=${g.id}`))).toBe(false);
    expect(await lastLog('audit_plan_item', g.id)).toMatchObject({
      action: 'update', summary: 'Reporté en février 2027', reason: 'Fournisseur en restructuration', byId: 'clefevre',
      details: [{ field: 'Mois', from: 'septembre', to: 'février' }, { field: 'Année', from: '2026', to: '2027' }],
    });

    expect(await reschedulePlanItem({}, form({ id: String(g.id), year: '2027', month: '3', plannedOn: '2027-03-10', reason: 'Date confirmée' }))).toMatchObject({ ok: true });
    expect(await planItem('[Fourn. G]')).toMatchObject({ year: 2027, month: 3, plannedOn: '2027-03-10', postponedFrom: '2026-09-01' });
    expect(await lastLog('audit_plan_item', g.id)).toMatchObject({ summary: 'Reporté au 10/03/2027', reason: 'Date confirmée' });
    // L'année 2027 affiche l'élément ; le programme 2026 ne le porte plus.
    expect((await loadAudits({ year: '2027' })).plan.map((p) => p.label)).toContain('[Fourn. G]');
    expect((await loadAudits({ year: '2026' })).plan.map((p) => p.label)).not.toContain('[Fourn. G]');
  });

  it('refusé pour un élément réalisé et pour une échéance de revue de direction', async () => {
    actAs('Animateur QHSE');
    const production = await planItem('Production');
    expect(await reschedulePlanItem({}, form({ id: String(production.id), year: '2026', month: '7', reason: 'x' }))).toEqual({ error: 'Élément réalisé : il ne se reporte pas.' });
    const annual = await planItem('Annuelle 10/12');
    expect(await reschedulePlanItem({}, form({ id: String(annual.id), year: '2027', month: '1', reason: 'x' })))
      .toEqual({ error: "Échéance d'une revue de direction : reportez la revue depuis sa carte." });
    expect(await planItem('Annuelle 10/12')).toMatchObject({ month: 12, plannedOn: '2026-12-10' });
  });
});

describe('AUD-03 : annuler un élément du programme', () => {
  it('refusé pour l’élément porté par une action, un élément réalisé, une revue rattachée et un audit qui a des constats', async () => {
    actAs('Animateur QHSE');
    const essais = await planItem('Essais 12/10');
    expect(await cancelPlanItem({}, form({ id: String(essais.id), reason: 'x' })))
      .toEqual({ error: "Échéance portée par l'action A-181 : abandonnez-la d'abord dans le plan d'actions." });
    const production = await planItem('Production');
    expect(await cancelPlanItem({}, form({ id: String(production.id), reason: 'x' }))).toEqual({ error: 'Élément réalisé : il reste au programme.' });
    const annual = await planItem('Annuelle 10/12');
    expect(await cancelPlanItem({}, form({ id: String(annual.id), reason: 'x' }))).toEqual({ error: "Échéance d'une revue de direction : annulez la revue depuis sa carte." });
    const nc = await planItem('[Fourn. F] · NC');
    expect(await saveFinding({}, form({ planItemId: String(nc.id), kind: 'piste', text: 'Relancer le plan d’actions du fournisseur' }))).toMatchObject({ ok: true });
    expect(await cancelPlanItem({}, form({ id: String(nc.id), reason: 'x' })))
      .toEqual({ error: "Des constats ou un rapport sont rattachés à cet audit : l'audit a eu lieu, déclarez-le réalisé." });
    const db = await getDb();
    const stillActive = await db.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems)
      .where(and(eq(t.auditPlanItems.id, nc.id), eq(t.auditPlanItems.done, false)));
    expect(stillActive).toHaveLength(1);
    expect((await planItem('[Fourn. F] · NC')).cancelledAt).toBeNull();
  });

  it('« Mise en serv. » annulé : hors grille, échéances et constats, liste « Éléments annulés » ; le mois redevient libre', async () => {
    actAs('Animateur QHSE');
    const item = await planItem('Mise en serv.');
    expect((await loadAudits({ year: '2026' })).plan.find((p) => p.id === item.id)).toMatchObject({ cancellable: true, reschedulable: true });
    expect(await cancelPlanItem({}, form({ id: String(item.id), reason: 'Mise en service sous-traitée en 2026' }))).toEqual({ ok: true, id: String(item.id) });
    const after = await planItem('Mise en serv.');
    expect(after).toMatchObject({ cancelledById: 'clefevre', cancelReason: 'Mise en service sous-traitée en 2026' });
    expect(after.cancelledAt).toBeInstanceOf(Date);
    expect(await lastLog('audit_plan_item', item.id)).toMatchObject({ action: 'cancel', reason: 'Mise en service sous-traitée en 2026', byId: 'clefevre' });
    expect(await cancelPlanItem({}, form({ id: String(item.id), reason: 'x' }))).toEqual({ error: 'Élément déjà annulé.' });

    const data = await loadAudits({ year: '2026' });
    expect(data.plan.some((p) => p.id === item.id)).toBe(false);
    expect(data.cancelledPlan.map((p) => p.label)).toEqual(['Mise en serv.', 'Logistique']);
    expect(data.cancelledPlan[0]).toMatchObject({ state: 'cancelled', cancelled: { by: '[C. Lefèvre]', reason: 'Mise en service sous-traitée en 2026' }, cancellable: false });
    expect(data.auditOptions.some(([v]) => v === String(item.id))).toBe(false);
    expect((await loadAuditSignals()).todo.some((x) => x.href?.endsWith(`element=${item.id}`))).toBe(false);
    // Lien profond vers un élément annulé : ouvert en lecture (liste « Éléments annulés »).
    expect((await loadAudits({ element: String(item.id) })).openElement).toBe(item.id);
    expect(await savePlanItem({}, form({ id: String(item.id), track: 'Audits internes', label: 'Mise en serv.' }))).toEqual({ error: 'Élément annulé : il ne peut plus être modifié.' });

    // Un élément annulé libère le mois : nouvel élément accepté sur la même ligne en décembre.
    const added = await savePlanItem({}, form({ year: '2026', track: 'Audits internes', month: '12', label: 'Mise en serv. B', detail: 'Processus Mise en service' }));
    expect(added).toMatchObject({ ok: true });
    expect((await changeLog('audit_plan_item', added.id!))[0]).toMatchObject({ action: 'create' });
  });
});

describe('AUD-03 / AUD-01 : modification d’un élément existant', () => {
  it('planification ignorée (« Reporter » seulement) ; échéance de revue verrouillée', async () => {
    actAs('Animateur QHSE');
    const be = await planItem('BE · 17/10');
    expect(await savePlanItem({}, form({
      id: String(be.id), year: '2027', track: be.track, month: '3', plannedOn: '2027-03-05', label: be.label, detail: 'Processus Conception et BE', ownerId: 'edubois',
      auditor: be.auditor ?? '', scope: be.scope ?? '',
    }))).toMatchObject({ ok: true });
    expect(await planItem('BE · 17/10')).toMatchObject({ year: 2026, month: 10, plannedOn: '2026-10-17', detail: 'Processus Conception et BE', postponedFrom: '2026-09-17' });
    expect(await lastLog('audit_plan_item', be.id)).toMatchObject({ details: [{ field: 'Intitulé', from: 'Processus Conception BE', to: 'Processus Conception et BE' }] });

    const annual = await planItem('Annuelle 10/12');
    expect(await savePlanItem({}, form({ id: String(annual.id), track: annual.track, label: 'Annuelle', detail: annual.detail ?? '' })))
      .toEqual({ error: "Échéance d'une revue de direction : sa date et sa réalisation suivent la revue (carte Revue de direction)." });
    const view = (await loadAudits({ year: '2026' })).plan.find((p) => p.id === annual.id)!;
    expect(view).toMatchObject({ locked: true, reschedulable: false, cancellable: false, review: { statusLabel: 'Planifiée' } });
    expect(view.review!.href).toMatch(/^\/audits\?annee=2026&revue=\d+#revue$/);
  });

  it('jeu de démonstration : les échéances des revues du 18/06 et du 10/12 portent leur revue', async () => {
    const db = await getDb();
    const reviews = await db.select().from(t.reviews);
    const byDate = new Map(reviews.map((r) => [r.reviewOn, r.id]));
    expect((await planItem('Interm. 18/06')).reviewId).toBe(byDate.get('2026-06-18'));
    expect((await planItem('Annuelle 10/12')).reviewId).toBe(byDate.get('2026-12-10'));
  });
});
