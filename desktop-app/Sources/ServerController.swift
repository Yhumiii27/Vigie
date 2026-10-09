import Darwin
import Foundation

/// Étape affichée par la fenêtre principale.
enum ServerState {
    /// Préparation en cours : message principal et détail facultatif (progression de la compilation).
    case working(status: String, detail: String?)
    /// Le serveur répond : l'adresse à charger.
    case ready(URL)
    case failed(ServerFailure)
    /// Arrêt du serveur à la fermeture de l'application.
    case stopping
}

/// Erreur présentée dans la vue de chargement (titre, explication, extrait du journal).
struct ServerFailure: Sendable {
    let title: String
    let message: String
    /// Dernières lignes du journal du serveur, s'il est utile de les montrer.
    let log: String?
}

@MainActor
protocol ServerControllerDelegate: AnyObject {
    func serverController(_ controller: ServerController, didChange state: ServerState)
}

/// Démarre ou réutilise le serveur Next.js de Vigie sur le port 3200.
///
/// 1. Si un serveur répond déjà sur le port (par exemple `npm run dev` lancé par un développeur),
///    il est utilisé tel quel et n'est jamais arrêté par l'application.
/// 2. Sinon : compilation de production si nécessaire (BuildChecker : pas de compilation, compilation
///    incomplète ou sources modifiées), puis `next start --port 3200 --hostname ::1`, et attente de la
///    première réponse HTTP.
///
/// La base PGlite (.data) ne doit jamais être ouverte par deux serveurs : l'application ne lance
/// le sien que si personne n'écoute sur le port, réserve le port sur les autres adresses tant qu'il
/// tourne (PortGuard), et l'arrête (SIGTERM, puis SIGKILL après 5 s) quand elle se ferme. Un orphelin
/// laissé par un plantage est arrêté au lancement suivant (fichier PID) et, entre-temps, s'arrête de
/// lui-même (script ParentWatchdog).
@MainActor
final class ServerController {
    enum Mode {
        case none
        /// Serveur trouvé déjà actif : jamais arrêté par l'application.
        case attached
        /// Serveur lancé par l'application.
        case owned
    }

    weak var delegate: ServerControllerDelegate?
    private(set) var state: ServerState = .working(status: Texts.starting, detail: nil)
    private(set) var mode: Mode = .none
    /// Vrai si le serveur lancé par l'application écoute sur toutes les interfaces (réseau local).
    private(set) var listensOnNetwork = false

    private let config: AppConfig
    /// Incrémenté à chaque (re)démarrage ou arrêt : les tâches d'une génération périmée se taisent.
    private var generation = 0
    private var runTask: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    private var child: ChildProcess?
    private var stoppingChild = false
    /// Sockets de PortGuard, liés au processus serveur qu'ils protègent.
    private var portGuard: (owner: ObjectIdentifier, sockets: [Int32])?
    private var logMaintenance: Task<Void, Never>?

    init(config: AppConfig) {
        self.config = config
    }

    /// Vrai si un processus lancé par l'application (compilation ou serveur) tourne encore.
    var hasRunningChild: Bool { child?.isRunning ?? false }

    // MARK: Démarrage

    /// Démarre (ou redémarre, pour « Réessayer ») la séquence complète.
    func start() {
        generation += 1
        let current = generation
        runTask?.cancel()
        healthTask?.cancel()
        runTask = Task { [weak self] in
            await self?.run(current)
        }
        startLogMaintenance()
    }

