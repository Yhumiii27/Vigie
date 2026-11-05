# Modifications techniques — demandes (ECR) et ordres (ECO) de modification (D12, lot 5 de M-02)

État : développé le 05/11/2026 (migration `0029_convergence_m02_ecr_eco`), décision CV-06 du responsable produit
(« lance le lot 5 », même jour) : **le module ECR / ECO est construit dans Vigie**, écran « Modifications techniques »,
adresse `/modifications-techniques` ; la « gestion des changements » MC-n (`change_requests`, CNF-11, carte de l'écran
Audits `?changement=`) reste inchangée. Les choix marqués « par défaut » sont à confirmer (tableau « Convergence M-02, lot 5 »
du § 19 de `docs/RESTE-A-FAIRE.md`).

## 1. Objet

D12 de Matrix (option A) : Vigie numérote, instruit, approuve et libère les demandes et les ordres de modification, qu'ils
viennent de Codex, de Keystone ou de Vigie. Codex (`change_requests`) et Keystone (`vigie_ecos`) gardent des miroirs remplis
par lecture des publications de Matrix. Sources : spécification `infra/postgres/partage/60-vigie-ecr-eco.sql` et
`data/publications-depot.json` du dépôt Matrix (`origin/main` `4df7b25`) ; Codex `src/lib/vigie.ts`,
`src/app/api/integrations/vigie/route.ts`, `docs/api.md` (`origin/main` `d8384f8`) ; Keystone
`src/server/integrations/vigie/*`, `docs/integrations/vigie-contract.md` (`origin/main` `b5891aa`).

## 2. Modèle (`src/db/schema.ts`, migration 0029)

Tables de la spécification de Matrix avec **exactement les colonnes que lisent ses quatre publications** (noms, types,
sens) ; colonnes propres à Vigie en fin de table (jamais publiées) ; contraintes de la spécification reprises (formats
`ECO-AAAA-NNN`, `ECR-AAAA-NNN`, `EMP-NNNN`, listes de valeurs, cohérences libération / rejet / décision / mise en œuvre,
une seule demande en cours par document de Codex).

| Table | Colonnes de la spécification | Colonnes propres à Vigie |
|---|---|---|
| `ecos` | `id`, `title`, `eco_type`, `status`, `interchangeability`, `from_revision`, `to_revision`, `cost_eur numeric(12,2)`, `schedule_days`, `stock_impact`, `requested_by_name`, `requested_by_matricule`, `raised_on`, `pilot_id`, `site_id`, `source`, `released_at`, `rejected_at`, `created_at`, `updated_at` | `description`, `approval_requested_on` (échéances), `created_by_id`, triplet `cancelled_*` (annulation motivée, publiée `rejected`) |
| `ecrs` | `id`, `kind`, `subject`, `title`, `reason`, `description`, `source`, `codex_doc_id`, `keystone_project_code`, `part_ref`, `event_id`, `requester_name`, `requester_matricule`, `requester_ref`, `status`, `eco_id`, `modifier_ref`, `decision_note`, `decided_by_id`, `decided_at`, `implemented_at`, `codex_revision`, `notify_status`, `notify_attempts`, `notify_error`, `created_at`, `updated_at` | `site_id` (périmètre), `created_by_id`, triplet `cancelled_*` |
| `eco_approvals` | `eco_id`, `approval_key`, `approver_text`, `decision`, `decided_by_name`, `decided_by_matricule`, `decided_at`, `comment`, `via` | `approver_id` (approbateur désigné dans Vigie), `decided_by_id` |
| `eco_parts`, `eco_projects` | toutes | — |
| `eco_effectivity` | `eco_id`, `target_type`, `target_ref`, `label`, `disposition`, `is_automatic`, `note`, `fitted_part_ref`, `fitted_revision`, `position` | `due_on`, `done_on` (réalisation d'une mise à jour ou d'un rétrofit) ; contrainte : rétrofit pour une machine seulement |
| `eco_documents`, `eco_actions` | toutes | — |
| `outbound_messages` (nouvelle) | — | file d'envoi : `target` (`codex`), `kind` (`ecr_decision`), `entity_type` / `entity_id`, `payload jsonb`, `status` (`pending` \| `sent` \| `failed`), `attempts`, `next_attempt_at`, `last_error`, `last_status`, `created_at`, `sent_at` ; jamais supprimée |
| `inbound_requests` | — | `project_code` facultatif (obligatoire pour les natures `nc_*`), `ecr_id`, `eco_id`, natures `ecr_create`, `eco_step`, `eco_approval` |

