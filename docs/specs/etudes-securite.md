# Études de sécurité des procédés — modèle, règles et données publiées (VG-01 à VG-05)

*Rédigée le 01/11/2026. Statut : **livrée le 01/11/2026** (migration `0023_process_safety_studies`), en réponse à la demande d'Arche « VG-01 à VG-05 » du `REQUESTS.md` (validée par Guillaume le 01/11/2026). Éléments couverts : CNF-12, CNF-13, CNF-14 et INT-18 de [`docs/RESTE-A-FAIRE.md`](../RESTE-A-FAIRE.md) (réponse du responsable produit : les études sont tenues dans Vigie). Les choix faits par défaut sont listés au [§ 9](#9-points-appliqués-par-défaut-à-confirmer) et au § 19 de `RESTE-A-FAIRE.md`.*

## 1. Objet

La méthode DIG-PRODI v4.0 du groupe bloque les jalons de décision d'un CAPEX de filiale (G1, G2, K3, G3, piloté dans Arche) par des jalons de sécurité des procédés. Vigie, propriétaire de la QHSE, tient les études qui font franchir ces jalons, suit leurs recommandations au plan d'actions QSE et met à disposition de quoi publier leur état à Arche (et plus tard à Keystone, R-192 « PSSR obtenu »).

| Jalon | Études | Avant |
|---|---|---|
| `HS2` | HazID (`hazid`) | G1 |
| `HS3` | HazOp (`hazop`), AMDEC (`amdec`) | G2 |
| `HS4` | Contrôle chantier (`controle_chantier`) | K3 |
| `PSSR` | PSSR (`pssr`), RSPDI (`rspdi`) | G3 |
| `HS6` | Audit ASPD (`aspd`) | après démarrage |

## 2. Modèle (`src/db/schema.ts`)

**`process_safety_studies`** — une ligne par étude, jamais supprimée :

| Colonne | Contenu |
|---|---|
| `id` | référence « ES-001 » (`nextEntityReference(tx, 'process_safety_study', 'ES-', 3)`, dans la transaction de création, jamais réattribuée) |
| `site_id` | site de Vigie de l'usine (obligatoire) |
| `capex_code` | code CAPEX d'Arche (`CPX-APM-2026-01`), saisi ; contrainte `^CPX-[A-Z0-9][A-Z0-9-]{0,39}$` |
| `keystone_project_code` | code du projet EPC2i (Keystone), saisi ; au moins un des deux codes (contrainte `process_safety_studies_link_check`) |
| `milestone`, `type` | jalon et type, compatibles (contrainte `process_safety_studies_type_milestone_check`, règle `studyTypeError`) |
| `status` | `planifiee`, `realisee`, `validee` (stocké) ; `annulee` est calculé d'après le triplet d'annulation |
| `session_on` | séance prévue (planifiée) ou tenue |
| `validated_on`, `conclusion` | renseignées si et seulement si l'étude est validée (contrainte `process_safety_studies_validated_check`) ; conclusion `favorable`, `reserves`, `defavorable` |
| `facilitator_id` / `facilitator_external` | animateur : une personne de l'effectif ou un intervenant extérieur, pas les deux |
| `report_ref` | référence Codex du rapport (texte, 120 caractères au plus ; Vigie ne lit pas Codex) |
| `scope` | périmètre et objet |
| `cancelled_at`, `cancelled_by_id`, `cancel_reason` | annulation motivée (`archiveState`) |

Listes d'état : `STUDY_MILESTONE_CODES`, `STUDY_TYPE_CODES`, `STUDY_STATUS_CODES`, `STUDY_CONCLUSION_CODES` (`src/lib/state-keys.ts`, comparées à l'interface par `state-keys.test.ts`).

**Recommandations** — actions QSE du plan d'actions unique, rattachées à l'étude :