    /// Rotation du journal pendant la session (toutes les 5 minutes), pas seulement au lancement.
    private func startLogMaintenance() {
        guard logMaintenance == nil else { return }
        logMaintenance = Task.detached(priority: .utility) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(300))
                ServerLog.rotateIfNeeded()
            }
        }
    }

    private func run(_ g: Int) async {
        publish(.working(status: Texts.starting, detail: nil), g)
        await stopChild()
        guard isCurrent(g) else { return }
        mode = .none
        listensOnNetwork = false

        let projectURL = config.projectURL
        guard FileManager.default.fileExists(atPath: projectURL.appendingPathComponent("package.json").path) else {
            fail(Failures.projectMissing(projectURL.path), g)
            return
        }

        // Serveur resté actif après un plantage de l'application : on l'arrête avant toute chose.
        if let note = await Task.detached(operation: { OrphanGuard.cleanUp() }).value {
            ServerLog.note(note)
        }
        guard isCurrent(g) else { return }

        // 1. Un serveur occupe-t-il déjà le port ?
        guard await portIsFree(g), isCurrent(g) else { return }

        // 2. Node.js et dépendances du projet.
        let hint = config.nodeDirectoryHint
        guard let node = await Task.detached(operation: { NodeLocator.locate(hint: hint) }).value else {
            fail(Failures.nodeMissing, g)
            return
        }
        let nextBin = projectURL.appendingPathComponent("node_modules/next/dist/bin/next")
        guard FileManager.default.fileExists(atPath: nextBin.path) else {
            fail(Failures.dependenciesMissing(projectURL.path), g)
            return
        }
        ServerLog.rotateIfNeeded()
        let runtime = NodeRuntime(node: node, watchdog: ParentWatchdog.install())

        // 3. Compilation de production si nécessaire : `npm run build` (script « build » du projet),
        //    ou `next build` directement si npm est absent.
        let buildStatus = await Task.detached(operation: { BuildChecker.status(projectURL: projectURL) }).value
        guard isCurrent(g) else { return }
        if buildStatus != .upToDate {
            let npm = node.deletingLastPathComponent().appendingPathComponent("npm")
            let command: (executable: URL, arguments: [String]) = FileManager.default.isExecutableFile(atPath: npm.path)
                ? (npm, ["run", "build"]) : (node, [nextBin.path, "build"])
            guard await build(g, runtime: runtime, command: command, status: buildStatus) else { return }
            // Un serveur a pu être lancé pendant la compilation : ne jamais ouvrir la base deux fois.
            guard await portIsFree(g), isCurrent(g) else { return }
        }

        // 4. Démarrage du serveur. Node directement (pas npm) : un seul processus à surveiller et à arrêter.
        publish(.working(status: Texts.startingServer, detail: nil), g)
        var arguments = [nextBin.path, "start", "--port", String(AppConfig.port)]
        var sockets: [Int32] = []
        if config.allowsNetworkAccess {
            ServerLog.note("Accès depuis le réseau local activé (VigieNetworkAccess) : le serveur écoute sur toutes les interfaces.")
        } else if let reserved = PortGuard.reserve(port: AppConfig.port) {
            // Serveur joignable depuis ce Mac seulement ; le port reste réservé sur les autres adresses.
            sockets = reserved
            arguments += ["--hostname", PortGuard.serverHost]
        } else {
            ServerLog.note("Réservation du port \(AppConfig.port) impossible : le serveur écoute sur toutes les interfaces.")
        }
        listensOnNetwork = sockets.isEmpty
        ServerLog.section("Vigie \(config.version) · next start --port \(AppConfig.port)"
                          + (sockets.isEmpty ? "" : " --hostname \(PortGuard.serverHost)"))
        guard let server = launch(.server, runtime: runtime, executable: node, arguments: arguments, g) else {
            PortGuard.release(sockets)
            return
        }
        if !sockets.isEmpty { portGuard = (ObjectIdentifier(server), sockets) }

        if await waitForResponse(g, timeout: 90, child: server) {
            mode = .owned
            ServerLog.note("Serveur prêt : \(config.baseURL.absoluteString)")
            publish(.ready(config.baseURL), g)
            return
        }
        guard isCurrent(g) else { return }
        if let status = server.exitStatus {
            // Le port a pu être pris entre-temps par un autre serveur (EADDRINUSE) : on l'utilise.
            if case .responding = await PortProbe.status(port: AppConfig.port, url: config.probeURL, timeout: 3) {
                attach(g)
            } else if isCurrent(g) {
                fail(Failures.startFailed(status), g)
            }
        } else {
            await stopChild()
            ServerLog.note("Aucune réponse après 90 s : serveur arrêté.")
            fail(Failures.startTimeout, g)
        }
    }

    /// Port 3200 : vrai s'il est libre (l'application peut lancer son serveur). Sinon, utilise le
    /// serveur qui répond, ou affiche une erreur si le port reste occupé sans réponse.
    private func portIsFree(_ g: Int) async -> Bool {
        switch await PortProbe.status(port: AppConfig.port, url: config.probeURL, timeout: 3) {
        case .free:
            return true
        case .responding:
            attach(g)
            return false
        case .listening:
            // Port pris mais pas encore de réponse (serveur de développement qui démarre, par exemple).
            publish(.working(status: Texts.waitingForExisting, detail: nil), g)
            switch await waitForExistingServer(g, timeout: 60) {
            case .responding:
                attach(g)
                return false
            case .timedOut:
                if isCurrent(g) { fail(Failures.existingServerSilent, g) }
                return false
            case .vanished:
                return true // le port s'est libéré : on lance notre serveur
            }
        }
    }

    /// Lance la compilation de production et suit sa progression ; vrai si elle a réussi.
    private func build(_ g: Int, runtime: NodeRuntime, command: (executable: URL, arguments: [String]),
                       status: BuildChecker.Status) async -> Bool {
        let title: String
        let reason: String
        switch status {
        case .missing:
            title = Texts.firstBuild
            reason = "aucune compilation existante"
        case .incomplete:
            title = Texts.rebuild
            reason = "compilation précédente incomplète"
        case .outdated(let change):
            title = Texts.rebuild
            reason = "\(change) depuis la dernière compilation"
        case .upToDate:
            return true
        }
        // État des sources au début de la compilation : une modification faite pendant la compilation
        // sera détectée au lancement suivant. Le témoin de la compilation précédente est retiré tout de
        // suite : seule une compilation menée à son terme en écrit un nouveau.
        let projectURL = config.projectURL
        let sources = await Task.detached(operation: { BuildChecker.sourceTree(projectURL: projectURL).files }).value
        guard isCurrent(g) else { return false }
        BuildStamp.remove()
        let commandLine = ([command.executable.lastPathComponent] + command.arguments.map {
            $0.hasPrefix("/") ? URL(fileURLWithPath: $0).lastPathComponent : $0
        }).joined(separator: " ")
        ServerLog.section("Vigie \(config.version) · \(commandLine) (\(reason))")
        publish(.working(status: title, detail: nil), g)
        guard let process = launch(.build, runtime: runtime, executable: command.executable,
                                   arguments: command.arguments, g) else { return false }

        // Pas de délai maximal pendant la compilation : on affiche le temps écoulé et la dernière ligne du journal.
        let started = Date()
        var shownSecond = -1
        while process.isRunning {
            guard isCurrent(g) else { return false }
            let elapsed = Int(Date().timeIntervalSince(started))
            if elapsed != shownSecond {
                shownSecond = elapsed
                let line = await Task.detached(operation: { ServerLog.lastLine() }).value
                let clock = String(format: "%d:%02d", elapsed / 60, elapsed % 60)
                publish(.working(status: title, detail: [clock, line].compactMap { $0 }.joined(separator: "  ·  ")), g)
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        guard isCurrent(g) else { return false }
        guard process.exitStatus == 0 else {
            // .next/BUILD_ID a déjà été supprimé (childDidExit).
            fail(Failures.buildFailed(process.exitStatus ?? -1), g)
            return false
        }
        ServerLog.note("Compilation terminée en \(Int(Date().timeIntervalSince(started))) s.")
        let recorded = await Task.detached(operation: {
            BuildStamp.record(projectURL: projectURL, startedAt: started, sources: sources)
        }).value
        if !recorded { ServerLog.note("Témoin de compilation non enregistré (.next/BUILD_ID illisible).") }
        return isCurrent(g)
    }

    /// Lance un processus (node ou npm) dans le dossier du projet, sortie redirigée vers le journal.
    private func launch(_ kind: ChildProcess.Kind, runtime: NodeRuntime, executable: URL, arguments: [String],
                        _ g: Int) -> ChildProcess? {
        guard let output = ServerLog.openForAppending() else {
            fail(Failures.logUnavailable, g)
            return nil
        }
        defer { try? output.close() } // l'enfant garde sa propre copie du descripteur

        let process = ChildProcess(kind: kind, executable: executable, arguments: arguments,
                                   directory: config.projectURL, environment: runtime.environment(), output: output)
        process.onExit = { [weak self] exited, status in
            self?.childDidExit(exited, status: status)
        }
        do {
            try process.run()
        } catch {
            ServerLog.note("Impossible de lancer \(executable.path) : \(error.localizedDescription)")
            fail(Failures.launchFailed(error.localizedDescription), g)
            return nil
        }
        child = process
        if let started = ProcessTools.startTime(of: process.pid) {
            PidFile.write(.init(pid: process.pid, startTime: started, kind: kind.rawValue))
        }
        ServerLog.note("Processus « \(kind.rawValue) » lancé (PID \(process.pid)).")
        return process
    }

    /// Interroge le serveur toutes les 300 ms jusqu'à une réponse HTTP.
    private func waitForResponse(_ g: Int, timeout: TimeInterval, child process: ChildProcess?) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            guard isCurrent(g) else { return false }
            if let process, !process.isRunning { return false }
            if await PortProbe.responds(url: config.probeURL, timeout: 5) { return isCurrent(g) }
            try? await Task.sleep(for: .milliseconds(300))
        }
        return false
    }

    private enum ExistingServerOutcome { case responding, vanished, timedOut }

    /// Port occupé sans réponse HTTP : attend la réponse, ou que le port se libère.
    private func waitForExistingServer(_ g: Int, timeout: TimeInterval) async -> ExistingServerOutcome {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, isCurrent(g) {
            switch await PortProbe.status(port: AppConfig.port, url: config.probeURL, timeout: 5) {
            case .responding: return .responding
            case .free: return .vanished
            case .listening: try? await Task.sleep(for: .milliseconds(300))
            }
        }
        return .timedOut
    }

    private func attach(_ g: Int) {
        guard isCurrent(g) else { return }
        mode = .attached
        ServerLog.note("Un serveur répond déjà sur le port \(AppConfig.port) : utilisé tel quel (il ne sera pas arrêté à la fermeture).")
        publish(.ready(config.baseURL), g)
        startHealthMonitor(g)
    }

    /// Serveur réutilisé : vérifie toutes les 5 s qu'il écoute toujours (deux échecs de suite = arrêté).
    private func startHealthMonitor(_ g: Int) {
        healthTask?.cancel()
        healthTask = Task { [weak self] in
            var misses = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self, self.isCurrent(g), self.mode == .attached else { return }
                let listening = await Task.detached(operation: { PortProbe.isListening(port: AppConfig.port) }).value
                guard self.isCurrent(g) else { return }
                misses = listening ? 0 : misses + 1
                if misses >= 2 {
                    self.mode = .none
                    ServerLog.note("Le serveur réutilisé ne répond plus.")
                    self.fail(Failures.attachedServerGone, g)
                    return
                }
            }
        }
    }

    // MARK: Incidents signalés par les fenêtres

    /// Après l'échec du chargement d'une page : le serveur répond-il encore ?
    func isResponding() async -> Bool {
        await PortProbe.responds(url: config.probeURL, timeout: 5)
    }

    /// Le serveur ne répond plus (constaté par une fenêtre) : affiche l'erreur et propose « Réessayer ».
    func reportUnreachable() {
        guard case .ready = state else { return }
        healthTask?.cancel()
        let failure = mode == .attached ? Failures.attachedServerGone : Failures.ownedServerUnreachable
        ServerLog.note("Le serveur ne répond plus aux pages.")
        fail(failure, generation)
    }

    private func childDidExit(_ process: ChildProcess, status: Int32) {
        switch process.kind {
        case .build where status != 0:
            // Compilation échouée ou interrompue : Next.js écrit .next/BUILD_ID avant de générer les pages
            // statiques. Sans BUILD_ID, le lancement suivant recompile au lieu de démarrer sur un .next incomplet.
            BuildChecker.invalidate(projectURL: config.projectURL)
        case .server:
            releasePortGuard(of: process)
        default:
            break
        }
        guard process === child else { return }
        PidFile.remove()
        ServerLog.note("Processus « \(process.kind.rawValue) » terminé (code \(status)).")
        guard !stoppingChild, process.kind == .server, mode == .owned, case .ready = state else { return }
        mode = .none
        fail(Failures.serverStopped(status), generation)
    }

    // MARK: Arrêt

    /// Arrête le processus lancé par l'application (jamais un serveur réutilisé).
    func stop() async {
        generation += 1
        runTask?.cancel()
        healthTask?.cancel()
        guard hasRunningChild else {
            PidFile.remove()
            return
        }
        state = .stopping
        delegate?.serverController(self, didChange: .stopping)
        await stopChild()
    }

    /// Dernier recours, synchrone (applicationWillTerminate) : SIGTERM, 5 s, puis SIGKILL.
    func stopImmediately() {
        generation += 1
        runTask?.cancel()
        healthTask?.cancel()
        if let child, child.isRunning {
            stoppingChild = true
            ProcessTools.terminateGroup(child.pid, grace: 5)
            if child.kind == .build { BuildChecker.invalidate(projectURL: config.projectURL) }
        }
        if let portGuard { PortGuard.release(portGuard.sockets) }
        portGuard = nil
        PidFile.remove()
    }

    private func stopChild() async {
        guard let process = child else { return }
        if process.isRunning {
            stoppingChild = true
            ServerLog.note("Arrêt du processus « \(process.kind.rawValue) » (PID \(process.pid)).")
            process.signal(SIGTERM)
            if !(await process.waitForExit(timeout: 5)) {
                ServerLog.note("Pas d'arrêt après 5 s : SIGKILL.")
                process.signal(SIGKILL)
                _ = await process.waitForExit(timeout: 2)
            }
            stoppingChild = false
            // Compilation interrompue (Réessayer, Quitter) : à refaire entièrement au prochain lancement.
            if process.kind == .build { BuildChecker.invalidate(projectURL: config.projectURL) }
        }
        if !process.isRunning { releasePortGuard(of: process) }
        if child === process {
            child = nil
            PidFile.remove()
        }
        if mode == .owned { mode = .none }
    }

    // MARK: Outils

    /// Libère la réservation du port une fois le serveur qu'elle protège arrêté.
    private func releasePortGuard(of process: ChildProcess) {
        guard let portGuard, portGuard.owner == ObjectIdentifier(process) else { return }
        PortGuard.release(portGuard.sockets)
        self.portGuard = nil
    }

    private func isCurrent(_ g: Int) -> Bool { g == generation && !Task.isCancelled }

    private func publish(_ newState: ServerState, _ g: Int) {
        guard g == generation else { return }
        state = newState
        delegate?.serverController(self, didChange: newState)
    }

    private func fail(_ failure: ServerFailure, _ g: Int) {
        publish(.failed(failure), g)
    }
}