**Écart à la spécification (assumé)** : `external_progress` n'est pas créée. Les écritures reçues passent par
`inbound_requests` (décision CV-08, lot 3), qui garde la même trace (appelant, identifiant externe unique, personne déclarée,
heure, issue, motif) ; aucune publication de Matrix ne lit `external_progress`. Les clés étrangères vers `sites` et `events`
sont en `ON UPDATE CASCADE` (convention D14 de Vigie), la spécification n'en dit rien.

Valeurs calculées, jamais stockées : dispositions à décider (`pending_dispositions`), verrouillage (`locked`), retards.

## 3. Règles (`src/lib/rules/engineering.ts`, `src/server/engineering.ts`, `src/server/engineering-core.ts`)

- **Numérotation** : `ECO-AAAA-NNN` et `ECR-AAAA-NNN` par le compteur de références (`nextReference`, portées
  `ref:ECO-AAAA-` et `ref:ECR-AAAA-`) dans la transaction de création, année du jour ; la fonction de Codex réserve son
  numéro dans le même compteur (§ 5), au-delà des numéros déjà vus (demandes, numéros réservés non traités, journal).
- **Droits** (décision CV-06, par défaut à confirmer pour l'approbateur désigné) : création, modification, décision d'une
  demande, étapes, effectivité, annulation et décision d'une clé pour le compte de l'approbateur : animateur QHSE et
  direction (`requireEditor('engineering', { approver: true })`) ; l'encadrement consulte son périmètre (écran en
  consultation) et **l'approbateur désigné d'une clé** (`eco_approvals.approver_id`) la décide lui-même (`canDecideApproval`) ;
  Salarié : écran fermé (`ROLE_ROUTES`, `ROLES`). Site : `requireInSite` (création ou changement : `{ create: true }`),
  « Tous les sites » au périmètre complet.
- **Ordre** : brouillon → analyse d'impact → en approbation (interchangeabilité évaluée, `ecoStepBlocker`) ; champs, articles,
  projets, documents et approbateurs modifiables en brouillon et analyse d'impact (QUA-12) ; articles et projets contrôlés
  contre `keystone.pub_articles` et `pub_projets` (valeur enregistrée admise) ; trois clés (`englead`, `quality`, `pm`)
  créées « en attente » ; une clé refusée (commentaire obligatoire) **rejette** l'ordre ; trois clés approuvées,
  interchangeabilité évaluée et aucune disposition à décider : **libération d'office** (`ecoOutcome`, `settleEco`), avec une
  échéance à 60 jours pour chaque mise à jour ou rétrofit sans échéance ; après la libération, seules l'échéance et la date de
  réalisation d'une cible changent ; annulation motivée d'un ordre non libéré (publié `rejected`).
- **Effectivité** : « Proposer d'après Keystone » (`proposeEffectivity`) ajoute les cibles absentes — projets déclarés,
  projets dont `keystone.pub_nomenclatures` emploie un article de l'ordre (automatiques), machines de
  `keystone.pub_parc_machines` qui portent un article de l'ordre (révision montée reprise) ou livrées par un projet visé ;
  dispositions `update`, `pinned`, `retrofit` (machine seulement), `na`.