- `actions.safety_study_id` : étude d'origine, posée **à la création seulement** (comme `event_id` ou `document_id`, ACT-01), conservée sur une action abandonnée, jamais rattachée ni détachée ensuite (`ORIGIN_LOCKED`) ; type de lien `safetystudy:<référence>` du registre (`src/lib/action-links.ts`) ;
- `actions.safety_study_blocking` : réserve bloquante du jalon (contrainte : seulement avec une étude) ; cochée à la création (« Réserve bloquante »), posée ou levée ensuite par le QHSE depuis la fiche de l'étude (levée motivée), journalisée sur l'étude et sur l'action ;
- source imposée : « HAZOP » (`hazop`, cible `safetystudy`, chemin `/risques?vue=etudes`) pour tous les types d'étude — aucune source n'a été ajoutée aux 24 sources du QHSE ;
- action de suite (vérification « non efficace » ou « nouveau risque ») : rattachée aussi à l'étude (`followUpLinkMode` = `multi`), réserve bloquante reprise.

**Sites (VG-05)** — `sites.code` (facultatif, unique quand il est renseigné) : clé `matrix.sites.code` de la décision D14 de Matrix (minuscules, chiffres et soulignés, une lettre en premier, 2 à 32 caractères, jamais `all` : contrainte `sites_code_check`, règle `siteCodeError`). Les usines des filiales sont des sites de Vigie portant ce code. Saisi dans « Gérer les sites » par le périmètre complet (animateur QHSE, direction), journalisé (« Code commun (Matrix) »). Les identifiants de Vigie (`ville-a`) ne suivent pas le format de Matrix : ils ne changent pas ; le code s'y ajoute.

## 3. Droits

| Rôle | Lecture | Écriture |
|---|---|---|
| Animateur QHSE, Direction | vue et fiches du site sélectionné (« Tous les sites » : périmètre) | création, modification, validation, réouverture et annulation (motif), réserves bloquantes, recommandations (ACT-22) |
| Chef de service, Chef de projet | vue et fiches (consultation) ; recommandations décrites seulement si `canReadAction`, sinon numéro seul | — |
| Salarié | vue masquée ; lien profond : `MissingNotice` ; sa propre recommandation : étude en référence seule | — |

Server actions (`src/server/process-safety.ts`) : `requireEditor('risks', { approver: true })`, puis `requireInSite` du site de l'étude (`{ create: true }` à la création ou au changement de site) ; contrôle de version (QUA-12) sur la modification et la validation ; journal `process_safety_study` dans la transaction de chaque écriture.

## 4. Règles (`src/lib/rules/process-safety.ts`)

