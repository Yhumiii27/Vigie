import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadDashboard } from '@/lib/data/dashboard';
import { loadDocuments } from '@/lib/data/documents';
import { loadEnvironment, wasteEntryYear } from '@/lib/data/environment';
import { loadMyContributions, loadReviewCard, loadReviewSignals } from '@/lib/data/review';
import { loadRisks } from '@/lib/data/risks';
import { loadCoactivitySignals, loadSitemap } from '@/lib/data/sitemap';
import { loadWatch } from '@/lib/data/watch';
import { canReadAttachment } from '@/lib/uploads';
import { addEntityFiles, removeEntityFile } from '@/server/entity-files';
import { deleteReviewItem } from '@/server/review';
import { controlConflict, releaseConflictControl } from '@/server/sitemap';
import { saveRequirement } from '@/server/watch';

// Paquet 6 — fonctions des modules : pièces jointes génériques (DUE-09, VEI-08, AUD-17, DOC-11 : droits, site, fiche
// figée, motif, journal, lecture par /fichiers), coactivité maîtrisée (PRV-10), rattachement explicite des exigences
// (VEI-07), événements liés (EVT-14), échéances de la revue (AUD-16), liens profonds (DOC-08) et liens filtrés du tableau
// de bord (TDB-12). Jeu de démonstration au 09/10/2026, pièces de démonstration écrites (src/db/seeds/modules.ts).

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const db = () => getDb();
const add = (kind: string, entityId: string | number, name = 'piece.pdf') => addEntityFiles(formWith({ kind, entityId: String(entityId) }, { files: [file(name)] }));
const filesOf = async (kind: string, entityId: string | number) => (await db()).select().from(t.attachments)
  .where(and(eq(t.attachments.entityType, kind), eq(t.attachments.entityId, String(entityId)))).orderBy(asc(t.attachments.createdAt));