- **Demande** : création dans Vigie (objet document de Codex, article ou projet de Keystone, événement de Vigie hors AT et MP,
  références contrôlées contre les vues ; une seule demande en cours par document) ; décision : acceptée (sans ordre, rattachée à
  un ordre ouvert, ou avec un nouvel ordre en brouillon créé d'après elle ; rédacteur désigné dans Codex) ou refusée (motif) ;
  mise en œuvre constatée par le QHSE pour une demande hors document de Codex (ordre libéré) ; annulation motivée d'une
  demande de Vigie encore à décider (publiée `rejected`) ; une demande de Codex ou de Keystone se refuse.
- **Actions** : une action du plan se crée depuis l'ordre (QHSE), lien `eco:<numéro>` du registre (`src/lib/action-links.ts`,
  table `eco_actions`), source imposée **« Modification technique »** (`modification_technique`, 25ᵉ source, par défaut à
  confirmer par le QHSE), origine verrouillée après la création, plusieurs actions par ordre (suites `multi`).
- **Documents de Codex** cités par un ordre ou une demande : identifiant de Codex en texte, résolu par `resolveDocuments`
  (titre masqué s'il est confidentiel, lien vers le registre ou vers Codex).
- **Journal** : `eco` et `ecr` dans `change_log`, dans la transaction de chaque écriture ; écriture reçue : auteur vide,
  outil nommé dans l'intitulé (« Keystone (keystone_app) », « Codex (codex_app) ») ; historique à l'ouverture (`LazyChangeLog`).

## 4. Écran (`/modifications-techniques`)

Onglets « Ordres de modification » (défaut) et « Demandes de modification » (`?onglet=demandes`), filtre d'état, fiche en
fenêtre `?sel=<numéro>` (`DETAIL_PARAMS`). Adresses des autres outils : `/modifications-techniques/<numéro>` (Keystone pour un
ECO, Codex pour un ECR) redirige vers la fiche ; `/modifications-techniques/nouvelle?part=&project=&title=&source=keystone`
(« Raise ECO » de Keystone) ouvre le formulaire d'un nouvel ordre prérempli (QHSE) ; filtres `?part=` et `?project=` (contrat
NEW-D4-1 de Keystone). Numéro inconnu ou hors périmètre : `MissingNotice`.

## 5. Écritures reçues (décision CV-08, migration 0029)

Fonctions `SECURITY DEFINER`, `search_path` = schéma de Vigie puis `pg_temp` (bloc `DO` de la migration), sans SQL dynamique,
appelant `session_user` contrôlé dans `inbound_callers` (outil attendu, sinon SQLSTATE **P0V01**), arguments contrôlés
(**P0V02**), idempotentes par `(caller, external_id)`, `REVOKE EXECUTE … FROM PUBLIC` (exécution accordée par Matrix
seulement). Demande traitée par `processInboundRequests` (tâche « Demandes reçues », « Traiter maintenant ») : décisions pures
`decideEcrRequest`, `decideEcoRequest` (`src/lib/rules/inbound.ts`).

```sql
-- Codex (codex_app, inscrit par la migration) : rend le numéro ECR-AAAA-NNN réservé (le même au renvoi).
vigie.pub_creer_demande_modification(
  p_id_externe text,          -- identifiant de la demande chez Codex (idempotence)
  p_nature text,              -- modification | obsolescence
  p_document text,            -- identifiant de Codex (PRO-QUA-0001)
  p_motif text,               -- 2 000 caractères au plus
  p_description text,         -- facultatif, 4 000 caractères au plus
  p_demandeur_ref text,       -- codex.users.id (jwagner), facultatif
  p_demandeur_nom text,
  p_demandeur_matricule text, -- EMP-NNNN, facultatif
  p_remplacant text,          -- document de remplacement proposé (retrait), facultatif, gardé au journal
  p_enregistre_le timestamptz
) RETURNS text

-- Keystone (keystone_app) : rend le numéro de la demande dans Vigie (le même au renvoi).
vigie.pub_signaler_avancement_eco(
  p_numero text,              -- ECO-AAAA-NNN
  p_nature text,              -- step | approval
  p_cle text,                 -- approval : englead | quality | pm
  p_decision text,            -- approval : ok | rejected
  p_etape_depuis text,        -- step : étape vue par Keystone (obligatoire)
  p_etape_cible text,         -- step : étape suivante demandée
  p_commentaire text, p_acteur_nom text, p_acteur_role text, p_enregistre_le timestamptz,
  p_id_externe text           -- keystoneId de l'outbox de Keystone (idempotence)
) RETURNS integer
```

