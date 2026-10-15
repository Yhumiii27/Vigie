# Actions QSE — spécification fonctionnelle de la refonte du plan d'actions

*Rédigée le 15/10/2026. Statut : à valider. Points ouverts : [§ 22](#22-points-ouverts).*

Sources, par ordre de priorité :

1. le formulaire Power Apps « Créer Actions QSE » (capture reçue le 15/10/2026) ;
2. les réponses du service QHSE au questionnaire (premier tour le 15/10/2026 à 08:41 UTC, questions de suivi à 09:07 UTC) ;
3. les arbitrages de l'utilisateur du 15/10/2026 (rappel du mercredi dans Vigie et par e-mail ; format des numéros AC en attente de recherche ; rôle du responsable validé ; extraction Power Apps fournie plus tard par le propriétaire de l'application ; d'autres formulaires Power Apps à venir) ;
4. les décisions produit antérieures ([`docs/RESTE-A-FAIRE.md`](../RESTE-A-FAIRE.md), § 19 et § 20) et les conventions de [`CLAUDE.md`](../../CLAUDE.md) ;
5. le code actuel (table `actions` de `src/db/schema.ts`, `src/lib/domain.ts`, `src/components/ActionFormDialog.tsx`, `src/lib/data/actions.ts`, `src/server/plan.ts`, `plan-ui.ts`, `plan-core.ts`).

En cas de conflit, la source la plus haute l'emporte. Les éléments de backlog cités (ACT-17 à ACT-40) sont décrits au [§ 21](#21-découpage-en-éléments-du-backlog).

## 1. Objet

Le service QHSE suit aujourd'hui ses actions dans l'application Power Apps « Créer Actions QSE ». Vigie a son propre plan d'actions unique (`/actions`), construit sur la maquette : statuts À lancer → En cours → Efficacité à vérifier → Clôturée, dix origines (une par écran), nature corrective ou préventive, intitulé court, pilote qui fait avancer son action.

La refonte aligne le formulaire, le cycle de vie, la vérification et la vue générale de Vigie sur ce que le service QHSE tient dans Power Apps, pour que Vigie remplace l'application sans perte :

- mêmes champs et mêmes listes de valeurs que le formulaire Power Apps ;
- même avancement (dix valeurs), conduit par le service QHSE ;
- même vérification d'efficacité, planifiée dès la création ;
- un responsable qui consulte ses actions, commente et joint des preuves ;
- une vue générale filtrable, des statistiques mensuelles, une notification à la création et un rappel hebdomadaire ;
- la reprise de toutes les actions Power Apps, avec leur numéro AC.

Ce qui ne change pas : un plan d'actions unique, alimenté depuis tous les écrans de Vigie (« Créer l'action » sur un événement, un risque, un contrôle, un constat…) ; les rattachements aux sources (`src/lib/action-links.ts`, colonnes de source d'ACT-01) ; la traçabilité (journal `change_log` par `logChange()`, jamais de suppression physique, motif obligatoire pour abandonner ou rouvrir) ; le périmètre de sites (`requireInSite`, `inPerimeter`) ; les indicateurs calculés, jamais stockés ; le cloisonnement du Salarié.

Hors périmètre (décidé) : export Excel des actions, vues enregistrées, synthèse hebdomadaire pour le QHSE, notification de création par e-mail. Les autres formulaires Power Apps (événements, audits…) feront l'objet de leurs propres spécifications ; ils pourront modifier les écrans sources des actions, pas le modèle décrit ici.

## 2. Décisions de référence

| Sujet | Décision | Source |
|---|---|---|
| Avancement | A faire, Budgétée ou initiée, 20 %, 40 %, 60 %, 80 %, Terminée, Vérifiée, Abandonnée, Reportée. Terminée = réalisée, puis vérification d'efficacité ; Vérifiée = clôturée | QHSE, 1er tour |
| Budgétée ou initiée | Une seule valeur : prise en compte par le responsable, pas réellement commencée | QHSE, suivi |
| Paliers 20–80 % | Estimation libre ; c'est le QHSE qui fait avancer ; retour en arrière possible. « Terminée » : QHSE seulement | QHSE, suivi |
| Reportée | Statut à part (mise en attente), posé par le QHSE, sans motif obligatoire | QHSE, suivi |
| Rôle du responsable | Il consulte ses actions, commente dans le fil et joint des preuves ; l'avancement est géré par le QHSE | Utilisateur, 15/10 |
| Champs obligatoires | Date, Avancement, Date cible, Responsable, Priorité, Source, Domaine, Description du problème, Détail de l'action, Vérification planifiée | QHSE, 1er tour |
| Dates | Date = ouverture, non modifiable ; Date effective = réalisation ; Date de vérification = date de clôture | QHSE, 1er tour |
| Vérification | Par le QHSE, planifiée dès la création ; non efficace → l'action passe Vérifiée avec le constat « non efficace » et une nouvelle action pré-remplie et liée est créée ; case « nouveau risque généré » au passage Terminée → Vérifiée → nouvelle action (description du risque si possible) | QHSE, deux tours |
| Pointage | Temps réel, une seule valeur saisie par le QHSE à la clôture | QHSE, deux tours |
| Coûts | Estimé puis réel, TTC, sans le temps ; saisis à tout moment | QHSE, deux tours |
| Commentaires | Fil daté et signé | QHSE, 1er tour |
| Intitulé, nature, site | Pas d'intitulé court ; nature corrective/préventive à retirer ; un seul site par action ; référence d'origine utile ; responsable toujours obligatoire | QHSE, 1er tour |
| Liens | Lien aux événements et audits (n°) ; un seul événement ou audit lié, une seule source, un seul domaine | QHSE, deux tours |
| Notifications | Notification au responsable à la création, dans Vigie seulement (cloche) ; rappel hebdomadaire le mercredi de toutes les actions en cours, retards distingués, **dans Vigie et par e-mail** ; pas de synthèse QHSE | QHSE + utilisateur, 15/10 |
| Vue générale | Filtres : avancement, responsable, source, priorité, texte libre ; pas de vues enregistrées, pas d'export Excel | QHSE, suivi |
| Statistiques | Au mois : par avancement, source, domaine, responsable, niveau de risque ; taux de retard ; délai moyen de clôture ; taux d'efficacité ; évolution mensuelle ouvertes/clôturées ; respect des dates cibles | QHSE, suivi |
| Numérotation | Numéro unique, jamais réattribué ; format AC + année + numéro (ex. AC-260150) ; compteur annuel ou continu et nombre de chiffres **à rechercher** | QHSE + utilisateur, 15/10 |
| Reprise | Toutes les actions Power Apps, avec leurs numéros AC ; extraction fournie plus tard par le propriétaire de l'application | QHSE + utilisateur, 15/10 |
| Traçabilité | Jamais de suppression physique ; annulation ou archivage avec motif obligatoire ; journal de chaque création, modification, annulation | Décision du 10/10/2026 (§ 20 du backlog) |
| Rôle Salarié | Ne voit que ses propres données. **Remplacé** pour les actions : il ne « déclare plus réalisée » une action ; comme tout responsable, il consulte, commente et joint des preuves | § 20, modifié par l'utilisateur le 15/10 |

## 3. Rôles

- **Service QHSE** — dans ce document, « QHSE » désigne les rôles Animateur QHSE et Direction, ceux qui valident déjà dans Vigie (`canApprove`, `requireApprover`) : vérification d'efficacité, approbation des documents, versions du DUERP. Ils ont tous les droits sur les actions de leur périmètre (tous les sites).
- **Responsable** — la personne désignée sur l'action (colonne `pilot_id`, libellée « Responsable » à l'écran), choisie dans la liste du personnel actif (`people` sans date de sortie passée), quel que soit son rôle.
- **Responsable QHSE du site** — `sites.qhse_lead_id`, résolu par `loadQhseLeads()` (poste vacant : les animateurs QHSE) : destinataire des échéances de vérification d'efficacité.
- **Encadrement hors QHSE** (Chef de service, Chef de projet) — aujourd'hui, il crée et modifie toutes les actions de son périmètre (`requireManager`). Après la refonte, il n'a plus que les droits d'un responsable sur ses propres actions ; la création depuis un écran source et la consultation du plan de son périmètre sont à trancher (**ACT-22**, [§ 8](#8-droits)).

## 4. Champs

Ordre du formulaire = ordre du formulaire Power Apps. Colonnes proposées pour `actions` (nouvelles en **gras**).