// MARK: - Environnement des processus Node

/// Environnement commun à `npm run build` et `next start`.
struct NodeRuntime: Sendable {
    let node: URL
    /// Script ParentWatchdog, préchargé dans chaque processus Node (npm, next et leurs sous-processus).
    let watchdog: URL?

    func environment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        // Une application lancée depuis le Finder n'a qu'un PATH minimal.
        var path = [node.deletingLastPathComponent().path, "/opt/homebrew/bin", "/usr/local/bin",
                    "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        path = path.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        environment["PATH"] = path.joined(separator: ":")
        environment["NODE_ENV"] = "production"
        environment["NEXT_TELEMETRY_DISABLED"] = "1"
        environment["NO_COLOR"] = "1"
        environment["NPM_CONFIG_UPDATE_NOTIFIER"] = "false"
        environment["NPM_CONFIG_FUND"] = "false"
        environment["VIGIE_DESKTOP"] = "1"
        if let watchdog {
            // Guillemets : le chemin contient des espaces (« Application Support »).
            let escaped = watchdog.path.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            let preload = "--require \"\(escaped)\""
            let existing = environment["NODE_OPTIONS"]?.trimmingCharacters(in: .whitespaces) ?? ""
            environment["NODE_OPTIONS"] = existing.isEmpty ? preload : "\(existing) \(preload)"
        }
        return environment
    }
}

