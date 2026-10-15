# Vigie pour Mac

`Vigie.app` ouvre Vigie comme une application Mac : une icône sur le Bureau, une fenêtre native, sans navigateur ni Terminal.

L'application est une petite coquille AppKit + WKWebView (Swift, sans Xcode). Elle fait tourner le serveur Next.js du projet en local et affiche l'interface web dans sa fenêtre. Les données restent celles du projet : base PGlite et pièces jointes dans `.data/`.

## Installer ou mettre à jour

Dans le Terminal, depuis le dossier du projet :

```bash
bash desktop-app/build.sh
```

Le script :

1. dessine l'icône (`icon/make_icon.swift`) et produit `Vigie.icns` avec `sips` et `iconutil` ;
2. compile les sources Swift (`Sources/*.swift`) avec `swiftc` pour macOS 13 ou plus récent, sur Apple Silicon ;
3. assemble `Vigie.app`, puis inscrit dans `Info.plist` le chemin du projet (`VigieProjectPath`) et le dossier de Node.js (`VigieNodeDir`, relevé avec `command -v node`) ;
4. signe l'application ad hoc (`codesign --sign -`), la vérifie, puis l'installe dans `~/Desktop/Vigie.app` en remplaçant l'ancienne version. Si Vigie est ouvert, le script le ferme d'abord, et l'application arrête proprement le serveur qu'elle avait lancé ;
5. vérifie la signature installée avec `codesign --verify --deep --strict`. Si iCloud Drive synchronise le Bureau, voir « Bureau synchronisé par iCloud Drive » plus bas : le script l'indique explicitement.