Traitement : **création par Codex** — demande « À décider » au numéro réservé (site du document s'il est suivi par Vigie) ;
document inconnu de Codex, retiré, ou déjà visé par une demande en cours : demande créée « refusée » avec le motif et Codex
prévenu par son webhook (le numéro rendu désigne toujours une demande lisible dans `pub_demandes_modification`) ; Codex
indisponible : demande laissée « reçue » et reprise au passage suivant. **Avancement par Keystone** — étape suivante depuis
l'étape vue (sinon `stale`), selon les règles de l'écran (interchangeabilité : `refused` ; autre étape : `invalid`) ; clé
`englead` ou `pm` d'un ordre en approbation (clé `quality` : `refused`, décidée dans Vigie ; même décision renvoyée :
appliquée sans changement ; décision contraire : `refused`) ; ordre libéré ou rejeté : `refused` ; ordre inconnu, annulé, ou
sans article ni projet ni origine Keystone : `not_found`. Échéances des refus et attentes : `keystone-refus|<id>`,
`codex-refus|<id>`, `…-attente|<id>` (`loadInboundSignals`, lien vers la fiche).

## 6. Envoi des décisions à Codex (file d'envoi)

Décision sur une demande **de Codex** visant un de ses documents (Codex ne connaît que les siennes) : message dans
`outbound_messages`, écrit dans la transaction de la décision — refus et acceptation sans ordre aussitôt ; acceptation avec un
ordre : à la libération de l'ordre (`ecoRef` = numéro de l'ordre), ou refus si l'ordre est rejeté ou annulé. Envoi par la
tâche planifiée « Envois aux outils » (serveur Next.js, à chaque passage) ou « Envoyer maintenant » (onglet « Connecteurs ») :
`POST <VIGIE_CODEX_URL>/api/integrations/vigie`, corps `{ requestId, accepted, ecoRef, modifierId, note }`, jeton
`VIGIE_CODEX_WEBHOOK_TOKEN` (`Authorization: Bearer`) et / ou signature `VIGIE_CODEX_WEBHOOK_SECRET`
(`X-Codex-Timestamp`, `X-Codex-Signature: v1=<HMAC-SHA256 de « horodatage.corps »>`), valeurs des variables
`VIGIE_WEBHOOK_TOKEN` / `VIGIE_WEBHOOK_SECRET` de Codex. Réponses (`readCodexResponse`) : 200 `implemented` → demande « mise
en œuvre », révision ouverte (`codex_revision`) ; 200 `rejected`, 202 (acceptation en attente chez Codex) → envoyé ; 429, 5xx,
erreur réseau → reprise à 1, 2, 4… minutes (au plus 6 h, `Retry-After` respecté) ; 4xx → refusé ; au-delà de 12 tentatives →
refusé. État recopié sur la demande (`notify_*`) ; journal de la demande ; onglet « Connecteurs » : nombres par état,
messages à reprendre et refusés. Sans adresse ni identifiant : messages laissés « à envoyer », aucune erreur. Journal du
serveur : identifiant du message, destinataire, statut HTTP, tentatives — jamais le corps, le jeton ni la signature.

## 7. Échéances (`loadEngineeringSignals`)

| Clé | Quand | Destinataire |
|---|---|---|
| `ecr-decision\|<ECR>` | demande à décider, échéance 15 jours après sa création | responsable QHSE du site |
| `eco-approbation\|<ECO>\|<clé>` | clé en attente d'un ordre en approbation, échéance 10 jours après la soumission | approbateur désigné, sinon responsable QHSE |
| `eco-dispositions\|<ECO>` | trois clés approuvées, disposition ou interchangeabilité manquante (verrouillé) | pilote, sinon responsable QHSE |
| `eco-effectivite\|<ECO>\|<type>\|<cible>` | mise à jour ou rétrofit d'un ordre libéré non réalisé, échéance dans 15 jours ou dépassée | pilote, sinon responsable QHSE |