// MARK: - Processus enfant

/// Processus Node lancé par l'application (compilation ou serveur).
@MainActor
final class ChildProcess {
    enum Kind: String, Sendable {
        case build = "compilation"
        case server = "serveur"
    }

    let kind: Kind
    private(set) var pid: pid_t = 0
    /// Code de sortie (ou numéro du signal), nil tant que le processus tourne.
    private(set) var exitStatus: Int32?
    var onExit: ((ChildProcess, Int32) -> Void)?
    var isRunning: Bool { pid > 0 && exitStatus == nil }

    private let process = Process()

    init(kind: Kind, executable: URL, arguments: [String], directory: URL, environment: [String: String], output: FileHandle) {
        self.kind = kind
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = output
        // Appelé sur un fil d'arrière-plan : retour sur le fil principal.
        process.terminationHandler = { [weak self] finished in
            let status = finished.terminationStatus
            Task { @MainActor in
                self?.didExit(status)
            }
        }
    }

    func run() throws {
        try process.run()
        pid = process.processIdentifier
    }

    func signal(_ signal: Int32) {
        guard isRunning else { return }
        ProcessTools.signalGroup(pid, signal)
    }

    /// Attend la fin du processus ; faux si le délai expire.
    func waitForExit(timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while exitStatus == nil, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(50))
        }
        return exitStatus != nil
    }

    private func didExit(_ status: Int32) {
        guard exitStatus == nil else { return }
        exitStatus = status
        onExit?(self, status)
    }
}