- Statut : séance obligatoire ; une étude réalisée ou validée a eu lieu (séance au plus aujourd'hui) ; validation : date (pas avant la séance, au plus aujourd'hui) et conclusion obligatoires ; bornes des dates sur les seules valeurs modifiées (AUD-31). La modification n'atteint pas la validation : « Valider » (`validateProcessSafetyStudy`), puis « Rouvrir » (motif, `reopenProcessSafetyStudy`) pour la revoir.
- Recommandation ouverte : ni Vérifiée ni Abandonnée (`isClosedActionStatus`) ; en retard : règle `isLate` du plan (avancement ouvert, date cible passée) ; réserve bloquante : marquée bloquante **et** ouverte (une réserve abandonnée compte comme levée).
- Jalon franchi par une étude (règle d'Arche, `studyClearsMilestone`) : étude validée, conclusion non défavorable, aucune réserve bloquante ouverte ; une étude annulée ne compte pas.
- Échéance (`loadProcessSafetySignals`) : séance passée d'une étude encore planifiée — clé `etude-securite|<référence>`, `dueOn` = date de séance, `siteId` du site, destinataire l'animateur de l'effectif s'il est présent, sinon le responsable QHSE du site ; comptée dans le badge « Évaluation des risques » ; reçue par le QHSE et la direction, et par l'animateur pour la sienne (jamais par le Salarié). Les recommandations en retard sont des échéances du plan d'actions (inchangées).

## 5. Lien profond (VG-04)

`/risques?vue=etudes&etude=<référence>` (`studyHref`) : vue « Études de sécurité des procédés » de l'écran « Évaluation des risques », fiche de l'étude ouverte avec ses recommandations (numéro, libellé, responsable, échéance, avancement, réserve) et son historique. Paramètre `etude` dans `DETAIL_PARAMS` (`src/lib/url-state.ts`) ; référence inconnue, hors du site sélectionné ou rôle Salarié : `MissingNotice` « Étude de sécurité introuvable ou hors du site sélectionné. ». Une recommandation s'ouvre au plan d'actions (`/actions?action=A-191`).

## 6. Publication `vigie.pub_etudes_securite` (VG-03)

Depuis la décision M-18 de Matrix (01/11/2026), **Matrix définit et applique les vues `pub_`** sur les tables de Vigie (écran « Publications ») ; Vigie ne crée aucune vue `pub_` dans ses migrations et tient les tables et colonnes publiées. Le lien de lecture d'`arche_app` est la demande M-15 d'Arche à Matrix. Une colonne lue par la publication ne se modifie qu'après évolution de la publication par Matrix.

Contrat (une ligne par étude, annulées comprises ; colonnes jamais supprimées ni renommées, ajouts en fin ; aucune donnée de santé — le seul nom de personne publié est celui de l'animateur) :

| Colonne | Type | Source |
|---|---|---|
| `etude_ref` | text | `process_safety_studies.id` (clé) |
| `capex_code` | text | `capex_code` (null admis) |
| `projet_code` | text | `keystone_project_code` (null admis) |
| `jalon` | text | `milestone` |
| `type` | text | `type` |
| `statut` | text | `annulee` si `cancelled_at`, sinon `status` |
| `seance_le` | date | `session_on` |
| `conclue_le` | date | `validated_on` |
| `conclusion` | text | `conclusion` |
| `animateur` | text | nom de `facilitator_id` (`people.name`), sinon `facilitator_external` |
| `rapport_ref` | text | `report_ref` |
| `recommandations` | integer | actions de l'étude |
| `recommandations_ouvertes` | integer | ni `verifiee` ni `abandonnee` |
| `recommandations_en_retard` | integer | avancement ouvert (`a_faire` à `p80`) et `due_on` passée (jour de Paris) |
| `reserves_bloquantes` | integer | `safety_study_blocking` et ouverte |
| `lien` | text | chemin du lien profond, à préfixer par l'adresse publique de Vigie (`VIGIE_PUBLIC_URL`) |
| `maj_le` | timestamptz | dernière écriture connue : création, annulation, journal de l'étude, journal de ses recommandations ; calculée, jamais stockée |

**Requête de référence** (noms non qualifiés : `public` en PGlite, `vigie` sur le serveur ; jour de Paris de l'instant de lecture pour le retard). Elle est exécutée telle quelle sur la base de démonstration par `test/integration/process-safety-contract.test.ts` (date du jour remplacée par celle du jeu) : toute évolution des tables qui la casserait fait échouer ce test.

<!-- requete-reference:debut -->
```sql
SELECT s.id                                              AS etude_ref,
       s.capex_code                                      AS capex_code,
       s.keystone_project_code                           AS projet_code,
       s.milestone                                       AS jalon,
       s.type                                            AS type,
       CASE WHEN s.cancelled_at IS NOT NULL THEN 'annulee' ELSE s.status END AS statut,
       s.session_on                                      AS seance_le,
       s.validated_on                                    AS conclue_le,
       s.conclusion                                      AS conclusion,
       coalesce(p.name, s.facilitator_external)          AS animateur,
       s.report_ref                                      AS rapport_ref,
       coalesce(r.total, 0)::integer                     AS recommandations,
       coalesce(r.ouvertes, 0)::integer                  AS recommandations_ouvertes,
       coalesce(r.en_retard, 0)::integer                 AS recommandations_en_retard,
       coalesce(r.bloquantes, 0)::integer                AS reserves_bloquantes,
       '/risques?vue=etudes&etude=' || s.id              AS lien,
       greatest(s.created_at, s.cancelled_at, js.last_at, ja.last_at) AS maj_le
FROM process_safety_studies s
LEFT JOIN people p ON p.id = s.facilitator_id
LEFT JOIN LATERAL (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE a.status NOT IN ('verifiee', 'abandonnee')) AS ouvertes,
         count(*) FILTER (WHERE a.status IN ('a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80')
                            AND a.due_on < (now() AT TIME ZONE 'Europe/Paris')::date) AS en_retard,
         count(*) FILTER (WHERE a.safety_study_blocking AND a.status NOT IN ('verifiee', 'abandonnee')) AS bloquantes
  FROM actions a
  WHERE a.safety_study_id = s.id
) r ON true
LEFT JOIN LATERAL (
  SELECT max(l.at) AS last_at FROM change_log l WHERE l.entity_type = 'process_safety_study' AND l.entity_id = s.id
) js ON true
LEFT JOIN LATERAL (
  SELECT max(l.at) AS last_at
  FROM change_log l
  JOIN actions a ON l.entity_type = 'action' AND l.entity_id = a.id
  WHERE a.safety_study_id = s.id
) ja ON true
```
<!-- requete-reference:fin -->

Notes pour Matrix : vue à créer `WITH (security_barrier)` comme `pub_controles` ; le retard d'une recommandation change avec la date sans écriture (`maj_le` ne bouge pas ce jour-là) ; une étude annulée reste publiée (`statut = 'annulee'`) ; les valeurs sont celles de l'écran (mêmes règles que `recommendationCounts`, comparées par le test).

## 7. Démonstration (`src/db/seeds/process-safety.ts`)

Alignée sur la démonstration d'Arche (CAPEX `CPX-APM-2026-01`, rapport HazID `NOT-CPX-APM-2026-01-002` de son catalogue Codex simulé), sur le site A : ES-001 HazID validée favorable (jalon HS 2 franchi), ES-002 HazOp validée avec réserves et trois recommandations — A-191 réserve bloquante ouverte, A-192 en retard au 09/10/2026, A-193 vérifiée efficace — (HS 3 non franchi), ES-003 PSSR planifiée dans 25 jours. Aucun code commun de site dans le jeu (aucun site de filiale).

## 8. Fichiers

`src/lib/rules/process-safety.ts` (+ test), `src/lib/data/process-safety.ts`, `src/server/process-safety.ts`, `src/components/risks/ProcessSafetyPanel.tsx`, `src/app/(app)/risques/page.tsx`, registre `src/lib/action-links.ts` (`safetystudy`), `src/lib/action-rules.ts` (`admissibleSources`, `followUpLinkMode`), `src/lib/domain.ts` (`hazop`), `src/server/history.ts` (`process_safety_study`), `src/server/sites.ts` et `src/components/SitesManager.tsx` (code du site), tests `test/integration/process-safety.test.ts` et `test/integration/process-safety-contract.test.ts`.

## 9. Points appliqués par défaut, à confirmer

1. Source « HAZOP » pour les recommandations de tous les types d'étude (HazID, contrôle chantier, PSSR / RSPDI, ASPD compris), en attendant que le service QHSE décide d'éventuelles sources HAZID / PSSR (la liste des 24 sources reste celle du QHSE).
2. Réserve bloquante abandonnée = levée (ne compte plus dans `reserves_bloquantes`) ; levée d'une réserve encore ouverte : motif obligatoire.
3. Lecture : tous les rôles de l'écran « Évaluation des risques » sauf le Salarié ; écriture : animateur QHSE et direction.
4. Étude rattachée à un site de Vigie (obligatoire) et à au moins un code (CAPEX ou projet), codes saisis sans contrôle d'existence chez Arche ou Keystone (Vigie ne lit pas leurs tables ; contrôle d'orphelins possible par Matrix).
5. Référence « ES-001 » (3 chiffres, sans année), lien profond publié en chemin relatif (`lien`), à préfixer par l'adresse publique de Vigie.
6. Une seule échéance : séance passée d'une étude encore planifiée ; pas d'échéance « réalisée sans validation ».
7. Animateur : une personne de l'effectif ou un intervenant extérieur (nom libre), facultatif.
8. Code commun du site facultatif, saisi par le périmètre complet ; aucun code donné aux sites de démonstration.
9. Étude annulée publiée (`statut = 'annulee'`), ses recommandations restent au plan d'actions.
