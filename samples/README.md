# Formulaires d'exemple — import du plan de prévention

Fichiers de démonstration et de test de l'écran **Plans de prévention → Importer un plan de prévention** (`/prevention/import`). Ils sont générés par `node scripts/pp-samples.mjs` (même contenu à chaque génération) et imitent le formulaire interne d'un établissement Seveso seuil haut, en attendant le vrai formulaire de l'entreprise.

| Fichier | Contenu | Résultat attendu à l'import |
|---|---|---|
| `plan-de-prevention-vierge.pdf` | PDF remplissable (AcroForm), 2 pages, 42 champs dont 24 cases, non rempli | Format « PDF remplissable », 0 case cochée. Sert à calibrer la correspondance puis à l'enregistrer comme modèle. |
| `plan-de-prevention-exemple.pdf` | Même formulaire rempli : entreprise déjà connue de Vigie (« Entreprise Chaudronnerie Soudure »), intervention du 12 au 16/10/2026, travaux dangereux, inspection commune le 06/10, signature de l'entreprise utilisatrice seule | 14 cases cochées ; même empreinte que le PDF vierge (modèle reconnu) ; entreprise rapprochée de `[Entreprise Chaudronnerie Soudure]` ; projet `K-2025-042 · [Client A]` ; plan créé « À signer ». |
| `plan-de-prevention-exemple.docx` | Formulaire Word rempli : contrôles de contenu (texte, dates, cases `w14:checkbox`) et cases dessinées ☒ / ☐ ; entreprise nouvelle (« [Entreprise Échafaudages Atlantique] ») ; signé par les deux entreprises le 08/10/2026 | Format « Word », 42 champs dont 24 cases (15 cochées) ; proposition « Créer l'entreprise » ; projet `K-2026-012 · [Client B]` ; plan créé « Signé ». |

## Champs du formulaire

- **Entreprise extérieure** : raison sociale, activité, interlocuteur, téléphone, e-mail.
- **Intervention** : nature des travaux, lieu, dates de début et de fin, heures sur 12 mois, projet Keystone, date de l'inspection commune, travaux dangereux (oui / non).
- **Risques d'interférence** (9 cases) : circulation d'engins, travail en hauteur, zone ATEX, points chauds, levage, électricité, produits dangereux ou pyrotechniques, bruit, coactivité avec la production ; autres risques.
- **Mesures de prévention** (7 cases) : balisage, consignation, permis de feu, permis d'essai, EPI spécifiques, surveillance, plan de circulation ; précisions.
- **Moyens de secours et consignes** (6 cases) : extincteurs, point de rassemblement, numéros d'urgence, consignes Seveso et POI, alarme et évacuation, sauveteur secouriste.
- **Signatures** : nom du signataire et date, pour l'entreprise utilisatrice et pour l'entreprise extérieure.

## Scans et photos

Un PDF sans champ (imprimé puis numérisé, ou aplati) et une photo sont lus par l'API Claude uniquement si le serveur est lancé avec `VIGIE_AI_IMPORT=1` et une clé `ANTHROPIC_API_KEY` : le document est alors envoyé à Anthropic. Sans cette activation explicite, rien n'est envoyé et le plan se saisit à l'étape « Vérification », le fichier étant joint au plan. Il en va de même si la lecture échoue (refus, service indisponible, réponse illisible) : l'étape « Détection » affiche la raison, propose de relancer la lecture quand l'échec est passager, et « Saisir le plan » reste disponible.

## PDF protégés

Un PDF remplissable « protégé contre la modification » (chiffré avec un simple mot de passe propriétaire) est lu sur le serveur comme un PDF remplissable ordinaire : mêmes clés, même empreinte, donc même modèle que sa version non protégée. Un PDF à mot de passe d'ouverture n'est pas lu (ni envoyé à l'API Claude) : importer une copie sans mot de passe, ou saisir le plan.

Pour tester la lecture d'un scan, imprimez `plan-de-prevention-exemple.pdf` puis numérisez-le, ou photographiez l'écran. Choisir au dépôt le modèle calibré sur le PDF remplissable fait réutiliser ses clés : la même correspondance s'applique au scan.