// MARK: - Textes

enum Texts {
    static let starting = "Démarrage de Vigie…"
    static let firstBuild = "Préparation de l'application (première compilation, environ une minute)…"
    static let rebuild = "Mise à jour de l'application (nouvelle compilation, environ une minute)…"
    static let startingServer = "Démarrage du serveur…"
    static let waitingForExisting = "Un serveur démarre déjà sur le port 3200, en attente de sa réponse…"
    static let opening = "Ouverture de Vigie…"
    static let stopping = "Arrêt du serveur…"
}

enum Failures {
    private static var logTail: String { ServerLog.tail(maxLines: 20) }

    static func projectMissing(_ path: String) -> ServerFailure {
        ServerFailure(
            title: "Projet Vigie introuvable",
            message: """
            Le dossier du projet n'existe pas ou ne contient pas de package.json :
            \(path)

            Reconstruisez l'application depuis le dossier du projet (bash desktop-app/build.sh), \
            ou indiquez son emplacement dans le Terminal :
            defaults write com.epc2i.vigie VigieProjectPath "/chemin/vers/Vigie"
            """,
            log: nil)
    }

    static var nodeMissing: ServerFailure {
        ServerFailure(
            title: "Node.js est introuvable",
            message: """
            Vigie a besoin de Node.js (version 20 ou plus récente) pour faire tourner son serveur local.

            Pour l'installer, ouvrez le Terminal et tapez « brew install node » (avec Homebrew, https://brew.sh), \
            ou téléchargez l'installateur sur https://nodejs.org. Cliquez ensuite sur « Réessayer ».
            """,
            log: nil)
    }

