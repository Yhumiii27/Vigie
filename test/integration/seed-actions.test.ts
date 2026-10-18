import '../next-mocks';
import { readdirSync } from 'node:fs';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema as t } from '@/db';
import { actionDateOrderErrors, isLate, missingFields } from '@/lib/action-rules';
import { parisDay } from '@/lib/dates';
import { ACTION_AVANCEMENTS } from '@/lib/domain';
import { readAttachment } from '@/lib/uploads';
import { actionCommentTitle, actionCommentWithdrawnTitle, actionConfieeTitle, actionProofTitle } from '@/server/notify';
import { DEMO_ACTIONS, RETIRED_DEMO_ACTIONS } from '@/db/seeds/actions';
import { DEMO_TODAY, freshDemoDatabase } from '../helpers';

// Jeu de démonstration du plan d'actions QSE (src/db/seeds/actions.ts, plan du paquet 1 § 1.5 amendé le 15/10/2026) :
// base neuve ouverte par getDb() (seed avec fichiers), puis jeu chargé sans fichiers (db:check).

const uploads = freshDemoDatabase();

/** Personnes de l'effectif que la charge de la page du Salarié ne doit jamais citer (test/e2e/employee-payload.test.ts). */
const OTHER_PEOPLE = ['[M. Girard]', '[P. Roux]', '[A. Martin]', '[J. Petit]', '[R. Fontaine]', '[K. Bernard]', '[Y. Lambert]'];

async function load() {
  const db = await getDb();
  const actions = await db.select().from(t.actions).orderBy(asc(t.actions.id));
  return { db, actions, byId: new Map(actions.map((a) => [a.id, a])) };
}