## 8. Publications définies par Matrix (requêtes de référence)

Matrix définit et applique `vigie.pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite`,
`pub_demandes_modification` (contrat D12 v1, `data/publications-depot.json`) sur les tables ci-dessus ; **Vigie ne crée
aucune vue `pub_`** (M-18). Les définitions de Matrix sont recopiées ci-dessous, noms non qualifiés : elles sont exécutées
par `test/integration/ecr-eco-contract.test.ts` (colonnes, types, valeurs du jeu) et gardées par
`test/integration/published-columns-m18.test.ts` (aucune colonne lue ne se supprime, ne se renomme ni ne change de type).

<!-- requete-reference:debut pub_ordres_modification -->
```sql
SELECT e.id                  AS number,
       e.title,
       e.eco_type,
       e.status,
       e.interchangeability,
       e.from_revision,
       e.to_revision,
       e.cost_eur,
       e.schedule_days,
       e.stock_impact,
       ARRAY(SELECT d.ref_label FROM eco_documents d WHERE d.eco_id = e.id ORDER BY d.position) AS document_refs,
       ARRAY(SELECT d.codex_doc_id FROM eco_documents d
             WHERE d.eco_id = e.id AND d.codex_doc_id IS NOT NULL ORDER BY d.position) AS codex_doc_ids,
       e.requested_by_name,
       e.requested_by_matricule,
       e.raised_on,
       coalesce(f.en_attente, 0)::integer AS pending_dispositions,
       (coalesce(a.n, 0) = 3 AND a.toutes_ok AND e.status NOT IN ('draft', 'rejected')
        AND (coalesce(f.en_attente, 0) > 0 OR e.interchangeability IS NULL)) AS locked,
       ARRAY(SELECT p.part_ref FROM eco_parts p WHERE p.eco_id = e.id ORDER BY p.position) AS parts,
       ARRAY(SELECT pr.keystone_project_code FROM eco_projects pr
             WHERE pr.eco_id = e.id ORDER BY pr.position) AS projects,
       e.released_at,
       e.updated_at          AS vigie_updated_at
FROM ecos e
LEFT JOIN (SELECT eco_id, count(*) AS n, bool_and(decision = 'ok') AS toutes_ok
           FROM eco_approvals GROUP BY eco_id) a ON a.eco_id = e.id
LEFT JOIN (SELECT eco_id, count(*) FILTER (WHERE disposition IS NULL) AS en_attente
           FROM eco_effectivity GROUP BY eco_id) f ON f.eco_id = e.id
```
<!-- requete-reference:fin -->

<!-- requete-reference:debut pub_eco_approbations -->
```sql
SELECT a.eco_id AS eco_number,
       a.approval_key,
       a.decision,
       a.approver_text,
       a.decided_by_name,
       a.decided_by_matricule,
       a.decided_at
FROM eco_approvals a
```
<!-- requete-reference:fin -->

<!-- requete-reference:debut pub_eco_effectivite -->
```sql
SELECT t.eco_id AS eco_number,
       t.target_type,
       t.target_ref,
       t.label,
       t.disposition,
       t.is_automatic,
       t.note,
       t.fitted_part_ref,
       t.fitted_revision,
       t.position
FROM eco_effectivity t
```
<!-- requete-reference:fin -->

<!-- requete-reference:debut pub_demandes_modification -->
```sql
SELECT r.id,
       r.kind,
       r.codex_doc_id        AS doc_id,
       CASE WHEN r.source = 'codex' THEN r.requester_ref ELSE r.source END AS requester_id,
       r.requester_name,
       r.requester_matricule,
       r.reason,
       r.description,
       r.status,
       r.eco_id              AS eco_ref,
       r.modifier_ref        AS modifier_id,
       r.decision_note,
       r.source,
       r.subject,
       r.keystone_project_code AS project_code,
       r.part_ref,
       r.event_id,
       r.created_at,
       r.decided_at,
       r.implemented_at,
       r.codex_revision
FROM ecrs r
```
<!-- requete-reference:fin -->