    static func dependenciesMissing(_ path: String) -> ServerFailure {
        ServerFailure(
            title: "Dépendances du projet manquantes",
            message: """
            Le dossier node_modules est absent ou incomplet. Dans le Terminal :
            cd "\(path)"
            npm install
            puis cliquez sur « Réessayer ».
            """,
            log: nil)
    }

    static func buildFailed(_ status: Int32) -> ServerFailure {
        ServerFailure(
            title: "La compilation a échoué",
            message: "La compilation de production (npm run build) s'est arrêtée avec le code \(status). L'erreur figure dans le journal ci-dessous ; une fois corrigée, cliquez sur « Réessayer ».",
            log: logTail)
    }

    static func startFailed(_ status: Int32) -> ServerFailure {
        ServerFailure(
            title: "Le serveur n'a pas démarré",
            message: "« next start » s'est arrêté avec le code \(status) avant de répondre.",
            log: logTail)
    }

    static var startTimeout: ServerFailure {
        ServerFailure(
            title: "Le serveur ne répond pas",
            message: "Le serveur Vigie n'a pas répondu dans les 90 secondes ; il a été arrêté.",
            log: logTail)
    }

    static var existingServerSilent: ServerFailure {
        ServerFailure(
            title: "Le port 3200 est occupé",
            message: """
            Un programme écoute sur le port 3200 mais ne répond pas depuis 60 secondes. \
            S'il s'agit de « npm run dev » encore en train de démarrer, patientez puis cliquez sur « Réessayer ». \
            Sinon, identifiez-le dans le Terminal (lsof -nP -iTCP:3200 -sTCP:LISTEN), fermez-le, puis cliquez sur « Réessayer ».
            """,
            log: nil)
    }

    static func serverStopped(_ status: Int32) -> ServerFailure {
        ServerFailure(
            title: "Le serveur Vigie s'est arrêté",
            message: "Le serveur s'est arrêté de façon inattendue (code \(status)). « Réessayer » le redémarre.",
            log: logTail)
    }

    static var ownedServerUnreachable: ServerFailure {
        ServerFailure(
            title: "Le serveur ne répond plus",
            message: "Le serveur Vigie ne répond plus. « Réessayer » le redémarre.",
            log: logTail)
    }

    static var attachedServerGone: ServerFailure {
        ServerFailure(
            title: "Le serveur ne répond plus",
            message: "Le serveur déjà actif sur le port 3200 (npm run dev, par exemple) s'est arrêté. « Réessayer » le réutilise s'il a redémarré, ou lance le serveur de Vigie.",
            log: nil)
    }

    static func launchFailed(_ reason: String) -> ServerFailure {
        ServerFailure(title: "Impossible de lancer Node.js", message: reason, log: nil)
    }

    static var logUnavailable: ServerFailure {
        ServerFailure(
            title: "Journal inaccessible",
            message: "Impossible d'écrire dans \(ServerLog.url.path).",
            log: nil)
    }

    static func pageFailed(_ reason: String) -> ServerFailure {
        ServerFailure(title: "La page n'a pas pu être chargée", message: reason, log: nil)
    }
}