describe('jeu de démonstration du plan d’actions QSE (base neuve)', () => {
  it('31 actions : les dix avancements, les numéros retirés absents, compteur à 222', async () => {
    const { db, actions } = await load();
    expect(actions.map((a) => a.id).sort()).toEqual(Object.keys(DEMO_ACTIONS).sort());
    expect(actions).toHaveLength(31);
    expect(new Set(actions.map((a) => a.status))).toEqual(new Set(ACTION_AVANCEMENTS));
    for (const id of RETIRED_DEMO_ACTIONS) expect(actions.find((a) => a.id === id)).toBeUndefined();
    expect(await db.select().from(t.actionCounters)).toEqual([{ scope: 'A', last: 222 }]);
  });

  it('plus aucune action de Prévention ni d’Habilitations, ni référence aux numéros retirés', async () => {
    const { db } = await load();
    const retired = [...RETIRED_DEMO_ACTIONS] as string[];
    expect(await db.select().from(t.actions).where(isNotNull(t.actions.preventionPlanId))).toEqual([]);
    expect(await db.select().from(t.actions).where(isNotNull(t.actions.permitId))).toEqual([]);
    expect(await db.select().from(t.actions).where(isNotNull(t.actions.qualificationPersonId))).toEqual([]);
    expect(await db.select().from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), inArray(t.changeLog.entityId, retired)))).toEqual([]);
  });

  it('sources : celles de la reprise ; Environnement → Déchets ; A-150 reprise simulée (legacy_origin, entrée de reprise)', async () => {
    const { db, byId } = await load();
    expect(['A-178', 'A-218', 'A-219'].map((id) => byId.get(id)!.source)).toEqual(['dechets', 'dechets', 'dechets']);
    expect(byId.get('A-181')!.source).toBe('audit_terrain');
    expect(byId.get('A-188')!.source).toBe('audit_interne');
    expect(byId.get('A-196')!.source).toBe('veille');
    expect(byId.get('A-217')!.source).toBe('controle_reglementaire');
    expect(byId.get('A-186')!.source).toBe('reclamation_client');
    expect(['A-152', 'A-158', 'A-174', 'A-184'].map((id) => byId.get(id)!.source)).toEqual(Array(4).fill('revue_direction'));
    expect([...byId.values()].filter((a) => a.legacyOrigin).map((a) => [a.id, a.legacyOrigin])).toEqual([['A-150', 'audit']]);
    const reprise = await db.select().from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), eq(t.changeLog.action, 'reprise')));
    expect(reprise.map((l) => [l.entityId, l.summary, l.byId])).toEqual([['A-150', 'Reprise du modèle Power Apps', null]]);
  });

  it('dates cohérentes (actionDateOrderErrors vide), date d’ouverture = date de Paris de la création ; à compléter : A-150 (site) seulement', async () => {
    const { actions } = await load();
    for (const a of actions) {
      expect(actionDateOrderErrors(a), a.id).toEqual({});
      expect(a.openedOn, a.id).toBe(parisDay(a.createdAt));
      expect(a.openedOn <= DEMO_TODAY, a.id).toBe(true);
      expect(missingFields(a), a.id).toEqual(a.id === 'A-150' ? ['siteId'] : []);
    }
    expect(actions.filter((a) => !a.siteId).map((a) => a.id)).toEqual(['A-150']);
    // A-170 et A-176 : dates postérieures à leur événement dans un jeu neuf.
    const byId = new Map(actions.map((a) => [a.id, a]));
    expect(byId.get('A-170')).toMatchObject({ openedOn: '2026-09-19', dueOn: '2026-09-25', doneOn: '2026-09-24', closedOn: '2026-09-29' });
    expect(byId.get('A-176')).toMatchObject({ openedOn: '2026-09-24', dueOn: '2026-09-30', doneOn: '2026-09-28', closedOn: '2026-10-02' });
    expect(byId.get('A-174')).toMatchObject({ status: 'reportee', initialDueOn: '2026-09-30', dueOn: '2026-12-15' });
    expect(actions.filter((a) => a.id !== 'A-174').every((a) => a.initialDueOn === a.dueOn)).toBe(true);
  });

  it('en retard au 09/10 : A-205, A-209, A-198, A-203, A-201', async () => {
    const { actions } = await load();
    expect(actions.filter((a) => isLate(a, DEMO_TODAY)).map((a) => a.id).sort()).toEqual(['A-198', 'A-201', 'A-203', 'A-205', 'A-209']);
  });

  it('vérifications et actions de suite : A-221 (A-170 non efficace, sans événement), A-222 (nouveau risque de A-176)', async () => {
    const { byId } = await load();
    for (const id of ['A-176', 'A-170', 'A-165', 'A-150', 'A-152', 'A-158']) {
      const a = byId.get(id)!;
      expect(a.status, id).toBe('verifiee');
      expect(a.closedOn && a.verifyMethod && a.efficacyNote && a.verifiedById && a.effective !== null, id).toBeTruthy();
    }
    expect(byId.get('A-170')).toMatchObject({ effective: false });
    expect(byId.get('A-176')).toMatchObject({ effective: true, newRisk: true });
    expect(byId.get('A-221')).toMatchObject({ followsActionId: 'A-170', followReason: 'non_efficace', eventId: null, originRef: 'EV-2026-124', source: 'evenement', pilotId: 'sbenali' });
    expect(byId.get('A-221')!.problem).toMatch(/^Action A-170 jugée non efficace le 29\/09\/2026 : /);
    expect(byId.get('A-222')).toMatchObject({ followsActionId: 'A-176', followReason: 'nouveau_risque', eventId: 'EV-2026-126', pilotId: 'rfontaine' });
    // Une action de suite naît à la vérification qui la décide, jamais avant (journal de l'action précédente).
    const db0 = await getDb();
    for (const [next, prev] of [['A-221', 'A-170'], ['A-222', 'A-176']]) {
      const [verified] = await db0.select().from(t.changeLog)
        .where(and(eq(t.changeLog.entityId, prev), eq(t.changeLog.action, 'status'), eq(t.changeLog.summary, prev === 'A-170' ? 'Vérifiée : non efficace' : 'Vérifiée : efficace')));
      const [followUp] = await db0.select().from(t.changeLog).where(and(eq(t.changeLog.entityId, prev), eq(t.changeLog.action, 'follow_up')));
      const [created] = await db0.select().from(t.changeLog).where(and(eq(t.changeLog.entityId, next), eq(t.changeLog.action, 'create')));
      expect(byId.get(next)!.createdAt.getTime(), next).toBeGreaterThanOrEqual(verified.at.getTime());
      expect(created.at.getTime(), next).toBeGreaterThanOrEqual(verified.at.getTime());
      expect(followUp.at.getTime(), next).toBeGreaterThanOrEqual(verified.at.getTime());
      expect(parisDay(byId.get(next)!.createdAt)).toBe(byId.get(prev)!.closedOn);
    }
    // Lien à plusieurs porteurs repris par la suite (D21) : le risque du DUERP de A-176 porte aussi A-222.
    const riskOf = async (id: string) => (await db0.select().from(t.riskActions).where(eq(t.riskActions.actionId, id))).map((r) => r.riskId);
    expect(await riskOf('A-222')).toEqual(await riskOf('A-176'));
    expect(await riskOf('A-222')).toHaveLength(1);
    // Lignes à plusieurs éléments conservées (D22).
    expect(byId.get('A-212')!.eventId).toBe('EV-2026-130');
    const db = await getDb();
    const findings = await db.select({ actionId: t.auditFindings.actionId }).from(t.auditFindings).where(inArray(t.auditFindings.actionId, ['A-212', 'A-205']));
    expect(findings.map((f) => f.actionId).sort()).toEqual(['A-205', 'A-212']);
  });

  it('fil : commentaires datés et signés, un commentaire retiré (texte conservé en base) avec sa preuve', async () => {
    const db = await getDb();
    const comments = await db.select().from(t.actionComments).orderBy(asc(t.actionComments.id));
    expect(comments.length).toBeGreaterThanOrEqual(5);
    expect(new Set(comments.map((c) => c.actionId))).toEqual(new Set(['A-214', 'A-215', 'A-190', 'A-174', 'A-209']));
    for (const c of comments) expect(parisDay(c.createdAt) <= DEMO_TODAY, String(c.id)).toBe(true);
    // Rôle signé : celui de la démonstration ; aucun pour [L. Moreau] et [J. Petit] (sans rôle de démonstration).
    expect(Object.fromEntries(comments.map((c) => [c.authorId, c.authorRole]))).toEqual({
      sbenali: 'Chef de service', clefevre: 'Animateur QHSE', tnguyen: 'Salarié', lmoreau: null, jpetit: null,
    });
    const withdrawn = comments.filter((c) => c.withdrawnAt);
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({ actionId: 'A-209', body: 'Relevé des flexibles joint.', withdrawnById: 'jpetit' });
    expect(withdrawn[0].withdrawReason).toBeTruthy();
    const [proof] = await db.select().from(t.attachments).where(eq(t.attachments.commentId, withdrawn[0].id));
    expect(proof).toMatchObject({ entityType: 'action', entityId: 'A-209', uploadedBy: 'jpetit' });
    // Report de A-174 : le motif du journal est le commentaire.
    const [report] = await db.select().from(t.changeLog).where(and(eq(t.changeLog.entityId, 'A-174'), eq(t.changeLog.summary, 'Reportée')));
    expect(report.reason).toBe(comments.find((c) => c.actionId === 'A-174')!.body);
  });

  it('preuves (jeu ouvert par getDb : fichiers écrits) : A-215 avec le commentaire de son responsable, A-214, A-190, A-209', async () => {
    const db = await getDb();
    const proofs = await db.select().from(t.attachments).where(eq(t.attachments.entityType, 'action')).orderBy(asc(t.attachments.entityId));
    expect(proofs.map((p) => [p.entityId, p.uploadedBy]).sort()).toEqual([['A-190', 'lmoreau'], ['A-209', 'jpetit'], ['A-214', 'sbenali'], ['A-215', 'tnguyen']]);
    const a215 = proofs.find((p) => p.entityId === 'A-215')!;
    const [comment] = await db.select().from(t.actionComments).where(eq(t.actionComments.id, a215.commentId!));
    expect(comment).toMatchObject({ actionId: 'A-215', authorId: 'tnguyen', authorRole: 'Salarié' });
    expect(proofs.filter((p) => p.entityId === 'A-214' || p.entityId === 'A-190').every((p) => p.commentId === null)).toBe(true);
    for (const p of proofs) {
      expect(parisDay(p.createdAt) <= DEMO_TODAY).toBe(true);
      const file = await readAttachment(p.id);
      expect(file?.data.subarray(0, 8).toString()).toBe('%PDF-1.4');
    }
    expect(readdirSync(uploads)).toHaveLength(proofs.length);
    const attach = await db.select().from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), eq(t.changeLog.action, 'attach')));
    expect(attach).toHaveLength(4);
  });

  it('A-215 : seule action de [T. Nguyen] ; rien ne cite un autre numéro d’action ni une autre personne de l’effectif', async () => {
    const { db, actions } = await load();
    expect(actions.filter((a) => a.pilotId === 'tnguyen').map((a) => a.id)).toEqual(['A-215']);
    const a = actions.find((x) => x.id === 'A-215')!;
    const comments = await db.select().from(t.actionComments).where(eq(t.actionComments.actionId, 'A-215'));
    const journal = await db.select().from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), eq(t.changeLog.entityId, 'A-215')));
    const proofs = await db.select().from(t.attachments).where(and(eq(t.attachments.entityType, 'action'), eq(t.attachments.entityId, 'A-215')));
    const notifications = await db.select().from(t.notifications).where(and(eq(t.notifications.entityId, 'A-215'), eq(t.notifications.personId, 'tnguyen')));
    const texts = [
      a.detail, a.problem, a.originRef, ...comments.map((c) => c.body),
      ...journal.flatMap((l) => [l.summary, l.reason, JSON.stringify(l.details)]),
      ...proofs.map((p) => p.fileName), ...notifications.map((n) => n.title),
    ].filter((s): s is string => !!s);
    expect(comments).toHaveLength(2);
    expect(journal.length).toBeGreaterThanOrEqual(3);
    for (const s of texts) {
      expect(s.replace(/\bA-215\b/g, ''), s).not.toMatch(/\bA-\d{3}\b/);
      for (const name of OTHER_PEOPLE) expect(s, s).not.toContain(name);
    }
  });

  it('notifications datées (≤ 09/10) : action confiée (A-215, A-221, A-222) ; commentaires et preuves des responsables hors QHSE pour l’animatrice QHSE (ACT-31)', async () => {
    const db = await getDb();
    const rows = await db.select().from(t.notifications).orderBy(asc(t.notifications.id));
    expect(rows.map((n) => [n.personId, n.type, n.entityId, n.byId, n.readAt === null ? 'non lue' : 'lue'])).toEqual([
      ['clefevre', 'action_commentaire', 'A-190', 'lmoreau', 'lue'],
      ['clefevre', 'action_preuve', 'A-190', 'lmoreau', 'lue'],
      ['sbenali', 'action_confiee', 'A-221', 'clefevre', 'non lue'],
      ['rfontaine', 'action_confiee', 'A-222', 'clefevre', 'lue'],
      ['tnguyen', 'action_confiee', 'A-215', 'clefevre', 'non lue'],
      ['clefevre', 'action_commentaire', 'A-214', 'sbenali', 'lue'],
      ['clefevre', 'action_preuve', 'A-214', 'sbenali', 'lue'],
      ['clefevre', 'action_commentaire', 'A-209', 'jpetit', 'lue'],
      ['clefevre', 'action_commentaire', 'A-209', 'jpetit', 'lue'],
      ['clefevre', 'action_commentaire', 'A-215', 'tnguyen', 'non lue'],
    ]);
    for (const n of rows) {
      expect(n.href).toBe(`/actions?action=${n.entityId}`);
      expect(parisDay(n.createdAt) <= DEMO_TODAY).toBe(true);
      if (n.readAt) expect(parisDay(n.readAt) <= DEMO_TODAY && n.readAt >= n.createdAt).toBe(true);
    }
    const title = (type: string, id: string) => rows.filter((n) => n.type === type && n.entityId === id).map((n) => n.title);
    expect(title('action_confiee', 'A-215')).toEqual([actionConfieeTitle('A-215', '[C. Lefèvre]', 'Rédiger le mode opératoire de retournement des bâtis > 1 t')]);
    expect(parisDay(rows.find((n) => n.type === 'action_confiee' && n.entityId === 'A-215')!.createdAt)).toBe('2026-10-03');
    const comments = await db.select().from(t.actionComments).orderBy(asc(t.actionComments.id));
    // Notification d'un commentaire : même date, lien vers le commentaire, titre de actionCommentTitle (preuves nommées).
    for (const n of rows.filter((x) => x.type === 'action_commentaire')) {
      const c = comments.find((x) => x.id === n.commentId)!;
      expect({ action: c.actionId, author: c.authorId, at: c.createdAt.getTime() }).toEqual({ action: n.entityId, author: n.byId, at: n.createdAt.getTime() });
    }
    const a215 = comments.find((c) => c.actionId === 'A-215' && c.authorId === 'tnguyen')!;
    expect(title('action_commentaire', 'A-215')).toEqual([actionCommentTitle('A-215', '[T. Nguyen]', a215.body, ['mode-operatoire-retournement-v0.pdf'])]);
    // Commentaire retiré (D23) : titre sans extrait ; l'autre commentaire de A-209 garde le sien.
    const withdrawn = comments.find((c) => c.withdrawnAt)!;
    const a209 = rows.filter((n) => n.entityId === 'A-209');
    expect(a209.find((n) => n.commentId === withdrawn.id)!.title).toBe(actionCommentWithdrawnTitle('A-209', '[J. Petit]'));
    expect(rows.some((n) => n.title.includes(withdrawn.body))).toBe(false);
    expect(a209.find((n) => n.commentId !== withdrawn.id)!.title).toMatch(/^A-209 : commentaire de \[J\. Petit\] — Flexible remplacé le 05\/10/);
    expect(title('action_preuve', 'A-214')).toEqual([actionProofTitle('A-214', '[S. Benali]', 'bon-de-commande-elingues.pdf')]);
    // Commentaires de l'animatrice QHSE : jamais notifiés.
    expect(rows.filter((n) => n.byId === 'clefevre').every((n) => n.type === 'action_confiee')).toBe(true);
  });

  it('journal : création, avancements structurés (fromKey / toKey), abandon de A-180 en « status », jamais « cancel »', async () => {
    const db = await getDb();
    const journal = await db.select().from(t.changeLog).where(eq(t.changeLog.entityType, 'action')).orderBy(asc(t.changeLog.id));
    for (const l of journal) expect(parisDay(l.at) <= DEMO_TODAY, `${l.entityId} ${l.summary}`).toBe(true);
    expect(journal.filter((l) => l.action === 'cancel')).toEqual([]);
    const statuses = journal.filter((l) => l.action === 'status');
    for (const l of statuses) {
      const [first] = l.details as { field: string; fromKey?: string; toKey?: string }[];
      expect(first.field).toBe('Avancement');
      expect(ACTION_AVANCEMENTS).toContain(first.fromKey);
      expect(ACTION_AVANCEMENTS).toContain(first.toKey);
    }
    const abandon = statuses.find((l) => l.entityId === 'A-180')!;
    expect(abandon).toMatchObject({ summary: 'Abandonnée', byId: 'clefevre' });
    expect(abandon.reason).toMatch(/^Doublon de A-201/);
    const a190 = journal.filter((l) => l.entityId === 'A-190' && l.action === 'status');
    expect(a190.map((l) => l.summary)).toEqual(['Terminée le 20/09/2026']);
    expect(journal.filter((l) => l.action === 'follow_up').map((l) => [l.entityId, l.summary])).toEqual([
      ['A-170', 'Action de suite A-221 créée (non efficace)'],
      ['A-176', 'Action de suite A-222 créée (nouveau risque)'],
    ]);
    const created = new Set(journal.filter((l) => l.action === 'create').map((l) => l.entityId));
    expect(created).toEqual(new Set(Object.keys(DEMO_ACTIONS).filter((id) => id !== 'A-150')));
  });
});