| Power Apps | Vigie (colonne) | Type | Valeurs | Obligatoire | Qui le renseigne | Quand |
|---|---|---|---|---|---|---|
| N° Action (verrouillé) | `id` | texte | numéro unique : « A-n » jusqu'à ACT-36, puis format AC ([§ 14](#14-numérotation)) | automatique | Vigie | à la création, jamais modifié ni réattribué |
| Date | **`opened_on`** | date | — | oui | Vigie (date du jour, heure de Paris) | à la création ; non modifiable ; reprise : date Power Apps |
| Responsable | `pilot_id` | personne | personnel actif | oui | QHSE | à la création ; modifiable par le QHSE (journalisé) |
| Avancement | `status` (valeurs nouvelles) | liste | 10 valeurs ([§ 5.1](#51-avancement)) | oui, « A faire » par défaut | QHSE | à tout moment ([§ 6](#6-cycle-de-vie)) |
| Priorité | **`priority`** | liste | Urgent, Moyen terme, Long terme | oui | QHSE (proposée d'après le niveau de risque, **ACT-38**) | à la création ; modifiable |
| Date cible | `due_on` + **`initial_due_on`** | date | — | oui | QHSE | à la création ; modifiable par le QHSE, date cible initiale conservée |
| Date effective | **`done_on`** | date | — | oui au passage « Terminée » | QHSE | au passage « Terminée » (par défaut le jour même) |
| Source | **`source`** (remplace `origin`) | liste | 22 sources ([§ 12](#12-sources-et-rattachements)) | oui | QHSE ou écran source | à la création ; verrouillée ensuite (ACT-01) |
| *(Vigie)* Élément lié et référence d'origine | `event_id`, colonnes de source, registre `action-links`, `origin_ref` | lien + texte | selon la source | référence obligatoire sans élément lié | QHSE ou écran source | à la création ; verrouillés ensuite |
| Domaine | **`domain`** | liste | Qualité, Sécurité, Santé, Environnement, Sûreté | oui | QHSE (proposé par la source) | à la création ; modifiable |
| Description du problème | **`problem`** | texte long (4 000 car.) | — | oui | QHSE (pré-rempli par l'écran source) | à la création ; modifiable |
| Détail de l'action | **`detail`** (remplace `title` + `description`) | texte long (4 000 car.) | — | oui | QHSE | à la création ; modifiable |
| Vérification planifiée | `verify_due_on` | date | — | oui | QHSE | à la création ; modifiable jusqu'à la vérification |
| Date de vérification | `closed_on` (sens : date de vérification = clôture) | date | — | oui au passage « Vérifiée » | QHSE | à la vérification |
| Nature de la vérification | **`verify_method`** | liste | Audit / visite, Écrit, Réunion, Visuelle, Autre | oui au passage « Vérifiée » | QHSE | à la vérification |
| Constat de vérification | `efficacy_note` | texte long | — | oui au passage « Vérifiée » | QHSE | à la vérification |
| *(Vigie)* Résultat | **`effective`** | oui/non | Efficace, Non efficace | oui au passage « Vérifiée » | QHSE | à la vérification |
| *(Power Apps : remarque du QHSE)* Nouveau risque généré | **`new_risk`** | case | — | non | QHSE | à la vérification |
| Niveau de risque | **`risk_level`** | liste | 0 à 4 ([§ 5.4](#54-niveau-de-risque)) | non | QHSE | à la création et à tout moment (journalisé) |
| Pointage (Hrs) | **`hours`** | nombre (h, 2 décimales) | ≥ 0 | non | QHSE | à la vérification (clôture) ; corrigeable par le QHSE |
| Coûts (€) | **`estimated_cost`**, **`actual_cost`** | montant € TTC (2 décimales) | ≥ 0 | non | QHSE | à tout moment |
| Commentaires | table **`action_comments`** | fil daté et signé | — | — | responsable, QHSE | à tout moment ([§ 9](#9-fil-de-commentaires)) |
| *(Vigie)* Site | `site_id` | site actif du périmètre | un seul | oui | QHSE (proposé par la source) | à la création ; transfert par le QHSE |
| *(Vigie)* Preuves | `attachments` (`entity_type = 'action'`) | fichiers | types et tailles actuels | non | responsable, QHSE | à tout moment ([§ 10](#10-preuves)) |
| *(Vigie)* Action précédente | **`follows_action_id`**, **`follow_reason`** | lien | non efficace, nouveau risque | automatique | Vigie | création d'une action de suite ([§ 7](#7-vérification-defficacité)) |
| *(Vigie)* Abandon | `cancelled_at`, `cancelled_by_id`, `cancel_reason` | horodatage, personne, motif | — | motif obligatoire | QHSE | passage « Abandonnée » |
| *(Vigie, retiré)* Nature C/P | `kind` | — | — | — | — | supprimée après reprise ([§ 18](#18-reprise-des-actions-existantes-de-vigie)) |
| *(Vigie, retiré)* Intitulé court, précisions | `title`, `description` | — | — | — | — | fusionnés dans « Détail de l'action » |

Règles de saisie (contrôlées par le serveur, `formReader`) :

- Date cible et vérification planifiée : pas avant la date d'ouverture ; une vérification planifiée antérieure à la date cible est signalée sans être refusée ; une date nouvellement saisie ne peut pas être dans le passé (sauf reprise et import).
- Date effective : entre la date d'ouverture et aujourd'hui. Date de vérification : entre la date effective et aujourd'hui.
- Responsable : personne active ; un responsable sorti de l'effectif reste affiché sur l'action existante (`withCurrent`) et signalé, jamais proposé pour un nouveau choix.
- Libellé court affiché partout où Vigie montrait l'intitulé (échéances, Kanban, fiches des autres écrans, dossier de revue) : première ligne du détail de l'action, tronquée à 90 caractères (`actionLabel()`).
- Aucune donnée de santé dans la description du problème, le détail ni les commentaires : l'action est visible du responsable et de l'encadrement. Une action créée depuis un accident du travail reprend l'intitulé neutre de l'événement, jamais un champ de `HEALTH_LABELS`, et le formulaire affiche le même avertissement que la fiche AT.

## 5. Listes de valeurs

Constantes dans `src/lib/domain.ts` (clé stockée en base, libellé affiché), testées dans `src/lib/domain.test.ts` ; l'import Power Apps rapproche les libellés sans tenir compte des accents, de la casse ni des espaces.

### 5.1 Avancement

| Clé | Libellé Vigie | Libellé Power Apps | Groupe | Peut être en retard |
|---|---|---|---|:-:|
| `a_faire` | À faire | A faire | ouverte | oui |
| `initiee` | Budgétée ou initiée | Budgétée ou initiée | ouverte | oui |
| `p20` | 20 % | 20 % | ouverte | oui |
| `p40` | 40 % | 40 % | ouverte | oui |
| `p60` | 60 % | 60 % | ouverte | oui |
| `p80` | 80 % | 80 % | ouverte | oui |
| `reportee` | Reportée | Reportée | en attente | non |
| `terminee` | Terminée — à vérifier | Terminée | réalisée | non (vérification suivie à part) |
| `verifiee` | Vérifiée | Vérifiée | close | non |
| `abandonnee` | Abandonnée | Abandonnée | close | non |

« En retard » n'est pas une valeur : il est calculé ([§ 6.3](#63-en-retard)).

### 5.2 Priorité

`urgent` Urgent · `moyen_terme` Moyen terme · `long_terme` Long terme.

### 5.3 Domaine

`qualite` Qualité · `securite` Sécurité · `sante` Santé · `environnement` Environnement · `surete` Sûreté.

### 5.4 Niveau de risque

Échelle propre aux actions (sans lien avec la cotation G × P du DUERP) : `0` Niveau 0 — Supprimé · `1` Niveau 1 — Maîtrisé durablement · `2` Niveau 2 — Maîtrisé ponctuellement · `3` Niveau 3 — Maîtrise en cours · `4` Niveau 4 — Non maîtrisé.

### 5.5 Nature de la vérification

`audit_visite` Audit / visite · `ecrit` Écrit · `reunion` Réunion · `visuelle` Visuelle · `autre` Autre.

## 6. Cycle de vie

### 6.1 Schéma

```
           ┌──────────── paliers libres, retour en arrière possible ────────────┐
création → À faire ⇄ Budgétée ou initiée ⇄ 20 % ⇄ 40 % ⇄ 60 % ⇄ 80 %
              │                     ⇅ Reportée (depuis et vers toute valeur ouverte)
              └──────────────→ Terminée (date effective) ──→ Vérifiée (vérification)
                                   │                          │ non efficace / nouveau risque
                                   │                          └→ nouvelle action liée (À faire)
toute valeur ouverte, Reportée ou Terminée ──→ Abandonnée (motif)
```

### 6.2 Transitions

Toutes les transitions sont faites par le QHSE ; le responsable n'en fait aucune. Chacune est journalisée (`logChange`, action `status`, détail `{ field: 'Avancement', from, to }` structuré pour les statistiques).

| De | Vers | Conditions | Effets |
|---|---|---|---|
| (création) | À faire | champs obligatoires ([§ 4](#4-champs)) | numéro attribué ; `initial_due_on` = date cible ; notification au responsable ([§ 15](#15-notifications-et-échéances)) |
| À faire, Budgétée ou initiée, 20–80 % | toute autre de ces valeurs | — (retour en arrière admis) | — |
| valeur ouverte | Reportée | motif facultatif (commentaire libre proposé) | sort des retards et du rappel hebdomadaire ; échéance « action » suspendue |
| Reportée | valeur ouverte choisie | — ; la fenêtre propose de revoir la date cible | reprend le suivi des retards |
| valeur ouverte ou Reportée | Terminée | date effective obligatoire | échéance de vérification adressée au QHSE |
| Terminée | valeur ouverte choisie | — | date effective effacée (valeur gardée au journal) |
| Terminée | Vérifiée | vérification complète ([§ 7](#7-vérification-defficacité)) | date de vérification = date de clôture ; actions de suite éventuelles |
| Vérifiée | Terminée (réouverture) | motif obligatoire (`ReasonForm`, ACT-05) | champs de vérification effacés (gardés au journal) ; une action de suite déjà créée reste en place |
| valeur ouverte, Reportée ou Terminée | Abandonnée | motif obligatoire (`formReader(fd).reason()`) | `cancelled_at/by/reason` ; détachée des sources détachables comme l'annulation actuelle (`detachAllLinks`) ; consultation seule ensuite |
| Abandonnée | — | — | état définitif, comme l'annulation actuelle |

Le formulaire de modification envoie l'avancement qu'il affichait : si l'action a changé entre-temps, la demande est refusée et la fiche actualisée (comportement actuel de `moveAction`).

Transitions faites par d'autres écrans (aujourd'hui : un recyclage enregistré fait passer l'action « Efficacité à vérifier » par une écriture directe, `src/server/skills.ts:152`) : à trancher avec **ACT-22**, puisque « Terminée » est réservé au QHSE.

### 6.3 En retard

Une action est **en retard** quand son avancement est À faire, Budgétée ou initiée, 20 %, 40 %, 60 % ou 80 %, et que sa date cible est passée (date du jour de Paris, `today()`). Reportée, Terminée, Vérifiée et Abandonnée ne sont jamais en retard. Le nombre de jours de retard est compté depuis la date cible actuelle.

Une **vérification en retard** est une action Terminée dont la vérification planifiée est passée : échéance du QHSE, distincte du retard de l'action.

Règle pure unique (`actionLate()`, `src/lib/queries.ts` ou module de règles des actions), utilisée par la vue générale, les échéances, le tableau de bord, le rappel hebdomadaire, les statistiques et les autres écrans.

## 7. Vérification d'efficacité

- **Planifiée dès la création** : « Vérification planifiée » est obligatoire au formulaire ; le QHSE peut la déplacer jusqu'à la vérification (journalisé).
- **Faite par le QHSE**, depuis une action Terminée, par la fenêtre « Vérifier l'efficacité » :
  - date de vérification (par défaut aujourd'hui) — c'est la date de clôture ;
  - nature de la vérification (liste du [§ 5.5](#55-nature-de-la-vérification)) ;
  - constat de vérification (texte obligatoire) ;
  - résultat : **Efficace** ou **Non efficace** (obligatoire) — ajouté par Vigie pour distinguer le constat « non efficace » sans lire le texte, base du taux d'efficacité ;
  - case **Nouveau risque généré** (non cochée par défaut), avec la description du risque ;
  - pointage (heures), proposé ici puisqu'il est saisi à la clôture ([§ 11](#11-pointage-et-coûts)).
- **Non efficace** : l'action passe Vérifiée avec ce résultat, et la même fenêtre ouvre une section « Nouvelle action » pré-remplie : source, élément lié, référence d'origine, domaine, priorité, niveau de risque, site et responsable de l'action vérifiée ; description du problème « Action <numéro> jugée non efficace le JJ/MM/AAAA : <constat> » ; restent à saisir le détail de l'action, la date cible et la vérification planifiée. La vérification et la nouvelle action sont enregistrées dans la même transaction (aucune vérification non efficace sans sa suite). La nouvelle action porte `follows_action_id` et `follow_reason = 'non_efficace'` ; les deux fiches affichent le lien.
- **Nouveau risque généré** : même mécanisme, `follow_reason = 'nouveau_risque'`, description du problème = description du risque saisie dans la fenêtre. Si l'action est à la fois non efficace et génératrice d'un nouveau risque, deux actions de suite sont créées.
- **Rattachement de l'action de suite** : elle est rattachée à l'élément lié de l'action vérifiée quand il accepte encore une action (un événement clos ou classé sans suite la refuse aujourd'hui, `addActionBlocker`) ; sinon elle garde la référence d'origine et le lien vers l'action précédente (voir [§ 22](#22-points-ouverts), point 12).
- **Échéances** : vérification planifiée dans les 15 jours, puis dépassée, pour une action Terminée : adressées au responsable QHSE du site (`loadQhseLeads`) seulement, pas au responsable de l'action, qui ne peut pas la faire (ACT-14).
- Effets sur les sources : une action Vérifiée compte comme close pour les écrans sources (événement « Efficacité vérifiée », risque « résiduel à recoter », exigence, contrôle) ; une action de suite ouverte rattachée au même élément le maintient ouvert.

## 8. Droits

| Capacité | Responsable | QHSE (animateur QHSE, direction) | Encadrement hors QHSE | Salarié non responsable |
|---|:-:|:-:|:-:|:-:|
| Consulter ses actions (tous sites, comme ses échéances, TDB-05) | oui | oui | oui (les siennes) | — |
| Consulter le plan de son périmètre | — | oui | à trancher (**ACT-22** ; proposition : lecture seule, comme aujourd'hui) | non |
| Créer une action (plan, écrans sources) | — | oui | à trancher (**ACT-22**) | non |
| Modifier les champs | non | oui | non | non |
| Changer l'avancement, reporter, terminer | non | oui | non | non |
| Vérifier, créer les actions de suite | non | oui | non | non |
| Abandonner, rouvrir (motif) | non | oui | non | non |
| Commenter | oui | oui | non | non |
| Joindre une preuve | oui | oui | non | non |
| Retirer une preuve | la sienne, avant « Vérifiée » | oui, avant « Vérifiée » | non | non |
| Statistiques | — | oui | selon la consultation du plan | non |

Côté serveur : écritures sur les champs et l'avancement par `requireApprover()` puis `requireInSite(siteId)` après chargement (avec `{ create: true }` à la création et au transfert) ; commentaires et preuves : `requireInSite` puis contrôle « responsable de l'action ou QHSE ». Côté page : un rôle sans droit d'écriture reçoit la fiche sans listes de formulaire (convention `isReadOnly` / `canEdit`). Le Salarié ne reçoit que ses actions, leurs commentaires et leurs preuves (charge RSC contrôlée par `test/e2e/employee-payload.test.ts`).

## 9. Fil de commentaires

- Table `action_comments` : `id`, `action_id`, `author_id`, `body` (4 000 caractères au plus), `created_at` ; retrait : `withdrawn_at`, `withdrawn_by_id`, `withdraw_reason`.
- Affichage chronologique sur la fiche : date et heure de Paris, nom et rôle de l'auteur (« signé »), texte ; preuves jointes au commentaire affichées dessous.
- Auteurs : le responsable et le QHSE, à tout avancement (y compris Vérifiée et Abandonnée, pour le QHSE comme pour le responsable).
- Pas de modification. Un commentaire peut être retiré par son auteur ou par le QHSE, avec un motif : il reste au fil sous la mention « Commentaire retiré le … par … », texte masqué (jamais de suppression physique).
- Journal : chaque ajout et retrait est tracé (`logChange`, entité `action`) ; le fil et l'historique sont chargés à l'ouverture de la fiche, pas pour toute la liste (QUA-11).
- Recherche : le texte des commentaires n'entre pas dans la recherche libre de la vue générale (voir [§ 16](#16-vue-générale-et-filtres)).
- Avertir le QHSE d'un nouveau commentaire ou d'une preuve : à trancher (**ACT-31**).

## 10. Preuves

- Infrastructure actuelle : pièces jointes `entity_type = 'action'` (`addActionFiles`, `removeActionFile`, `src/lib/uploads.ts`, chiffrées au repos, servies par `/fichiers/[id]`), mêmes types et tailles.
- Ajout : par le responsable et le QHSE (aujourd'hui : tout l'encadrement ou le pilote), seules ou avec un commentaire ; jamais sur une action Abandonnée.
- Retrait (pièce ajoutée par erreur, seule suppression admise) : par l'auteur de l'envoi ou le QHSE, tant que l'action n'est pas Vérifiée ; journalisé.
- Preuve facultative : aucune transition ne l'exige (la question d'ACT-10 « preuve obligatoire ? » est tranchée par le formulaire Power Apps, qui n'en a pas).

## 11. Pointage et coûts

- **Pointage (h)** : temps réellement passé, une seule valeur, saisie par le QHSE à la clôture (proposée dans la fenêtre de vérification), corrigeable ensuite par le QHSE.
- **Coût estimé** et **coût réel** (€ TTC, sans le temps) : saisis par le QHSE à tout moment, y compris après la vérification.
- Affichage : fiche (bloc « Pointage et coûts ») ; total des coûts et du pointage des actions affichées dans la vue Liste.
- PAPRIPACT (DUE-02) : la ligne du programme annuel propose le coût estimé de l'action ; le coût de la ligne reste figé avec le programme à la consultation du CSE.

## 12. Sources et rattachements

Une action a **une seule source**, choisie parmi les 22 du service QHSE, verrouillée après la création (ACT-01), et **un seul événement ou audit lié** (l'élément de sa source quand elle désigne un événement ou un audit). La référence d'origine (`origin_ref`, texte) reste : elle désigne l'élément quand la source n'a pas de fiche dans Vigie, et sert de libellé. Les écrans sources lisent les colonnes de rattachement, jamais la référence texte.

| # | Source (libellé QHSE) | Clé | Élément Vigie lié (cible) | Origine Vigie actuelle reprise |
|--:|---|---|---|---|
| 1 | Analyse de risque (AST-EST) | `analyse_risque` | libre (référence) — sens d'AST-EST à préciser (**ACT-37**) | — |
| 2 | Analyse de risque chimique | `analyse_chimique` | libre (référence) ; inventaire des produits à venir (CNF-06) | — |
| 3 | Analyse environnementale | `analyse_environnementale` | filière, enlèvement ou registre des déchets (colonnes `waste_stream_id`, `waste_entry_id`), sinon libre | `env` (proposé, **ACT-37**) |
| 4 | Audit de certification ISO | `audit_certification` | élément du programme d'audit (ligne « Certification ») ou constat | `audit` (élément de la ligne Certification) |
| 5 | Audit interne ISO | `audit_interne` | élément du programme (ligne « Audits internes ») ou constat | `audit` (par défaut) |
| 6 | Audit terrain | `audit_terrain` | élément du programme (ligne « Visites sécurité ») ou constat | `audit` (ligne Visites sécurité) |
| 7 | Autorité publique | `autorite_publique` | libre (courrier, mise en demeure, inspection) | — |
| 8 | Causerie QSE | `causerie` | libre (causeries à venir, CNF-09) | — |
| 9 | COMEX | `comex` | libre | — |
| 10 | Contrôle réglementaire | `controle_reglementaire` | contrôle périodique (réserves) | `watch` rattachée à un contrôle |
| 11 | DUERP | `duerp` | risque du DUERP | `risk` |
| 12 | Évènement QSE | `evenement` | événement (`event_id`) | `ev` |
| 13 | Objectif QSE | `objectif` | décision de revue de nature « Objectif » (objectifs mesurables à venir, AUD-13) | `rev` rattachée à une décision « objectif » |
| 14 | Réclamation client | `reclamation_client` | événement de type RC (`event_id`) | `client` |
| 15 | Réunion opérationnelle | `reunion_operationnelle` | libre | — |
| 16 | Revue de direction | `revue_direction` | revue ou décision de revue | `rev` (autres cas) |
| 17 | Revue documentaire | `revue_documentaire` | document ou version (`document_id`, `docversion`) | `docs` |
| 18 | Revue de processus | `revue_processus` | libre | — |
| 19 | Veille réglementaire | `veille` | exigence de veille | `watch` (autres cas) |
| 20 | HAZOP | `hazop` | libre (référence de l'étude) | — |
| 21 | Réserves | `reserves` | à préciser (**ACT-37**) : réserves d'un contrôle réglementaire, ou réserves de réception d'un chantier ; libre en attendant | — |
| 22 | REX | `rex` | libre (référence du retour d'expérience) | — |

Règles :

- Création depuis un écran source (`NewActionButton`, champ `link`) : la source et l'élément lié sont imposés ; le domaine est proposé (événement AT, PA, SD → Sécurité ; NC, RC → Qualité ; ENV → Environnement ; risque du DUERP → Sécurité ; exigence → domaine de l'exigence quand il correspond ; document → Qualité), modifiable.
- Création depuis le plan : la source est choisie ; pour une source à cible, un sélecteur propose l'élément (événements ouverts aux actions seulement, ACT-07 ; constats et éléments du programme ; risques ; exigences ; contrôles ; revues et décisions ; documents) ; à défaut d'élément, la référence d'origine est obligatoire (règle actuelle de `saveAction`).
- Aucun autre événement ni audit ne peut être rattaché ensuite (`action-links` refuse) ; la source ne se change pas.
- Écrans qui créent aujourd'hui des actions sans source correspondante dans la liste du QHSE : Habilitations (recyclage planifié), Prévention (plan de prévention, permis, coactivité), Environnement (filières, enlèvements, registre des déchets ; proposition : Analyse environnementale), audits fournisseurs : source à trancher (**ACT-37**). En attendant, le QHSE choisit la source dans le formulaire (pas de source imposée).
- Rattachements complémentaires existants (risque du DUERP traité, ligne du PAPRIPACT, exigence, contrôle, recyclage) : maintenus en plus de la source tant que le point 10 du [§ 22](#22-points-ouverts) n'est pas tranché ; ils ne peuvent jamais ajouter d'autre événement ni d'audit.

## 13. Site

- Une action porte **un seul site**, obligatoire : « Tous les sites » n'est plus proposé (ACT-06 et réserve de SEC-02 levés).
- Site proposé : celui de l'élément lié quand il en a un ; sinon le site sélectionné ; sous « Tous les sites », à choisir. Liste : sites actifs que `requireInSite(…, { create: true })` accepte (`writableSites()`).
- Éléments communs à l'entreprise (revue de direction et ses décisions, exigence de veille, programme d'audit et constats, qui n'ont pas de site) : le QHSE choisit le site de l'action (aujourd'hui, `ReviewPanel` crée ces actions sous « Tous les sites »).
- Transfert vers un autre site : QHSE seulement, vers un site actif, et jamais hors du site de la source d'origine (règle actuelle `originSiteOf`).
- Actions existantes sans site (« Tous les sites ») : conservées ainsi par la reprise, marquées « site à compléter » ([§ 18](#18-reprise-des-actions-existantes-de-vigie)) ; toute modification exige un site.

## 14. Numérotation

Décidé :

- un numéro unique par action, attribué à la création, jamais modifié, **jamais réattribué** (une action abandonnée garde le sien, un numéro n'est jamais libéré) ;
- les actions reprises de Power Apps gardent leur numéro AC exact ;
- format visé : « AC- » + année sur deux chiffres + numéro (exemple du service : AC-260150).

À rechercher par le service QHSE (**ACT-36**, classe C3) : le compteur repart-il à 0001 chaque année (AC-270001 au début de 2027) ou continue-t-il d'une année sur l'autre ; combien de chiffres après l'année. Hypothèse à vérifier : si Power Apps s'appuie sur une liste SharePoint, le numéro peut être l'identifiant de l'élément de la liste (compteur continu), précédé de l'année d'ouverture.

Mise en œuvre :

- **ACT-35** (sans attendre) : compteur en base (table `action_counters` : portée → dernier numéro), incrémenté sous verrou dans la transaction de création (corrige pour les actions le risque de doublon de PRD-08 : aujourd'hui `nextRef` hors transaction, `src/server/plan.ts:155`) ; contrainte d'unicité ; fonction de format isolée (`formatActionNumber`) ; l'import positionne le compteur au-delà du plus grand numéro repris. Tant que le format n'est pas tranché, Vigie garde le format actuel « A-n ».
- **ACT-36** (après la recherche) : format AC-AA####, portée du compteur (année ou unique) et nombre de chiffres. Vigie n'émet aucun numéro AC avant l'import de l'extraction Power Apps, pour ne jamais en attribuer un déjà pris dans Power Apps.
- Actions existantes de Vigie (A-n, bases de démonstration et de l'application Mac) : elles gardent leur numéro (jamais renuméroté, les liens `/actions?action=A-214`, le journal et les rattachements en dépendent).

## 15. Notifications et échéances

### 15.1 Notification à la création — dans Vigie seulement

- À la création d'une action, son responsable reçoit dans la cloche une notification d'information « Action <numéro> confiée par <auteur> : <libellé> », avec le lien vers la fiche. Jamais d'e-mail.
- Pas de notification quand le responsable est l'auteur de la création.
- Première notification d'information de Vigie (aujourd'hui la cloche ne montre que des échéances calculées, `src/lib/data/notifications.ts`) : table `notifications` (personne, type, entité, libellé, lien, créée le, lue le), affichée dans la cloche avec les échéances, comptée comme non lue, marquée lue au clic ou par « Tout marquer comme lu » ; réutilisable pour TDB-06.

### 15.2 Rappel hebdomadaire du mercredi — dans Vigie et par e-mail

- Destinataires : chaque responsable qui a au moins une action en cours ; pas de synthèse pour le QHSE (un membre du QHSE reçoit seulement le rappel de ses propres actions de responsable).
- Contenu : toutes ses actions en cours — À faire, Budgétée ou initiée, 20 % à 80 % — sur tous les sites ; les actions en retard d'abord, signalées (jours de retard), puis par date cible ; pour chacune : numéro, libellé, avancement, date cible, site. Reportées et Terminées exclues (à confirmer, [§ 22](#22-points-ouverts) point 11).
- **Dans Vigie** (**ACT-32**) : élément de la cloche daté du mercredi (heure de Paris), clé d'état lu par semaine (« rappel-actions|2026-W42 »), visible jusqu'à sa lecture ou jusqu'au mercredi suivant, lien vers la vue générale filtrée sur ses actions (`/actions?mes=1`). Calculé à partir de la date du jour (`today()`, `VIGIE_TODAY` en démonstration) : aucune tâche planifiée nécessaire.
- **Par e-mail** (**ACT-33**, **ACT-34**) : un message par responsable le mercredi matin (heure fixée dans la configuration, 7 h de Paris par défaut), à l'adresse de sa fiche (`people.email`, issue d'Entra ID ou de l'import) ; objet « Vigie · vos actions QSE en cours (n, dont m en retard) » ; tableau des actions, lien vers Vigie (`publicOrigin()`). Personne sans adresse : rappel dans Vigie seulement, absence notée au journal d'envoi. Journal d'envoi en base (personne, semaine, statut, erreur) : un seul envoi par personne et par semaine, même après un redémarrage ; nouvel essai en cas d'échec. Exécution par les tâches planifiées (PRD-12, sur le modèle de `src/db/maintenance.ts`) ; en démonstration et dans les tests, transport « fichier » (aucun envoi réel). Envoi réel : compte d'envoi de l'entreprise (relais SMTP ou Microsoft Graph `Mail.Send` avec consentement de l'administrateur du tenant) ; variables dans `src/lib/env.ts`, `.env.example` et le § 4 de `docs/EXPLOITATION.md`.

### 15.3 Échéances calculées (`loadActionSignals`, À faire, badges)

| Échéance | Condition | Destinataires (`ownerIds`) |
|---|---|---|
| Action en retard | [§ 6.3](#63-en-retard) | responsable |
| Action à échéance | valeur ouverte, date cible dans les 15 jours | responsable |
| Vérification à venir | Terminée, vérification planifiée dans les 15 jours | responsable QHSE du site |
| Vérification dépassée | Terminée, vérification planifiée passée | responsable QHSE du site |
| Action à compléter | action reprise ou importée sans un champ obligatoire | responsable QHSE du site |

Reportée et Abandonnée ne produisent aucune échéance. Les échéances portent `siteId` de l'action ; elles restent visibles pour le responsable sur tout son périmètre (TDB-02, TDB-05).

## 16. Vue générale et filtres

- Vue **Liste** (vue générale, par défaut) : N°, Date, Responsable, Avancement (retard signalé), Priorité, Date cible, Source, Domaine, libellé, Site ; tri par défaut : retards, puis date cible.
- Vue **Kanban** conservée, colonnes regroupées : À faire · En cours (Budgétée ou initiée, 20–80 %, palier indiqué sur la carte) · En retard · Reportée · Terminée — à vérifier · Vérifiée (30 derniers jours ; toutes en historique). Vue **Par responsable** conservée.
- **Filtres**, portés par l'URL et communs aux trois vues : avancement (une valeur, « Ouvertes » ou « En retard »), responsable (dont « Mes actions »), source, priorité, texte libre (numéro, description du problème, détail de l'action, référence d'origine, motif d'abandon). Affichage : plan en cours (ouvertes, Reportées, Terminées et Vérifiées depuis 30 jours), historique complet, Abandonnées.
- Liens profonds : `?avancement=`, `?retard=1`, `?responsable=`, `?mes=1`, `?source=`, `?priorite=`, `?q=` (une fiche événement ouvre `/actions?q=EV-2026-131&etat=historique`, EVT-26 ; les KPI du tableau de bord ouvrent la liste filtrée, TDB-12).
- Pas de vues enregistrées, pas d'export.
- Périmètre : site sélectionné (« Tous les sites » consolide), et pour chacun ses propres actions sur tous les sites de son périmètre.

## 17. Statistiques mensuelles

Onglet « Statistiques » de `/actions` (`?vue=statistiques`, pas de nouvelle route), calculées à la demande dans `src/lib/queries.ts`, jamais stockées, sur le site sélectionné ou tout le périmètre ; mois choisi, avec les 12 mois précédents pour les évolutions. Abandonnées exclues des taux, comptées dans la répartition par avancement.

| Indicateur | Définition proposée |
|---|---|
| Répartition par avancement, source, domaine, responsable, niveau de risque | nombre d'actions (base à trancher : état du plan à la fin du mois, ou actions ouvertes dans le mois — **ACT-29**) |
| Taux de retard | actions en retard / actions ouvertes (À faire à 80 %), à la fin du mois |
| Délai moyen de clôture | moyenne, en jours, de (date de vérification − date d'ouverture) des actions Vérifiées dans le mois |
| Taux d'efficacité | actions Vérifiées « Efficace » / actions Vérifiées dans le mois |
| Évolution mensuelle ouvertes / clôturées | actions ouvertes (date d'ouverture) et clôturées (date de vérification) par mois, sur 12 mois |
| Respect des dates cibles | actions Terminées dans le mois dont la date effective ≤ date cible (initiale ou actuelle : à trancher, **ACT-29**) / actions Terminées dans le mois |

L'état d'une action à une date passée est reconstitué à partir du journal (détail structuré des changements d'avancement) ; pour les actions reprises ou importées sans historique, l'avancement connu est réputé atteint à la date de reprise. La section « Plan d'actions » du dossier de revue de direction (`src/lib/data/review.ts`, répartition par origine) passe aux sources ; les dossiers déjà figés restent lus tels quels.

## 18. Reprise des actions existantes de Vigie

Aucune base de production n'existe encore (connexion Entra non inscrite dans le tenant) : les bases concernées sont celles de démonstration, de l'application Mac et d'éventuels essais. La reprise est faite dans la migration de la refonte (SQL déterministe), sans inventer de valeur : un champ obligatoire qui ne se déduit pas reste vide et l'action est marquée « à compléter » (filtre de la vue générale, échéance du QHSE) ; le formulaire exige ce champ à la prochaine modification. Chaque action reprise reçoit une entrée de journal « Reprise du modèle Power Apps » détaillant les valeurs transformées.

| Actuel | Nouveau |
|---|---|
| `todo` À lancer | À faire |
| `doing` En cours | Budgétée ou initiée (prudent : aucun palier de progression supposé ; à confirmer, [§ 22](#22-points-ouverts) point 14) |
| `verify` Efficacité à vérifier | Terminée ; date effective = date du changement « Déclarée réalisée » au journal, sinon vide (à compléter) ; vérification planifiée = `verify_due_on` |
| `done` Clôturée | Vérifiée ; date de vérification = `closed_on` ; constat = `efficacy_note` ; résultat = Efficace (la clôture exigeait une efficacité vérifiée) ; nature vide ; date effective = date du dernier « Déclarée réalisée », sinon date de vérification |
| `cancelled` Annulée | Abandonnée ; motif, auteur et date conservés |
| `title` + `description` | Détail de l'action = intitulé, puis les précisions à la ligne |
| — | Description du problème : vide (à compléter) |
| `origin` | source : `ev` → Évènement QSE ; `client` → Réclamation client ; `risk` → DUERP ; `docs` → Revue documentaire ; `audit` → Audit de certification ISO, Audit terrain ou Audit interne ISO selon la ligne du programme de l'élément ou du constat lié (défaut : Audit interne ISO) ; `watch` → Contrôle réglementaire si un contrôle porte l'action, sinon Veille réglementaire ; `rev` → Objectif QSE si une décision « objectif » porte l'action, sinon Revue de direction ; `env`, `skills`, `prevention` → vide (à compléter) jusqu'à **ACT-37** |
| `kind` C/P | supprimé (valeur gardée dans l'entrée de journal de reprise) |
| `created_at` | Date d'ouverture = date de Paris de `created_at` |
| `due_on` | Date cible et date cible initiale |
| `site_id` null (Tous les sites) | conservé, marqué « site à compléter » |
| Domaine, priorité, niveau de risque, pointage, coûts | vides (domaine et priorité : à compléter) |

Le jeu de démonstration (`src/db/seed.ts`, `src/db/seeds/*.ts`) est réécrit dans le nouveau modèle (toutes les valeurs d'avancement, commentaires, preuves, actions de suite, une action Reportée, des retards) ; `test/integration/demo-upgrade.test.ts` vérifie la mise à niveau d'une base de démonstration existante.

## 19. Import de l'extraction Power Apps

Prérequis : l'extraction, fournie plus tard par le propriétaire de l'application (classe C3, **ACT-39**), et la règle de numérotation (**ACT-36**).

- Commande `npm run db:import-actions -- <fichier> [--appliquer]` (`vigie-db import-actions` dans l'image) : d'abord un essai qui n'écrit rien et produit un rapport (lignes lues, valeurs non reconnues, responsables introuvables, numéros en double, champs obligatoires manquants) ; puis l'application, dans une transaction, après une sauvegarde (`db:backup`), sur une copie restaurée d'abord (`db:test-migrate`).
- Correspondance des colonnes : celles du [§ 4](#4-champs) ; libellés de liste rapprochés sans accents, casse ni espaces ([§ 5](#5-listes-de-valeurs)) ; valeur non reconnue = refus de la ligne dans le rapport, jamais de valeur par défaut silencieuse.
- Numéro AC repris tel quel (clé d'idempotence : une ligne déjà importée n'est pas réimportée) ; compteur positionné au-delà du plus grand numéro.
- Responsable : rapproché par adresse e-mail (`people.email`), sinon par nom exact ; une personne absente de Vigie : fiche à créer ou ligne refusée (à trancher avec l'extraction, [§ 22](#22-points-ouverts) point 16).
- Site : colonne de l'extraction si elle existe, sinon site de rattachement du responsable, sinon « site à compléter ».
- Événement ou audit lié : rattaché quand le numéro cité existe dans Vigie, sinon gardé en référence d'origine.
- Commentaires Power Apps : repris comme commentaires datés et signés quand l'historique est structuré, sinon en un seul commentaire « Historique Power Apps » daté de l'import ; pièces jointes reprises si l'extraction les contient (SharePoint).
- Journal : « Importée de Power Apps le … » sur chaque action ; actions importées sans un champ obligatoire : marquées « à compléter ».
- Aucune notification de création ni rappel déclenché par l'import (le rappel du mercredi suivant les inclut).

## 20. Écarts avec le code actuel et impacts

| Fichier | Aujourd'hui | Après la refonte |
|---|---|---|
| `src/db/schema.ts` (table `actions`, l. 211-243) | `title`, `description`, `origin` (10 valeurs), `status` (todo, doing, verify, done, cancelled), `kind`, `verify_due_on`, `efficacy_note`, `verified_by_id`, `closed_on`, annulation ; `site_id` null = tous les sites ; aucune date d'ouverture, priorité, domaine, problème, nature et date de vérification, niveau de risque, pointage, coûts, commentaires | colonnes du [§ 4](#4-champs) ; tables `action_comments`, `action_counters`, `notifications`, journal d'envoi des e-mails ; une seule migration `drizzle/0005_…` (enregistrée dans `drizzle/checksums.json`), reprise comprise ; `kind`, `title`, `description` supprimés après reprise |
| `src/lib/domain.ts` (l. 95-137) | `ACTION_COLUMNS`, `ACTION_STATUSES`, `isOpenActionStatus`, `PLAN_SCOPES`, `ORIGINS`, `EVENT_ORIGINS` | listes du [§ 5](#5-listes-de-valeurs) et des sources du [§ 12](#12-sources-et-rattachements), groupes d'avancement, règles pures (transitions, retard) ; `ROLES` selon **ACT-22** |
| `src/lib/queries.ts` (`actionColumn` l. 62, `actionView` l. 204, `actionBrief` l. 226) | colonne déduite du statut et de l'échéance ; « Corrective / Préventive » | règle de retard du [§ 6.3](#63-en-retard), libellé `actionLabel()`, groupes Kanban |
| `src/components/ActionFormDialog.tsx` | Action, Précisions, Origine, Référence d'origine, Événement lié, Pilote, Échéance, Nature, Site (avec « Tous les sites »), vérification en modification seulement | formulaire du [§ 4](#4-champs) dans l'ordre Power Apps ; source et élément lié par sélecteur selon la source ; site unique ; vérification planifiée obligatoire dès la création ; `ActionDefaults` : `detail`, `problem`, `source`, `domain` au lieu de `title`, `description`, `origin`, `kind` |
| `src/server/plan.ts` (`saveAction` l. 37, `addActionFiles` l. 178, `removeActionFile` l. 206) | `requireManager` (tout l'encadrement) ; `nextRef` hors transaction (l. 155) ; `diffFields` sans `verifyDueOn`, `kind`, `description` (ACT-04) ; preuves par l'encadrement ou le pilote | `requireApprover` (QHSE ; création par l'encadrement selon **ACT-22**) ; compteur sous verrou ; journal de tous les champs ; preuves par le responsable ou le QHSE ; commentaires (nouvelles actions) |
| `src/server/plan-ui.ts` (`moveAction` l. 43, `PILOT_MOVES` l. 20, `ALLOWED` l. 26, `cancelAction` l. 96) | Démarrer, Déclarer réalisée (pilote salarié compris), Clôturer, Efficacité insuffisante, Rouvrir sans motif (ACT-05), Annuler | changement d'avancement, Terminer, Vérifier (avec actions de suite), Abandonner, Rouvrir avec motif ; aucune transition pour le responsable |
| `src/server/plan-core.ts` (`applyActionStatus` l. 23) | transitions vers verify, done, doing, todo | transitions du [§ 6.2](#62-transitions), détail structuré au journal |
| `src/lib/data/actions.ts` (`loadActionPlan` l. 225, `filterPlan` l. 273, `loadActionSignals` l. 289) | filtres origine, pilote, texte ; vérifications adressées au pilote et au responsable QHSE ; retard sur todo et doing | filtres du [§ 16](#16-vue-générale-et-filtres) ; échéances du [§ 15.3](#153-échéances-calculées-loadactionsignals-à-faire-badges) ; fil, preuves et historique chargés à l'ouverture de la fiche |
| `src/components/actions/ActionDetail.tsx`, `KanbanBoard.tsx` (5 colonnes), `src/app/(app)/actions/page.tsx` | boutons du cycle actuel ; Kanban, Liste, Par pilote | fiche avec blocs Problème, Action, Planification, Source, Vérification, Pointage et coûts, Fil, Historique ; Kanban regroupé (6 colonnes), Liste par défaut, Par responsable, Statistiques |
| `src/lib/action-links.ts`, `src/lib/origin-links.ts`, `scripts/vigie-db.ts` (`reprise-liens`) | origines `prevention`, `docs`, `env` ; `isClosedActionStatus` (done, cancelled) ; plusieurs rattachements possibles | sources ; close = Vérifiée ou Abandonnée ; un seul événement ou audit lié |
| Écrans qui créent des actions (`EventActions`, `RiskSheet`, `FindingsCard`, `ProgramTimeline`, `ReviewPanel`, `RequirementsPanel`, `ControlsPanel`, `SkillMatrix`, `SkillAlerts`, `skills/common.tsx`, `PlanDialogs`, `PermitDialogs`, `SiteMapScreen`, `DocumentPanel`, `environment/parts.tsx`) | `origin`, `kind`, `title` imposés ; `siteId: null` pour la revue | source, domaine proposé, description du problème pré-remplie ; site unique |
| Écrans qui lisent les actions (`src/components/events/shared.ts` l. 10-57, `src/lib/data/risks.ts` l. 126 et 219-268, `review.ts` l. 626-741, `dashboard.ts` l. 113-133, `documents.ts` l. 108 et 257, `environment.ts` l. 398-414, `skills.ts`, `audits.ts`, `prevention.ts`, `sitemap.ts`, `watch.ts`, `options.ts` l. 47) | statuts et libellés actuels, intitulé, origine | groupes d'avancement, `actionLabel()`, sources ; recyclage enregistré (`src/server/skills.ts:152`) selon **ACT-22** |
| Notifications (`src/lib/data/notifications.ts`, `NotificationBell.tsx`, `src/server/notifications.ts`, `todo.ts`, `counters.ts`) | échéances calculées seulement | notifications d'information stockées + rappel du mercredi |
| Tâches planifiées et e-mail (`src/db/maintenance.ts`, `src/instrumentation.ts`, `src/lib/env.ts`, `.env.example`, `docs/EXPLOITATION.md` § 4) | maintenance horaire seulement, aucun envoi d'e-mail | tâche du mercredi, transport d'e-mail, nouvelles variables |
| Tests (`test/integration/*actions*.test.ts`, `employee-isolation.test.ts`, `demo-upgrade.test.ts`, `test/e2e/employee-payload.test.ts`) | cycle actuel | droits, site, motif et journal de chaque nouvelle server action ; reprise ; cloisonnement des commentaires et preuves |
| `CLAUDE.md` | conventions du plan actuel | avancement, sources, rôles du QHSE et du responsable, notifications d'information |

## 21. Découpage en éléments du backlog

24 éléments (ACT-17 à ACT-40) — P1 : 21 · P2 : 3 — S : 11 · M : 11 · L : 2 — charge indicative 22,5–64 j. Classes de dépendance :

- **C1 « Prêt à développer »** — aucune dépendance externe, décisions prises ;
- **C2 « À valider »** — une décision interne rapide (responsable produit ou service QHSE) ; la question est indiquée ;
- **C3 « En attente d'éléments »** — informations ou données à fournir ;
- **C4 « Dépend d'un tiers technique »** — système externe ou infrastructure.

### C1 — Prêt à développer (16 éléments, 15,5–45 j)

| Réf | Élément | Prio. | Taille | Dépend de |
|---|---|:-:|:-:|---|
| ACT-17 | Modèle de données des actions QSE (schéma et migration) | P1 | M | — |
| ACT-18 | Listes et règles du domaine Actions | P1 | S | — |
| ACT-19 | Reprise des actions existantes de Vigie | P1 | M | ACT-17, ACT-18 |
| ACT-20 | Formulaire « Créer une action » aligné sur Power Apps | P1 | M | ACT-17, ACT-18 |
| ACT-21 | Avancement et droits : QHSE et responsable | P1 | M | ACT-17, ACT-18 |
| ACT-23 | Vérification d'efficacité et actions de suite | P1 | M | ACT-20, ACT-21 |
| ACT-24 | Fil de commentaires daté et signé | P1 | M | ACT-17, ACT-21 |
| ACT-25 | Preuves jointes par le responsable | P1 | S | ACT-21, ACT-24 |
| ACT-26 | Pointage et coûts | P1 | S | ACT-20, ACT-23 |
| ACT-27 | Vue générale et filtres | P1 | M | ACT-18, ACT-21 |
| ACT-28 | Adapter les écrans qui créent ou lisent des actions | P1 | L | ACT-18, ACT-20, ACT-21 |
| ACT-30 | Notification « Action confiée » dans la cloche | P1 | M | ACT-17 |
| ACT-32 | Rappel du mercredi dans Vigie | P1 | S | ACT-18, ACT-27 |
| ACT-33 | Rappel du mercredi par e-mail : contenu, planification, journal d'envoi | P1 | M | ACT-32, PRD-12 |
| ACT-35 | Numérotation unique, jamais réattribuée | P1 | S | ACT-17 |
| ACT-40 | Tests de bout en bout et de migration de la refonte | P1 | M | ACT-19, ACT-21, ACT-23, ACT-24, ACT-25, ACT-30, ACT-32, ACT-33 |

PRD-12 (tâches planifiées, C1) est à livrer avec ACT-33.

### C2 — À valider (5 éléments, 3–7 j)

| Réf | Élément | Prio. | Taille | Question |
|---|---|:-:|:-:|---|
| ACT-22 | Encadrement hors QHSE et transitions faites par les autres écrans | P1 | S | Qui crée une action hors QHSE, l'encadrement voit-il le plan de son périmètre, et que fait un recyclage enregistré ? |
| ACT-29 | Statistiques mensuelles | P2 | M | Base des répartitions mensuelles ; date cible de référence |
| ACT-31 | Avertir le QHSE des commentaires et preuves du responsable | P2 | S | Le QHSE est-il averti, et lequel ? |
| ACT-37 | Source des actions créées par Habilitations, Prévention, Environnement et audits fournisseurs | P1 | S | Quelle source pour ces actions ; sens de « Réserves » et d'« AST-EST » |
| ACT-38 | Priorité proposée d'après le niveau de risque | P2 | S | Quelle correspondance niveau → priorité ? |

### C3 — En attente d'éléments (2 éléments, 3,5–11 j)

| Réf | Élément | Prio. | Taille | Élément attendu |
|---|---|:-:|:-:|---|
| ACT-36 | Format des numéros AC-AA#### | P1 | S | Règle actuelle de numérotation AC (compteur annuel ou continu, nombre de chiffres), recherchée par le service QHSE |
| ACT-39 | Import de l'extraction Power Apps | P1 | L | Extraction de toutes les actions, par le propriétaire de l'application Power Apps |

### C4 — Dépend d'un tiers technique (1 élément, 0,5–1 j)

| Réf | Élément | Prio. | Taille | Tiers |
|---|---|:-:|:-:|---|
| ACT-34 | Compte d'envoi des e-mails | P1 | S | Relais SMTP de la messagerie ou Microsoft Graph `Mail.Send` (consentement de l'administrateur du tenant Entra), et inscription de Vigie dans le tenant (SEC-01) |

Ordre conseillé (celui du paquet 1 de [`docs/RESTE-A-FAIRE.md`](../RESTE-A-FAIRE.md)) : ACT-17, ACT-18 et ACT-35, puis ACT-19, ACT-20, ACT-21 ; ensuite ACT-23 à ACT-27, puis ACT-28 ; puis ACT-30, ACT-32, PRD-12 et ACT-33 ; ACT-40 en fin de lot. Poser les questions C2 dès le début du lot (ACT-22 et ACT-37 conditionnent l'adaptation des écrans, ACT-28). La bascule de Power Apps vers Vigie suppose ACT-36 et ACT-39 (reprise des numéros AC) et, pour le rappel par e-mail, ACT-34.

### Éléments existants remplacés ou modifiés

« PA » : élément marqué PA dans [`docs/RESTE-A-FAIRE.md`](../RESTE-A-FAIRE.md) (écran dont le formulaire Power Apps est attendu) : son contenu pourra changer à réception de ce formulaire. Le tableau ne retient que les éléments dont la refonte change le contenu ; 33 autres éléments qu'elle conditionne seulement (ordre de réalisation, dépendance, code réécrit : AUD-28, DOC-13, HAB-06, IMP-07, QUA-17, QUA-23, UX-04…) portent une note « À revoir avec ACT-… » dans le backlog ; les paquets 2 et 10 de sa feuille de route regroupent les éléments à faire juste après la refonte.

| Réf | Effet de la refonte |
|---|---|
| ACT-01 ✅ | Colonnes de source conservées comme éléments liés ; `origin` remplacé par `source` (22 valeurs) ; `reprise-liens` adapté aux sources ; réserve « référence texte sans `canEdit` » levée si la création reste réservée au QHSE (ACT-22) |
| ACT-02 | Modifié : un seul événement ou audit lié par action, source non modifiable ; rattachements complémentaires à confirmer (point 10) |
| ACT-03 | Modifié : le recyclage ne fait plus passer l'action « verify » par écriture directe ; règle d'ACT-22, cycle de vie d'ACT-21 et journal |
| ACT-04 | Remplacé par ACT-20 (journal de tous les champs) |
| ACT-05 | Remplacé par ACT-21 (réouverture d'une action Vérifiée : QHSE, motif obligatoire) |
| ACT-06 | Remplacé par ACT-20 (site unique, sites du périmètre) |
| ACT-07 | Repris par ACT-20 (sélecteur d'événement de la source) |
| ACT-08 | Remplacé par ACT-20 (élément lié choisi selon la source) |
| ACT-09 | Remplacé par ACT-21 et ACT-17 (« Reportée » posé par le QHSE sans motif obligatoire ; date cible initiale conservée) — question tranchée |
| ACT-10 | Remplacé par ACT-21, ACT-24 et ACT-25 (date effective, fil, preuves facultatives) — question tranchée |
| ACT-11 | Repris par ACT-20 (contrôles de saisie) |
| ACT-12 | Modifié : source des actions de coactivité selon ACT-37 |
| ACT-13 | Modifié : jugement d'efficacité réservé au QHSE (tranché) ; reste l'indépendance du vérificateur (point 13) |
| ACT-14 | Remplacé par ACT-23 et ACT-28 (vérifications adressées au QHSE seulement) |
| ACT-15 | Remplacé par ACT-27 |
| ACT-16 | Remplacé par ACT-29 |
| TDB-06 | Modifié : « action confiée » traité par ACT-30 (notifications d'information réutilisables) ; reste la suite d'un signalement |
| TDB-10 | Modifié : purger aussi les notifications d'information et le journal d'envoi des e-mails |
| TDB-12 | Modifié (PA) : « Actions en retard » ouvre la vue générale filtrée (ACT-27) |
| EVT-15 | Modifié (PA) : « Efficacité vérifiée » quand les actions liées sont Vérifiées ou Abandonnées ; action de suite sur un événement clos (point 12) |
| EVT-22 | Modifié (PA) : le salarié responsable consulte, commente et joint des preuves (photo), il ne fait plus avancer ses actions |
| EVT-25 | Modifié : la fiche action s'ouvre en lecture pour qui n'est pas QHSE |
| EVT-26 | Modifié : lien vers la vue générale filtrée par la référence de l'événement (ACT-27) |
| DUE-02 ✅ | Modifié : coût estimé et réel sur toutes les actions ; la ligne du PAPRIPACT propose le coût estimé de l'action |
| DUE-04 | Modifié (PA) : l'annulation devient « Abandonnée » (motif, détachement journalisé sur le risque) |
| VEI-05 | Modifié (PA) : relance de l'écart ou de la réserve après une vérification « Efficace » ; non efficace : l'action de suite prend le relais |
| AUD-12 | Modifié : rattacher l'action d'une autre revue est refusé (source unique, verrouillée) |
| AUD-13 | Modifié (PA) : la source « Objectif QSE » vise les objectifs (décisions « objectif », puis entité objectif) |
| PRD-08 | Modifié : numérotation des actions traitée par ACT-35 ; reste les autres références |
| PRD-12 | Modifié : prérequis d'ACT-33, à livrer avec lui (P1) |
| INT-03 | Modifié (PA) : rapprocher les fiches créées par l'import Power Apps (point 16) |
| INT-04 | Modifié : canal e-mail construit par ACT-33 et ACT-34 ; restent les alertes immédiates, Teams et push ; jamais d'e-mail à la création d'une action |
| IMP-05 | Modifié (PA) : actions retirées du périmètre (pas d'export Excel, décision du service QHSE) |
| QUA-11 | Modifié : fil et historique de l'action chargés à l'ouverture de la fiche |
| UX-06 | Modifié : Kanban regroupé en six colonnes au lieu de cinq colonnes de statut |
| SEC-02 ✅ | Réserve levée : « Tous les sites » n'est plus proposé à la création d'une action |
| § 20 « Rôle Salarié » | Modifié : le salarié responsable consulte, commente et joint des preuves ; il ne déclare plus réalisée (décision du 15/10/2026) |

## 22. Points ouverts

« Bloquant » : l'élément cité attend la réponse. « Non » : la proposition s'applique par défaut et la réponse peut la corriger sans retarder le développement.

| # | Point | Classe | Auprès de | Proposition | Bloquant | Élément |
|--:|---|:-:|---|---|:-:|---|
| 1 | Numérotation AC : compteur annuel ou continu, nombre de chiffres après l'année | C3 | service QHSE (recherche en cours) | — (hypothèse : identifiant de la liste SharePoint, compteur continu) | oui | ACT-36 |
| 2 | Extraction Power Apps : format (Excel, CSV), colonnes (site ? responsable en e-mail ou en nom ?), historique des commentaires, pièces jointes | C3 | propriétaire de l'application | — | oui | ACT-39 |
| 3 | Création d'une action par l'encadrement hors QHSE depuis un écran source (aujourd'hui, un chef de service pilote d'un événement crée ses actions, et l'étape « Actions » exige une action liée) | C2 | responsable produit, service QHSE | création permise à qui peut modifier l'écran source, formulaire complet ; ensuite tout est géré par le QHSE | oui | ACT-22 |
| 4 | Consultation du plan par l'encadrement hors QHSE | C2 | responsable produit | lecture seule du plan de son périmètre, comme aujourd'hui | oui | ACT-22 |
| 5 | Recyclage enregistré dans Habilitations : faire passer l'action « Terminée » d'office, ou seulement l'indiquer au fil et au QHSE | C2 | service QHSE | commentaire automatique « Formation enregistrée le … » et échéance du QHSE ; « Terminée » reste un geste du QHSE | oui | ACT-22 |
| 6 | Source des actions créées par Habilitations (recyclage), Prévention (plan, permis, coactivité), Environnement et audits fournisseurs ; sens de « Réserves » et d'« Analyse de risque (AST-EST) » | C2 | service QHSE | Environnement → Analyse environnementale ; ajouter « Habilitations et formations » et « Prévention des entreprises extérieures » à la liste, ou les rattacher à « Contrôle réglementaire » et « Analyse de risque (AST-EST) » ; audits fournisseurs → Audit interne ISO | oui | ACT-37 |
| 7 | Correspondance niveau de risque → priorité proposée | C2 | service QHSE | niveau 4 → Urgent ; niveau 3 → Moyen terme ; niveaux 0 à 2 → Long terme ; toujours modifiable | oui | ACT-38 |
| 8 | Statistiques : répartitions sur l'état du plan à la fin du mois ou sur les actions ouvertes dans le mois ; respect des dates cibles sur la date cible initiale ou actuelle | C2 | service QHSE | état à la fin du mois ; date cible initiale (un report n'efface pas un retard) | oui | ACT-29 |
| 9 | Avertir le QHSE d'un commentaire ou d'une preuve du responsable | C2 | service QHSE | notification d'information au responsable QHSE du site | oui | ACT-31 |
| 10 | Rattachements complémentaires (risque du DUERP traité, PAPRIPACT, exigence, contrôle, recyclage) en plus de la source unique | C2 | service QHSE | maintenus (les écrans sources en dépendent) ; jamais d'autre événement ni d'audit | oui (ACT-02) | ACT-02 |
| 11 | Actions Reportées et Terminées dans le rappel du mercredi | C2 | service QHSE | exclues (« actions en cours ») | non | ACT-32, ACT-33 |
| 12 | Action de suite d'une vérification non efficace quand l'événement source est clos | C2 | service QHSE | rattachée à l'action précédente et à la référence de l'événement, sans rouvrir l'événement ; échéance du QHSE pour décider d'une réouverture | non | ACT-23 |
| 13 | Indépendance du vérificateur : un membre du QHSE peut-il vérifier une action dont il est le responsable ? (reste d'ACT-13) | C2 | service QHSE | autorisé, signalé sur la fiche | non | ACT-23 |
| 14 | Reprise : « En cours » devient « Budgétée ou initiée » ou « 20 % » (bases de démonstration et d'essai seulement) | C2 | responsable produit | Budgétée ou initiée | non | ACT-19 |
| 15 | Notification quand le QHSE change le responsable d'une action | C2 | service QHSE | même notification « Action confiée » au nouveau responsable | non | ACT-30 |
| 16 | Responsables de l'extraction Power Apps absents de Vigie : créer leur fiche (nom, e-mail, rapprochée ensuite par Entra et Cursus) ou refuser la ligne | C2 / C3 | responsable produit, avec l'extraction | créer la fiche, sans rôle, rapprochée à la première connexion | oui | ACT-39, INT-03 |
| 17 | Direction comptée dans le « service QHSE » pour les droits sur les actions | C2 | responsable produit | oui, comme pour toutes les validations de Vigie (`canApprove`) | non | ACT-21 |
| 18 | Autres formulaires Power Apps (événements, audits, etc.) : ils peuvent changer les écrans sources et les éléments liés du [§ 12](#12-sources-et-rattachements) | C3 | utilisateur | spécifier chaque écran à réception de son formulaire | non | ACT-28 |
| 19 | Compte d'envoi des e-mails ; heure d'envoi du rappel | C4 | informatique (messagerie, tenant Entra) | mercredi 7 h, boîte d'envoi dédiée | oui (envoi réel) | ACT-34 |