Prérequis : les outils de ligne de commande Apple (`xcode-select --install`, Xcode n'est pas nécessaire), Node.js 22 ou plus récent (`brew install node`, version du champ `engines` de package.json) et les dépendances du projet (`npm install`).

Options :

- `bash desktop-app/build.sh --applications` installe l'application dans `~/Applications/Vigie.app` et place sur le Bureau un lien `Vigie.app` qui l'ouvre. C'est l'installation conseillée quand iCloud synchronise le Bureau ;
- `bash desktop-app/build.sh --no-quit` laisse Vigie ouvert s'il l'est : le paquet est remplacé, et la nouvelle version servira au prochain lancement (quitter avec ⌘Q, puis rouvrir) ;
- `bash desktop-app/build.sh --no-install` compile seulement, dans `desktop-app/build/Vigie.app` ;
- `VIGIE_INSTALL_DIR=/autre/dossier bash desktop-app/build.sh` installe ailleurs que sur le Bureau.

Il faut reconstruire l'application après une modification de `desktop-app/`, après le déplacement du projet ou quand Node.js change d'emplacement. Pour une simple modification de Vigie, inutile : l'application recompile toute seule (voir plus bas).

## Au lancement

1. La fenêtre s'ouvre tout de suite et affiche la marque Vigie avec un indicateur d'activité.
2. **Si un serveur répond déjà sur le port 3200**, l'application l'utilise tel quel, par exemple un `npm run dev` lancé par un développeur. Elle ne l'arrêtera jamais.
3. **Sinon**, elle lance son propre serveur :
   - elle compile d'abord (`npm run build`) quand c'est nécessaire, ce qui prend environ une minute ; le temps écoulé et la dernière ligne de la compilation s'affichent. Voir « Quand l'application recompile » ;
   - elle démarre ensuite `next start --port 3200 --hostname ::1` (Node directement, `NODE_ENV=production`, `VIGIE_DEMO=1` : l'application Mac est toujours en mode démonstration, compilation comprise) et attend la première réponse, au plus 90 secondes. Le serveur n'est joignable que depuis ce Mac (voir « Accès réseau »).
4. Elle affiche ensuite `http://localhost:3200`.

Pour savoir si un serveur répond, l'application demande `/_next/static/vigie-desktop-probe` (requête `HEAD`) : Next.js y répond aussitôt « 404 » sans rendre de page ni ouvrir la base, y compris un `npm run dev` qui n'a encore rien compilé.

### Quand l'application recompile

- **Pas de compilation** (`.next/BUILD_ID` absent) : première compilation.
- **Compilation réussie lancée par l'application** : à la fin, elle enregistre un témoin dans `~/Library/Application Support/Vigie/build-stamp.json`, avec l'identifiant de la compilation et l'état (date, taille) de chaque fichier de `src/`, `public/`, `drizzle/`, de `package.json`, `package-lock.json`, `next.config.*`, `tsconfig.json` et des `.env*` **au début** de la compilation. Elle recompile dès qu'un de ces fichiers est modifié, ajouté, supprimé ou renommé, même s'il a été restauré avec une date ancienne (`cp -p`, `tar`, `rsync -a`) ou modifié pendant la compilation. Les fichiers cachés (`.DS_Store`…) sont ignorés.
- **Compilation échouée ou interrompue** (erreur, « Quitter » ou ⌘Q pendant la compilation, « Réessayer ») : l'application supprime `.next/BUILD_ID`, car Next.js l'écrit avant de générer les pages statiques. Le lancement suivant recompile au lieu de démarrer sur un `.next` incomplet.
- **Compilation faite hors de l'application** (`npm run build` dans le Terminal), ou interrompue par un arrêt forcé de Vigie : la compilation n'est retenue que si `prerender-manifest.json` et `export-marker.json`, écrits à la fin, ne sont pas plus anciens que `BUILD_ID`. L'application compare ensuite les dates : un fichier plus récent que `BUILD_ID`, ou un dossier modifié (fichier ajouté, supprimé ou renommé), déclenche une compilation.

À la fermeture (⌘Q, ou fermeture de la fenêtre principale), le serveur lancé par l'application reçoit SIGTERM. S'il tourne encore après 5 secondes, il reçoit SIGKILL. La base PGlite n'est jamais ouverte par deux serveurs à la fois :

- l'application ne lance son serveur que si personne n'écoute sur le port 3200, en IPv4 comme en IPv6 ;
- tant que son serveur tourne, elle garde le port 3200 réservé sur les autres adresses (`0.0.0.0`, `127.0.0.1`, `::`) : un `npm run dev`, avec ou sans `-H`, échoue alors sur « port déjà utilisé » au lieu d'ouvrir la même base ;
- après un plantage de l'application, le serveur s'arrête de lui-même au bout de 2 secondes environ. Un petit script préchargé dans Node surveille le processus parent ;
- au lancement suivant, un serveur resté actif est retrouvé grâce à `~/Library/Application Support/Vigie/server.pid` (PID et date de démarrage), puis arrêté.

## Dans l'application

- **Menus** : Vigie, Fichier (Fermer ⌘W, Imprimer… ⌘P), Édition (⌘Z, ⇧⌘Z, ⌘X, ⌘C, ⌘V, ⌘A), Présentation (Recharger ⌘R, Taille réelle ⌘0, Agrandir ⌘+, Réduire ⌘−, Plein écran ⌃⌘F), Navigation (Précédent ⌘[, Suivant ⌘], Tableau de bord ⇧⌘H), Fenêtre et Aide (Ouvrir dans le navigateur, Journal du serveur).
- **Fenêtres** : les liens qui ouvrent un nouvel onglet ouvrent une nouvelle fenêtre de l'application. C'est le cas de la revue de direction et des pièces jointes PDF ou image. ⌘-clic sur un lien interne fait de même. La fenêtre n'apparaît qu'au premier contenu de la page, sur le fond sombre de Vigie : une pièce jointe Word, Excel, PowerPoint ou CSV est téléchargée sans laisser de fenêtre vide. Les liens externes s'ouvrent dans le navigateur par défaut, et `mailto:` / `tel:` dans l'application concernée.
- **Impression** : le bouton « Imprimer / PDF » de la revue de direction et ⌘P ouvrent la zone d'impression du Mac, qui permet aussi d'enregistrer en PDF.
- **Téléchargements** : les exports CSV du DUERP, le registre des déchets et les fichiers non affichables vont dans `~/Downloads` sous un nom unique (`nom 2.csv`…). Un bandeau propose « Afficher dans le Finder », dans la fenêtre d'où vient le lien. La première fois, macOS peut demander l'autorisation d'accéder au dossier Téléchargements ; l'interface reste utilisable pendant la demande.
- **Zoom** : ⌘+ et ⌘− agrandissent ou réduisent la page, ⌘0 revient à la taille réelle, y compris après un zoom au pincement du trackpad.
- **Plantage d'une page** : si le processus d'affichage de WebKit s'arrête, la page est rechargée. Après trois arrêts en 30 secondes, elle ne l'est plus et un message s'affiche.
- **Fichiers à joindre** : le sélecteur de fichiers natif s'ouvre, y compris pour l'import des plans de prévention. Le glisser-déposer fonctionne.
- Les cookies (rôle et site choisis) sont conservés d'un lancement à l'autre. Le zoom aussi.

## Journal

- `~/Library/Logs/Vigie/server.log` contient la sortie de la compilation et du serveur, ainsi que les messages de l'application `[Vigie …]`. Il est contrôlé au démarrage du serveur et toutes les 5 minutes : au-delà de 5 Mo, il est copié dans `server.log.1` (qui remplace l'ancien), puis vidé.
- On l'ouvre par le menu Aide › Journal du serveur, ou par le bouton « Ouvrir le journal » en cas d'erreur.

## Dépannage

| Symptôme | Que faire |
|---|---|
| « Node.js est introuvable » | Installer Node.js (`brew install node` ou nodejs.org), puis « Réessayer ». Si Node est installé ailleurs, relancer `bash desktop-app/build.sh` depuis un Terminal où `node` fonctionne. |
| « Dépendances du projet manquantes » | `npm install` dans le dossier du projet, puis « Réessayer ». |
| « La compilation a échoué » | Lire les dernières lignes affichées ou le journal, corriger, puis « Réessayer ». `npm run build` dans le Terminal donne la même erreur. |
| « Le port 3200 est occupé » | Un programme écoute sur le port sans répondre depuis 60 secondes. Si c'est un `npm run dev` qui démarre encore, patienter puis « Réessayer ». Sinon, `lsof -nP -iTCP:3200 -sTCP:LISTEN` l'identifie : le fermer, puis « Réessayer ». |
| « Le serveur ne répond plus » | Le serveur s'est arrêté (`npm run dev` interrompu, plantage) : « Réessayer » relance tout. |
| « Projet Vigie introuvable » | Le projet a été déplacé : relancer `bash desktop-app/build.sh` depuis son nouvel emplacement, ou `defaults write com.epc2i.vigie VigieProjectPath "/nouveau/chemin/Vigie"`. |
| L'application ne s'ouvre pas (« développeur non identifié ») | En principe sans objet : une application construite sur ce Mac n'est pas mise en quarantaine, Gatekeeper ne la contrôle donc pas. Sinon (application copiée depuis un autre Mac) : Réglages Système › Confidentialité et sécurité › « Ouvrir quand même ». Depuis macOS 15, le clic droit › Ouvrir ne suffit plus. |
| Un téléphone n'atteint pas `/signaler` | Le serveur de l'application n'écoute que sur ce Mac. Voir « Accès réseau » ci-dessous. |
| Interface obsolète après `git pull` | Rien à faire : la recompilation est automatique au lancement suivant. Si Vigie était ouvert, le quitter (⌘Q) puis le rouvrir. |
| `npm run build` lancé à la main pendant que Vigie tourne | La page peut se dérégler. Quitter puis rouvrir Vigie. |
| Repartir de zéro | Quitter Vigie, puis `npm run db:reset` (base de démonstration) et/ou supprimer `.next/` (recompilation complète). |

L'inspecteur web de Safari peut s'attacher à la fenêtre (Safari › Développement › nom du Mac › Vigie).

## Limites

- **Mac Apple Silicon, macOS 13 ou plus récent.** Le dossier du projet et `node_modules` doivent rester en place : l'application ne les embarque pas.
- **Signature ad hoc.** Pas de notarisation : l'application est faite pour ce Mac, pas pour être distribuée. Après chaque reconstruction, macOS peut redemander certaines autorisations, comme l'accès au dossier Téléchargements.
- **Bureau synchronisé par iCloud Drive.** Ce Mac est dans ce cas. Le script marque le paquet comme exclu de la synchronisation (attribut `com.apple.fileprovider.ignore#P`, macOS 14 ou plus récent ; `fileproviderctl evaluate ~/Desktop/Vigie.app` affiche alors `isExcludedFromSync = 1`), pour qu'iCloud ne l'envoie pas sur ses serveurs et ne le retire pas du disque avec l'optimisation du stockage. iCloud ajoute quand même au paquet un attribut Finder (`com.apple.FinderInfo`, drapeau « paquet ») que `codesign --verify --strict` refuse. La signature reste valide (`codesign --verify --deep` réussit) et l'application s'ouvre normalement ; le script l'annonce par un avertissement explicite, jamais comme une vérification réussie. Pour une installation hors iCloud, que `--strict` accepte : `bash desktop-app/build.sh --applications` (application dans `~/Applications`, lien sur le Bureau).
- **Dictée vocale et caméra du formulaire de signalement** : l'application ne demande ni micro ni caméra. La dictée du navigateur n'y est donc pas disponible, mais la dictée de macOS fonctionne dans tous les champs (touche Dictée, ou deux appuis sur Fn). La prise de photo ouvre le sélecteur de fichiers.
- **Accès réseau.** Par défaut, le serveur lancé par l'application n'écoute que sur ce Mac (`::1`, c'est-à-dire `localhost`) : Vigie n'a pas d'authentification (le rôle se choisit dans l'interface), et personne d'autre sur le Wi-Fi ou le réseau du bureau ne doit pouvoir lire ou modifier les données. Pour le rendre joignable depuis le réseau local, par exemple un téléphone pour `/signaler` : `defaults write com.epc2i.vigie VigieNetworkAccess -bool true`, puis quitter et rouvrir Vigie. Le serveur écoute alors sur toutes les interfaces, comme `npm run start`, et le pare-feu de macOS peut demander une autorisation pour `node`. `defaults delete com.epc2i.vigie VigieNetworkAccess` revient au réglage par défaut. La fenêtre « À propos de Vigie » indique le mode en cours.
- **Variables d'environnement du Terminal** (`~/.zshrc`, comme `ANTHROPIC_API_KEY` ou `VIGIE_TODAY`) : une application ouverte depuis le Finder ne les voit pas. Il faut les mettre dans `.env.local` à la racine du projet. Next.js les lit, et une modification déclenche une recompilation.
- **Un seul serveur, un seul projet** : l'application pilote le projet dont le chemin figure dans `Info.plist`. Pendant que Vigie fait tourner son serveur, `npm run dev` échoue (port 3200 pris), et c'est voulu. Ne pas le lancer sur un autre port (`--port 3201`), sinon deux serveurs ouvriraient la même base PGlite. Si Vigie plante, la réservation du port disparaît avec lui, et son serveur s'arrête de lui-même environ 2 secondes plus tard : attendre ces quelques secondes avant de lancer `npm run dev`.

## Fichiers

```
desktop-app/
├── build.sh                    construction, signature, installation
├── Resources/Info.plist        modèle (chemins complétés par build.sh)
├── icon/make_icon.swift        générateur de l'icône 1024 × 1024
└── Sources/
    ├── main.swift              démarrage de NSApplication
    ├── AppDelegate.swift       cycle de vie, instance unique, arrêt propre, menus d'aide
    ├── MainMenu.swift          barre de menus
    ├── AppConfig.swift         chemins, port, adresses
    ├── ServerController.swift  réutiliser / compiler / démarrer / arrêter le serveur
    ├── ServerSupport.swift     journal, Node, sonde et réservation du port, fraîcheur de la compilation, PID, surveillance
    ├── WebWindowController.swift  fenêtre, WKWebView, navigation, téléchargements, dialogues
    ├── WebSession.swift        configuration WebKit partagée, impression, téléchargements
    ├── LoadingView.swift       vue de chargement / d'erreur
    ├── ToastView.swift         bandeau de notification
    └── BrandMark.swift         couleurs et marque Vigie (partagé avec l'icône)
```