Notes pour Matrix : un ordre annulé est publié `rejected` (avec `rejected_at`) ; une demande annulée est publiée `rejected`
(note « Annulée : … ») ; les approbations décidées dans Vigie portent `decided_by_matricule` quand la personne a un matricule
de Cursus (`EMP-NNNN`) ; `pub_demandes_modification` publie aussi les demandes refusées d'office (numéro réservé par Codex).
Les écarts de la spécification relevés ici ne touchent aucune colonne publiée.

## 9. Démonstration (`src/db/seeds/changes-eco.ts`, jeu neuf seulement)

ECO-2026-001 (arbre ARB-MAL-045 à l'indice C, né de la demande ECR-2026-003 et de la NC EV-2026-130 ; en approbation,
ingénierie approuvée par Keystone, qualité et chefs de projet attendus — échéances dépassées —, une disposition à décider),
ECO-2026-002 (vérin VER-HYD-300, nouveau fournisseur, libéré ; mise à jour du projet K-2024-097 en retard, rétrofit de la
presse MCH-022 dans 25 jours ; né de la demande de Codex ECR-2026-002, décision transmise, révision C ouverte),
ECO-2026-003 (capot CAP-PRS-400 retiré, brouillon), ECR-2026-001 (demande de Codex sur PRO-QUA-0001, à décider) ; demandes
reçues traitées (création par Codex, approbation de l'ingénierie par Keystone) ; substituts de Keystone `pub_articles`,
`pub_nomenclatures`, `pub_parc_machines` (`src/db/seeds/foreign.ts`).

## 10. Fichiers

`src/lib/rules/engineering.ts`, `src/lib/rules/outbound.ts` (+ tests), `src/lib/rules/inbound.ts` (décisions de D12),
`src/lib/data/engineering.ts`, `src/server/engineering.ts`, `src/server/engineering-core.ts`, `src/server/outbound.ts`,
`src/server/inbound.ts`, `src/server/connectors.ts` (« Envoyer maintenant »), `src/db/scheduler.ts` (« Envois aux outils »),
`src/lib/foreign/keystone.ts` et `src/db/foreign.ts` (articles, nomenclatures, parc installé ; contrats
`test/fixtures/contracts/keystone.pub_*.json`), `src/app/(app)/modifications-techniques/`, `src/components/engineering/`,
`src/components/SitesManager.tsx` (file d'envoi), registre `src/lib/action-links.ts` (`eco`), `src/lib/domain.ts` (écran
`engineering`, source `modification_technique`), `src/lib/env.ts` (`VIGIE_CODEX_WEBHOOK_TOKEN`, `VIGIE_CODEX_WEBHOOK_SECRET`),
tests `test/integration/ecr-eco.test.ts`, `inbound-ecr-eco.test.ts`, `outbound.test.ts`, `ecr-eco-contract.test.ts`.

## 11. Points appliqués par défaut, à confirmer

1. Approbateur désigné (`approver_id`, personne de Vigie) : il décide sa propre clé même si son rôle est en consultation ; le
   service QHSE et la direction décident toute clé pour son compte (journalisé « Pour le compte de »).
2. Keystone décide les clés `englead` et `pm` ; la clé `quality` se décide dans Vigie.
3. Libération d'office exigeant aussi l'interchangeabilité évaluée et toutes les dispositions décidées (définition de `locked`
   de Matrix) ; échéance des mises à jour et rétrofits : 60 jours après la libération, modifiable.
4. Décision transmise à Codex seulement pour ses propres demandes ; acceptation avec un ordre transmise à la libération.
5. Source d'action « Modification technique » ajoutée (25 sources) ; actions créées depuis l'ordre seulement.
6. Numéro ECR réservé par la fonction de Codex (réponse immédiate) ; demande refusée d'office créée quand même (numéro lisible).
7. Délais des échéances : décision d'une demande 15 jours, approbation 10 jours.
8. Site d'une demande de Codex : site du document s'il est suivi par Vigie, sinon toute l'entreprise.
9. Pas de reprise des 6 ECO de Keystone ni des 3 ECR de Codex (P-03) : jeu de démonstration propre à Vigie.