describe('pièces jointes génériques', () => {
  it('justificatif d’un risque : droits, site, motif, journal ; lisible par le Salarié (DUERP)', async () => {
    const [risk] = await (await db()).select({ id: t.risks.id }).from(t.risks).where(eq(t.risks.unitId, 'essais'));
    actAs('Salarié');
    expect(await add('risk', risk.id)).toEqual({ error: DENIED });
    actAs('Chef de projet');
    expect(await add('risk', risk.id)).toEqual({ error: DENIED });
    // Unité de la zone d'essais : site de [Ville B].
    actAs('Chef de service', 'ville-a');
    expect(await add('risk', risk.id)).toEqual({ error: expect.stringContaining('autre site') });
    actAs('Chef de service', 'ville-b');
    expect(await add('risk', risk.id, 'mesurage.pdf')).toEqual({ count: 1 });
    expect(await lastLog('risk', risk.id)).toMatchObject({ action: 'attach', details: [{ field: 'Justificatif', from: null, to: 'mesurage.pdf' }] });
    const [att] = await filesOf('risk', risk.id);
    expect(await canReadAttachment(att, { role: 'Salarié', user: { id: 'tnguyen' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(att, { role: 'Salarié', user: { id: 'tnguyen' }, allowedSiteIds: ['ville-a'] })).toBe(false);
    actAs('Salarié');
    expect(await removeEntityFile(att.id, 'erreur')).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-b');
    expect(await removeEntityFile(att.id, '  ')).toEqual({ error: 'Motif obligatoire.' });
    expect(await removeEntityFile(att.id, 'Mauvais poste mesuré')).toEqual({});
    expect(await lastLog('risk', risk.id)).toMatchObject({ action: 'detach', reason: 'Mauvais poste mesuré', details: [{ field: 'Justificatif', from: 'mesurage.pdf', to: null }] });
    expect(await filesOf('risk', risk.id)).toEqual([]);
    expect(await removeEntityFile(att.id, 'deux fois')).toEqual({ error: 'Pièce jointe introuvable.' });
  });

  it('DUERP signé : version en vigueur (animateur QHSE, direction), figé une fois la version archivée ; chargé pour tous', async () => {
    const versions = await (await db()).select().from(t.duerpVersions);
    const current = versions.find((v) => v.current)!;
    const archived = versions.find((v) => !v.current)!;
    actAs('Chef de service');
    expect(await add('duerp_version', current.version)).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Direction', 'all');
    expect(await add('duerp_version', archived.version)).toEqual({ error: `Version ${archived.version} archivée : ses pièces sont figées.` });
    expect(await add('duerp_version', current.version, 'duerp-signe.pdf')).toEqual({ count: 1 });
    expect(await lastLog('duerp_version', current.version)).toMatchObject({ action: 'attach' });
    actAs('Salarié');
    const { versions: views } = await loadRisks();
    // Pièce de démonstration et pièce ajoutée.
    expect(views.find((v) => v.current)?.files.map((f) => f.name)).toEqual(expect.arrayContaining(['duerp-signe.pdf', `DUERP-${current.version}-signe.pdf`]));
  });

  it('veille (VEI-08) : preuve d’évaluation et rapport de contrôle ajoutés après coup ; enregistrement annulé figé', async () => {
    const [ev] = await (await db()).select().from(t.requirementEvaluations).limit(1);
    actAs('Chef de service', 'all');
    expect(await add('requirement_evaluation', ev.id, 'preuve.pdf')).toEqual({ count: 1 });
    expect(await lastLog('requirement', ev.requirementId)).toMatchObject({ action: 'attach', summary: expect.stringContaining('évaluation du') });
    const [record] = await (await db()).select().from(t.controlRecords).where(isNull(t.controlRecords.cancelledAt)).limit(1);
    const [control] = await (await db()).select().from(t.controls).where(eq(t.controls.id, record.controlId));
    actAs('Chef de service', control.siteId ?? 'all');
    expect(await add('control_record', record.id, 'rapport-vgp.pdf')).toEqual({ count: 1 });
    expect(await lastLog('control', control.id)).toMatchObject({ action: 'attach', details: [{ field: 'Rapport de contrôle', to: 'rapport-vgp.pdf' }] });
    const [att] = await filesOf('control_record', record.id);
    await (await db()).update(t.controlRecords).set({ cancelledAt: new Date(), cancelReason: 'Saisie en double' }).where(eq(t.controlRecords.id, record.id));
    expect(await add('control_record', record.id)).toEqual({ error: 'Enregistrement annulé : ses pièces jointes sont conservées pour la trace.' });
    expect(await removeEntityFile(att.id, 'erreur')).toEqual({ error: 'Enregistrement annulé : ses pièces jointes sont conservées pour la trace.' });
    await (await db()).update(t.controlRecords).set({ cancelledAt: null, cancelReason: null }).where(eq(t.controlRecords.id, record.id));
    // Chargement : pièces jointes de l'enregistrement, avec leur auteur.
    const c = (await loadWatch()).controls.find((x) => x.id === control.id);
    expect(c?.records.find((r) => r.id === record.id)?.files).toEqual([expect.objectContaining({ name: 'rapport-vgp.pdf', uploadedBy: expect.any(String) })]);
  });

  it('revue de direction (AUD-17) : pièces de la revue et du contributeur, figées à la clôture', async () => {
    const reviews = await (await db()).select().from(t.reviews);
    const closed = reviews.find((r) => r.status === 'cloturee')!;
    const planned = reviews.find((r) => r.status === 'planifiee')!;
    const items = await (await db()).select().from(t.reviewItems).where(eq(t.reviewItems.reviewId, planned.id));
    const mine = items.find((i) => i.ownerId === 'edubois')!;
    const other = items.find((i) => i.ownerId && i.ownerId !== 'edubois')!;
    actAs('Chef de projet', 'all');
    expect(await add('review', planned.id)).toEqual({ error: DENIED });
    expect(await add('review_item', other.id)).toEqual({ error: DENIED });
    expect(await add('review_item', mine.id, 'contribution.pdf')).toEqual({ count: 1 });
    expect(await lastLog('review', planned.id)).toMatchObject({ action: 'attach', summary: expect.stringContaining(mine.label) });
    const own = (await filesOf('review_item', mine.id)).find((f) => f.fileName === 'contribution.pdf')!;
    expect(await canReadAttachment(own, { role: 'Salarié', user: { id: 'edubois' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(own, { role: 'Salarié', user: { id: 'tnguyen' }, allowedSiteIds: null })).toBe(false);
    expect((await loadMyContributions({})).reviews.find((r) => r.id === planned.id)?.myItems.find((i) => i.id === mine.id)?.files.map((f) => f.name))
      .toContain('contribution.pdf');
    actAs('Animateur QHSE', 'all');
    expect(await add('review_item', mine.id, 'complement.pdf')).toEqual({ count: 1 });
    const qhseFile = (await filesOf('review_item', mine.id)).find((f) => f.fileName === 'complement.pdf')!;
    actAs('Chef de projet', 'all');
    expect(await removeEntityFile(qhseFile.id, 'doublon')).toEqual({ error: 'Seul le service QHSE ou la personne qui a joint ce fichier peut le retirer.' });
    expect(await removeEntityFile(own.id, 'Version provisoire')).toEqual({});
    // Élément portant des pièces : pas de suppression de la check-list.
    actAs('Animateur QHSE', 'all');
    expect(await deleteReviewItem(mine.id)).toEqual({ error: expect.stringContaining('pièces jointes') });
    // Revue clôturée : figée.
    expect(await add('review', closed.id)).toEqual({ error: 'Revue clôturée : dossier figé au visa, pièces jointes comprises.' });
    expect(await add('review', planned.id, 'presentation.pdf')).toEqual({ count: 1 });
    expect((await loadReviewCard({ revue: String(planned.id) })).reviewFiles.map((f) => f.name)).toContain('presentation.pdf');
  });

  it('enlèvement (DOC-11) : environnement seulement, site, enlèvement annulé figé', async () => {
    const entries = await (await db()).select().from(t.wasteEntries);
    const live = entries.find((e) => !e.cancelledAt && e.siteId === 'ville-a')!;
    const cancelled = entries.find((e) => e.cancelledAt)!;
    actAs('Chef de service', 'ville-a');
    expect(await add('waste_entry', live.id)).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-b');
    expect(await add('waste_entry', live.id)).toEqual({ error: expect.stringContaining('autre site') });
    actAs('Animateur QHSE', 'ville-a');
    expect(await add('waste_entry', cancelled.id)).toEqual({ error: 'Enlèvement annulé : ses pièces sont conservées pour la trace.' });
    expect(await add('waste_entry', live.id, 'bsd.pdf')).toEqual({ count: 1 });
    expect(await lastLog('waste_entry', live.id)).toMatchObject({ action: 'attach', details: [{ field: "Pièce de l'enlèvement", to: 'bsd.pdf' }] });
    const [att] = await filesOf('waste_entry', live.id);
    expect(await canReadAttachment(att, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(false);
    expect(await canReadAttachment(att, { role: 'Animateur QHSE', user: { id: 'clefevre' }, allowedSiteIds: ['ville-b'] })).toBe(false);
    const year = +live.removedOn.slice(0, 4);
    expect((await loadEnvironment(year)).entries.find((e) => e.id === live.id)?.files.map((f) => f.name)).toContain('bsd.pdf');
  });

  it('type inconnu ou pièce d’un autre type refusés', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await addEntityFiles(formWith({ kind: 'event', entityId: 'EV-2026-119' }, { files: [file()] }))).toEqual({ error: 'Fiche introuvable.' });
    const [proof] = await (await db()).select().from(t.attachments).where(eq(t.attachments.entityType, 'action')).limit(1);
    expect(await removeEntityFile(proof.id, 'motif')).toEqual({ error: 'Pièce jointe introuvable.' });
  });
});

describe('coactivité maîtrisée (PRV-10)', () => {
  it('maîtrise motivée, plus signalée, sans doublon ; levée avec motif ; journal de la carte', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = await loadSitemap({});
    // Démonstration : une situation déjà maîtrisée (voie de livraison).
    expect(before.controls).toHaveLength(1);
    const signaled = before.conflictsToday.filter((c) => !before.controls.some((x) => x.key === c.key));
    const target = signaled[0];
    const fields = { siteId: 'ville-a', date: target.date, key: target.key, measure: 'Zone balisée, horaires décalés' };
    actAs('Salarié');
    expect(await controlConflict({}, form(fields))).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-b');
    expect(await controlConflict({}, form(fields))).toEqual({ error: expect.stringContaining('autre site') });
    actAs('Chef de service', 'ville-a');
    expect(await controlConflict({}, form({ ...fields, measure: '' }))).toMatchObject({ fieldErrors: { measure: 'Champ obligatoire.' } });
    expect(await controlConflict({}, form({ ...fields, key: '9999-99999' }))).toEqual({ error: expect.stringContaining("n'est plus détectée") });
    const badgeBefore = (await loadCoactivitySignals()).badge;
    expect(await controlConflict({}, form(fields))).toMatchObject({ ok: true });
    expect(await controlConflict({}, form(fields))).toEqual({ error: 'Cette situation est déjà marquée maîtrisée.' });
    expect(await lastLog('site_map', 'ville-a')).toMatchObject({ action: 'control', byId: 'sbenali', details: expect.arrayContaining([{ field: 'Mesure prise', from: null, to: fields.measure }]) });
    expect((await loadCoactivitySignals()).badge).toBe(badgeBefore - 1);
    const after = await loadSitemap({});
    const ctl = after.controls.find((c) => c.key === target.key)!;
    expect(ctl).toMatchObject({ measure: fields.measure, by: '[S. Benali]' });
    expect(await releaseConflictControl({}, form({ id: String(ctl.id), reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await releaseConflictControl({}, form({ id: String(ctl.id), reason: 'Balisage retiré' }))).toMatchObject({ ok: true });
    expect(await lastLog('site_map', 'ville-a')).toMatchObject({ action: 'release', reason: 'Balisage retiré' });
    expect((await loadCoactivitySignals()).badge).toBe(badgeBefore);
    // Levée conservée (jamais supprimée) ; une nouvelle maîtrise est possible.
    expect((await (await db()).select().from(t.coactivityControls).where(eq(t.coactivityControls.id, ctl.id)))[0]).toMatchObject({ cancelReason: 'Balisage retiré' });
    expect(await releaseConflictControl({}, form({ id: String(ctl.id), reason: 'encore' }))).toEqual({ error: 'Cette maîtrise est déjà levée.' });
    expect(await controlConflict({}, form(fields))).toMatchObject({ ok: true });
  });
});

describe('rattachement explicite des exigences (VEI-07)', () => {
  it('reprise du jeu : DUERP, plans de prévention, bordereaux ; indicateur choisi, unique, journalisé', async () => {
    const reqs = await (await db()).select().from(t.requirements);
    const linked = Object.fromEntries(reqs.filter((r) => r.linkedTo).map((r) => [r.linkedTo, r.text]));
    expect(linked).toMatchObject({ duerp: expect.stringContaining('R. 4121-1'), prevention: expect.stringContaining('R. 4512-6'), waste_bsd: expect.stringContaining('R. 541-45') });
    actAs('Animateur QHSE', 'all');
    // L'indicateur R. 4512-6 suit le rattachement, plus le domaine.
    const pp = reqs.find((r) => r.linkedTo === 'prevention')!;
    expect((await loadWatch()).requirements.find((r) => r.id === pp.id)?.indicator).not.toBeNull();
    const atex = reqs.find((r) => r.text.startsWith('Directive ATEX'))!;
    const fd = (linkedTo: string) => form({
      id: String(atex.id), text: atex.text, domain: atex.domain, summary: atex.summary, dueOn: atex.dueOn ?? '', dueNote: atex.dueNote ?? '',
      evaluation: atex.evaluation, evaluationNote: atex.evaluationNote ?? '', pilotId: atex.pilotId ?? '', linkedToField: '1', linkedTo,
    });
    expect(await saveRequirement({}, fd('inconnu'))).toMatchObject({ fieldErrors: { linkedTo: 'Valeur non autorisée.' } });
    expect(await saveRequirement({}, fd('duerp'))).toMatchObject({ fieldErrors: { linkedTo: expect.stringContaining('déjà rattaché') } });
    expect(await saveRequirement({}, fd('waste_register'))).toEqual({ ok: true, id: String(atex.id) });
    expect(await lastLog('requirement', atex.id)).toMatchObject({ details: expect.arrayContaining([expect.objectContaining({ field: 'Indicateur rattaché', from: null, to: 'Registre des déchets (R. 541-43)' })]) });
    expect((await loadEnvironment()).requirements.map((r) => r.id)).toContain(atex.id);
    expect(await saveRequirement({}, fd(''))).toEqual({ ok: true, id: String(atex.id) });
    expect((await (await db()).select().from(t.requirements).where(eq(t.requirements.id, atex.id)))[0].linkedTo).toBeNull();
  });
});

describe('événements liés (EVT-14)', () => {
  it('contrôle : périmètre, maladie professionnelle réservée aux rôles habilités', async () => {
    const [ev] = await (await db()).select().from(t.events).where(eq(t.events.id, 'EV-2026-131'));
    await (await db()).update(t.events).set({ controlId: ev.controlId }).where(eq(t.events.id, 'EV-2026-134'));
    actAs('Chef de service', 'all');
    const ids = (await loadWatch()).controls.find((c) => c.id === ev.controlId)?.events.map((e) => e.id);
    expect(ids).toContain('EV-2026-131');
    expect(ids).not.toContain('EV-2026-134');
    actAs('Animateur QHSE', 'all');
    const qhse = (await loadWatch()).controls.find((c) => c.id === ev.controlId)?.events ?? [];
    expect(qhse.map((e) => e.id)).toContain('EV-2026-134');
    // Aucune donnée de santé chargée : référence, type, intitulé, date et étape seulement.
    expect(Object.keys(qhse[0]).sort()).toEqual(['closed', 'href', 'id', 'occurredOn', 'step', 'title', 'tone', 'type', 'typeLabel']);
    await (await db()).update(t.events).set({ controlId: null }).where(eq(t.events.id, 'EV-2026-134'));
  });
  it('document : événements et actions clôturées pour les rédacteurs ; rien en consultation', async () => {
    actAs('Animateur QHSE', 'all');
    const doc = (await loadDocuments()).rows.find((d) => d.id === 'IT-MON-012');
    expect(doc?.events.map((e) => e.id)).toContain('EV-2026-131');
    expect(doc?.closedActions.every((a) => !a.open)).toBe(true);
    actAs('Chef de service', 'all');
    const readers = (await loadDocuments({ readOnly: true })).rows;
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.every((d) => !d.events.length && !d.closedActions.length)).toBe(true);
  });
});

describe('échéances de la revue (AUD-16)', () => {
  it('décision sans suite à son échéance ; prochaine revue non planifiée', async () => {
    actAs('Animateur QHSE', 'all');
    const todo = (await loadReviewSignals()).todo;
    const gap = todo.find((x) => x.key?.startsWith('revue-decision|') && x.title.includes('Recruter un technicien'));
    expect(gap).toMatchObject({ tone: 'danger', overdue: true, siteId: null, dueOn: '2026-06-30', ownerIds: expect.arrayContaining(['hmarchand']) });
    expect(gap?.title).toContain('aucune action au plan');
    // Revue annuelle planifiée le 10/12/2026 : aucune alerte « prochaine revue ».
    expect(todo.some((x) => x.key?.startsWith('revue-prochaine|'))).toBe(false);
    const [planned] = await (await db()).select().from(t.reviews).where(eq(t.reviews.status, 'planifiee'));
    await (await db()).update(t.reviews).set({ status: 'annulee', cancelledAt: new Date(), cancelReason: 'Revue reportée' }).where(eq(t.reviews.id, planned.id));
    try {
      actAs('Direction', 'all');
      const next = (await loadReviewSignals()).todo.find((x) => x.key?.startsWith('revue-prochaine|'));
      expect(next).toMatchObject({ tone: 'warn', siteId: null, dueOn: '2026-06-18', title: expect.stringContaining('à planifier') });
    } finally {
      await (await db()).update(t.reviews).set({ status: 'planifiee', cancelledAt: null, cancelReason: null }).where(eq(t.reviews.id, planned.id));
    }
  });
});

describe('liens profonds et liens filtrés', () => {
  it('enlèvement : année retrouvée dans le site sélectionné seulement (DOC-08)', async () => {
    const [entry] = await (await db()).select().from(t.wasteEntries).where(eq(t.wasteEntries.siteId, 'ville-a')).limit(1);
    actAs('Animateur QHSE', 'ville-a');
    expect(await wasteEntryYear(entry.id)).toBe(+entry.removedOn.slice(0, 4));
    actAs('Animateur QHSE', 'ville-b');
    expect(await wasteEntryYear(entry.id)).toBeNull();
  });
  it('tableau de bord (TDB-12) : blessure dans les liens des seuls rôles habilités, ancienneté > 30 j', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const qhse = await loadDashboard();
    expect(qhse.pyramid[0].href).toMatch(/^\/evenements\?etat=tous&type=AT&effectif=1&blessure=arret&du=\d{4}-\d{2}-\d{2}$/);
    expect(qhse.kpis.find((k) => k.label === 'Événements ouverts')?.subHref).toBe('/evenements?anciennete=30');
    actAs('Chef de service', 'ville-a');
    const manager = await loadDashboard();
    expect(manager.pyramid.slice(0, 3).every((p) => p.href && !p.href.includes('blessure'))).toBe(true);
    expect(manager.kpis[0].href).toBe('/evenements?etat=tous&type=AT&effectif=1');
  });
});