describe('jeu de démonstration chargé sans fichiers (db:check)', () => {
  it('aucune preuve ni entrée « preuve ajoutée », le reste du jeu identique', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const { MIGRATIONS_DIR } = await import('@/db/migrations');
    const { seed } = await import('@/db/seed');
    const before = readdirSync(uploads).length;
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema: t });
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      await seed(db as unknown as Parameters<typeof seed>[0]);
      expect(await db.select().from(t.attachments).where(eq(t.attachments.entityType, 'action'))).toEqual([]);
      expect(await db.select().from(t.changeLog).where(eq(t.changeLog.action, 'attach'))).toEqual([]);
      expect(await db.select().from(t.actions)).toHaveLength(31);
      expect((await db.select().from(t.actionComments)).length).toBeGreaterThanOrEqual(5);
      expect(await db.select().from(t.actionCounters)).toEqual([{ scope: 'A', last: 222 }]);
      // Notifications sans les preuves : ni « Preuve ajoutée », ni fichier nommé dans le titre d'un commentaire.
      const notifications = await db.select().from(t.notifications);
      expect(notifications).toHaveLength(8);
      expect(notifications.filter((n) => n.type === 'action_preuve' || n.title.includes('.pdf'))).toEqual([]);
    } finally {
      await client.close();
    }
    expect(readdirSync(uploads)).toHaveLength(before);
  });
});
