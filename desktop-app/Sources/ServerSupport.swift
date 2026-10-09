import Darwin
import Foundation

// Briques du pilotage du serveur, sans état ni acteur : elles peuvent bloquer (fichiers, sockets,
// attente d'un processus) et sont donc appelées hors du fil principal (Task.detached).

// MARK: - Journal du serveur

/// ~/Library/Logs/Vigie/server.log : sortie de `next build` / `next start` et messages de l'application.
enum ServerLog {
    static let rotationThreshold: UInt64 = 5 * 1024 * 1024

    static var url: URL { AppPaths.serverLog }

    /// Au-delà de 5 Mo, le journal est copié dans server.log.1 (l'ancien est remplacé), puis vidé.
    /// Appelé avant chaque lancement et toutes les 5 minutes pendant la session : le serveur écrit en
    /// mode ajout (O_APPEND), il reprend donc au début du fichier vidé. Les lignes écrites entre la
    /// copie et la troncature (quelques millisecondes) peuvent être perdues.
    static func rotateIfNeeded() {
        let fm = FileManager.default
        guard let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? NSNumber,
              size.uint64Value > rotationThreshold else { return }
        try? fm.removeItem(at: AppPaths.previousServerLog)
        guard (try? fm.copyItem(at: url, to: AppPaths.previousServerLog)) != nil else { return }
        _ = truncate(url.path, 0)
    }

    /// Ouvre le journal en ajout (O_APPEND) : l'application et le processus enfant peuvent y écrire
    /// en même temps sans s'écraser.
    static func openForAppending() -> FileHandle? {
        try? FileManager.default.createDirectory(at: AppPaths.logsDirectory, withIntermediateDirectories: true)
        let fd = open(url.path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0o644)
        guard fd >= 0 else { return nil }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    static func ensureExists() {
        if let handle = openForAppending() { try? handle.close() }
    }

    /// Ajoute une ligne horodatée « [Vigie …] … ».
    static func note(_ message: String) {
        append("[Vigie \(timestamp())] \(message)\n")
    }

    /// Ligne de séparation au début d'une compilation ou d'un démarrage.
    static func section(_ title: String) {
        append("\n=== \(timestamp()) · \(title) ===\n")
    }

    /// Date et heure locales, « 2026-10-08 09:37:32 ».
    static func timestamp(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: date)
    }

    static func append(_ text: String) {
        guard let handle = openForAppending() else { return }
        try? handle.write(contentsOf: Data(text.utf8))
        try? handle.close()
    }

    /// Dernières lignes non vides du journal (codes couleur ANSI retirés).
    static func tail(maxLines: Int = 20) -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? handle.close() }
        let end = (try? handle.seekToEnd()) ?? 0
        let window: UInt64 = 64 * 1024
        try? handle.seek(toOffset: end > window ? end - window : 0)
        let data = (try? handle.readToEnd()) ?? Data()
        let text = String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[ -/]*[@-~]", with: "", options: .regularExpression)
        let lines = text.split(whereSeparator: { $0.isNewline })
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        return lines.suffix(maxLines).joined(separator: "\n")
    }

    /// Dernière ligne écrite par la compilation (sans les notes de l'application), pour suivre sa progression.
    static func lastLine() -> String? {
        let line = tail(maxLines: 8).split(separator: "\n").last(where: { !$0.hasPrefix("[Vigie ") && !$0.hasPrefix("=== ") })
        let trimmed = line.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Node.js

enum NodeLocator {
    /// Cherche l'exécutable `node` : d'abord le dossier relevé à la compilation de l'application
    /// (Info.plist), puis les emplacements habituels (Homebrew, /usr/local, Volta, fnm, asdf, nvm).
    static func locate(hint: String?) -> URL? {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        var directories: [String] = []
        if let hint { directories.append(hint) }
        directories += ["/opt/homebrew/bin", "/usr/local/bin",
                        "\(home)/.volta/bin", "\(home)/.local/share/fnm/aliases/default/bin",
                        "\(home)/.asdf/shims", "\(home)/.nodenv/shims"]
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? fm.contentsOfDirectory(atPath: nvm) {
            directories += versions
                .sorted { $0.compare($1, options: .numeric) == .orderedDescending }
                .map { "\(nvm)/\($0)/bin" }
        }
        directories.append("/usr/bin")
        for directory in directories {
            let candidate = (directory as NSString).appendingPathComponent("node")
            if fm.isExecutableFile(atPath: candidate) { return URL(fileURLWithPath: candidate) }
        }
        return nil
    }
}

// MARK: - Port 3200

enum PortProbe {
    enum Status: Sendable {
        /// Personne n'écoute sur le port.
        case free
        /// Un serveur HTTP répond (quel que soit le code de statut).
        case responding
        /// Le port est pris, mais aucune réponse HTTP pour l'instant (serveur qui démarre, autre programme…).
        case listening
    }

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.connectionProxyDictionary = [:]
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    static func status(port: UInt16, url: URL, timeout: TimeInterval) async -> Status {
        // Test de connexion bloquant (bref) : toujours hors du fil principal.
        guard await Task.detached(operation: { isListening(port: port) }).value else { return .free }
        return await responds(url: url, timeout: timeout) ? .responding : .listening
    }

    /// Vrai si le serveur renvoie une réponse HTTP, quelle qu'elle soit.
    ///
    /// `url` est une ressource statique inexistante (AppConfig.probeURL) : Next.js répond « 404 » en
    /// texte brut sans rendre de page, sans ouvrir la base et sans attendre la compilation d'une page
    /// par `npm run dev`.
    static func responds(url: URL, timeout: TimeInterval) async -> Bool {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        request.httpMethod = "HEAD"
        request.setValue("VigieDesktop/1.0 (sonde)", forHTTPHeaderField: "User-Agent")
        do {
            let (_, response) = try await session.data(for: request)
            return response is HTTPURLResponse
        } catch {
            return false
        }
    }

    /// Vrai si quelque chose écoute sur le port, en IPv6 (::1) ou en IPv4 (127.0.0.1).
    /// Les deux sont testés : un serveur lié à une seule des deux adresses ouvrirait quand même la base.
    static func isListening(port: UInt16) -> Bool {
        canConnect(family: AF_INET6, address: "::1", port: port)
            || canConnect(family: AF_INET, address: "127.0.0.1", port: port)
    }

    private static func canConnect(family: Int32, address: String, port: UInt16, timeoutMilliseconds: Int32 = 500) -> Bool {
        let fd = socket(family, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var noSigPipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK)

        guard let result = SocketAddress.with(family: family, address: address, port: port, { connect(fd, $0, $1) }) else {
            return false
        }
        if result == 0 { return true }
        guard errno == EINPROGRESS else { return false }
        var descriptor = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        guard poll(&descriptor, 1, timeoutMilliseconds) == 1 else { return false }
        var socketError: Int32 = 0
        var length = socklen_t(MemoryLayout<Int32>.size)
        guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &socketError, &length) == 0 else { return false }
        return socketError == 0
    }
}

/// Adresse de socket IPv4 ou IPv6 construite à partir de sa forme texte.
enum SocketAddress {
    /// Appelle `body` avec l'adresse (`sockaddr_in` ou `sockaddr_in6`) ; nil si l'adresse est invalide.
    static func with(family: Int32, address: String, port: UInt16,
                     _ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32? {
        if family == AF_INET6 {
            var addr = sockaddr_in6()
            addr.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
            addr.sin6_family = sa_family_t(AF_INET6)
            addr.sin6_port = port.bigEndian
            guard inet_pton(AF_INET6, address, &addr.sin6_addr) == 1 else { return nil }
            return withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, socklen_t(MemoryLayout<sockaddr_in6>.size)) }
            }
        }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        guard inet_pton(AF_INET, address, &addr.sin_addr) == 1 else { return nil }
        return withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
    }
}

/// Réservation du port 3200 pendant que le serveur lancé par l'application tourne.
///
/// Le serveur n'écoute que sur ::1 (boucle locale) : il n'est pas joignable depuis le réseau.
/// L'application garde liées, sans écouter, les adresses 0.0.0.0, 127.0.0.1 et :: du même port.
/// Ainsi un `npm run dev` lancé ensuite échoue (EADDRINUSE), comme lorsqu'il trouvait le port pris
/// sur toutes les interfaces, au lieu de s'installer à côté et d'ouvrir la même base PGlite ; de même
/// pour `next dev -H 0.0.0.0`, `-H 127.0.0.1`, `-H ::1` ou `-H localhost`. WebKit joint localhost
/// par ::1 en premier : la réservation de 127.0.0.1 ne ralentit pas l'application.
/// Les sockets sont fermés à l'arrêt du serveur, et par le système si l'application plante.
enum PortGuard {
    /// Adresse d'écoute du serveur (`next start --hostname`).
    static let serverHost = "::1"

    /// Réserve le port ; nil si une adresse est indisponible (rien n'est alors réservé).
    static func reserve(port: UInt16) -> [Int32]? {
        var sockets: [Int32] = []
        for (family, address) in [(AF_INET, "0.0.0.0"), (AF_INET, "127.0.0.1"), (AF_INET6, "::")] {
            guard let fd = bind(family: family, address: address, port: port) else {
                release(sockets)
                return nil
            }
            sockets.append(fd)
        }
        return sockets
    }

    static func release(_ sockets: [Int32]) {
        for fd in sockets { close(fd) }
    }

    private static func bind(family: Int32, address: String, port: UInt16) -> Int32? {
        let fd = socket(family, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else { return nil }
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC) // pas hérité par Node
        var on: Int32 = 1
        let size = socklen_t(MemoryLayout<Int32>.size)
        if family == AF_INET6 {
            // :: seulement en IPv6 : 0.0.0.0 est réservé à part.
            setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &on, size)
        }
        if address != "0.0.0.0" && address != "::" {
            // Adresse précise à côté de l'adresse générique de la même famille.
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, size)
        }
        let result = SocketAddress.with(family: family, address: address, port: port) { Darwin.bind(fd, $0, $1) }
        guard result == 0 else {
            close(fd)
            return nil
        }
        return fd
    }
}

// MARK: - Compilation de production

/// Date de modification et taille d'un fichier source.
struct SourceEntry: Codable, Sendable, Equatable {
    let modified: Double
    let size: Int
}

/// Fichiers et dossiers sources du projet (chemins relatifs au projet, fichiers cachés exclus).
struct SourceTree: Sendable {
    var files: [String: SourceEntry] = [:]
    /// Dates de modification des dossiers : elles changent quand un fichier y est ajouté, supprimé ou renommé.
    var directories: [String: Double] = [:]
}

/// Compilation menée à son terme par l'application : identifiant de la compilation (contenu et date
/// de .next/BUILD_ID) et état des sources au moment où elle a commencé.
/// ~/Library/Application Support/Vigie/build-stamp.json
struct BuildStamp: Codable, Sendable {
    let projectPath: String
    let buildID: String
    let buildIDModified: Double
    let startedAt: Double
    let sources: [String: SourceEntry]

    static func read() -> BuildStamp? {
        guard let data = try? Data(contentsOf: AppPaths.buildStamp) else { return nil }
        return try? JSONDecoder().decode(BuildStamp.self, from: data)
    }

    static func remove() {
        try? FileManager.default.removeItem(at: AppPaths.buildStamp)
    }

    /// Enregistre la compilation qui vient de réussir ; faux si .next/BUILD_ID est introuvable.
    static func record(projectURL: URL, startedAt: Date, sources: [String: SourceEntry]) -> Bool {
        guard let build = BuildChecker.currentBuild(projectURL: projectURL) else { return false }
        let stamp = BuildStamp(projectPath: projectURL.path, buildID: build.id,
                               buildIDModified: build.modified.timeIntervalSince1970,
                               startedAt: startedAt.timeIntervalSince1970, sources: sources)
        AppPaths.ensureDirectories()
        guard let data = try? JSONEncoder().encode(stamp) else { return false }
        return (try? data.write(to: AppPaths.buildStamp, options: .atomic)) != nil
    }

    func matches(_ build: BuildChecker.BuildInfo, projectURL: URL) -> Bool {
        projectPath == projectURL.path && buildID == build.id
            && abs(buildIDModified - build.modified.timeIntervalSince1970) < 0.001
    }
}

enum BuildChecker {
    enum Status: Sendable, Equatable {
        case upToDate
        /// Pas de .next/BUILD_ID : première compilation (ou compilation précédente invalidée).
        case missing
        /// BUILD_ID présent, mais la compilation ne s'est pas terminée (échec, interruption).
        case incomplete
        /// Les sources ont changé depuis la compilation (« src/app/page.tsx modifié »…).
        case outdated(String)
    }

    struct BuildInfo: Sendable {
        let id: String
        let modified: Date
    }

    /// Fichiers de configuration qui, modifiés, imposent une nouvelle compilation.
    static let rootFiles = ["package.json", "package-lock.json", "next.config.ts", "next.config.js", "next.config.mjs",
                            "tsconfig.json", ".env", ".env.local", ".env.production", ".env.production.local"]
    /// Dossiers sources parcourus (fichiers cachés ignorés, .DS_Store compris).
    static let sourceDirectories = ["src", "public", "drizzle"]
    /// Manifestes que `next build` écrit après BUILD_ID, une fois les pages statiques générées.
    /// (Next écrit BUILD_ID avant la génération des pages : sa présence seule ne prouve rien.)
    static let completionMarkers = ["prerender-manifest.json", "export-marker.json"]

    static func status(projectURL: URL) -> Status {
        guard let build = currentBuild(projectURL: projectURL) else { return .missing }
        let tree = sourceTree(projectURL: projectURL)

        // Compilation faite par l'application : comparaison exacte avec l'état des sources à son début
        // (modifications, ajouts, suppressions, renommages, fichiers restaurés avec une date ancienne).
        if let stamp = BuildStamp.read(), stamp.matches(build, projectURL: projectURL) {
            return firstChange(from: stamp.sources, to: tree.files).map { .outdated($0) } ?? .upToDate
        }

        // Compilation faite hors de l'application (npm run build dans le Terminal), ou interrompue sans
        // que l'application ait pu l'invalider (arrêt forcé) : on s'en tient aux dates.
        guard isComplete(projectURL: projectURL, builtAt: build.modified) else { return .incomplete }
        return firstNewer(than: build.modified, in: tree).map { .outdated($0) } ?? .upToDate
    }

    /// Contenu et date de .next/BUILD_ID ; nil s'il n'existe pas.
    static func currentBuild(projectURL: URL) -> BuildInfo? {
        let url = buildIDURL(projectURL)
        guard let modified = modificationDate(of: url),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let id = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return id.isEmpty ? nil : BuildInfo(id: id, modified: modified)
    }

    /// Supprime .next/BUILD_ID après une compilation échouée ou interrompue : le lancement suivant
    /// recompile au lieu de démarrer `next start` sur une compilation incomplète.
    static func invalidate(projectURL: URL) {
        try? FileManager.default.removeItem(at: buildIDURL(projectURL))
    }

    /// Fichiers de configuration et contenu de src/, public/ et drizzle/.
    static func sourceTree(projectURL: URL) -> SourceTree {
        let fm = FileManager.default
        var tree = SourceTree()
        for name in rootFiles {
            if let attributes = try? fm.attributesOfItem(atPath: projectURL.appendingPathComponent(name).path),
               let entry = entry(attributes) {
                tree.files[name] = entry
            }
        }
        for name in sourceDirectories {
            let directory = projectURL.appendingPathComponent(name, isDirectory: true)
            guard let rootDate = modificationDate(of: directory),
                  let walker = fm.enumerator(atPath: directory.path) else { continue }
            tree.directories[name] = rootDate.timeIntervalSince1970
            while let relative = walker.nextObject() as? String {
                let attributes = walker.fileAttributes ?? [:]
                let type = attributes[.type] as? FileAttributeType
                if (relative as NSString).lastPathComponent.hasPrefix(".") {
                    if type == .typeDirectory { walker.skipDescendants() }
                    continue
                }
                let path = "\(name)/\(relative)"
                if type == .typeDirectory {
                    if let date = attributes[.modificationDate] as? Date {
                        tree.directories[path] = date.timeIntervalSince1970
                    }
                } else if type == .typeRegular, let entry = entry(attributes) {
                    tree.files[path] = entry
                }
            }
        }
        return tree
    }

    private static func firstChange(from old: [String: SourceEntry], to new: [String: SourceEntry]) -> String? {
        for path in new.keys.sorted() {
            guard let before = old[path] else { return "\(path) ajouté" }
            if before != new[path] { return "\(path) modifié" }
        }
        for path in old.keys.sorted() where new[path] == nil {
            return "\(path) supprimé"
        }
        return nil
    }

    private static func firstNewer(than date: Date, in tree: SourceTree) -> String? {
        let limit = date.timeIntervalSince1970
        for path in tree.files.keys.sorted() where (tree.files[path]?.modified ?? 0) > limit {
            return "\(path) modifié"
        }
        for path in tree.directories.keys.sorted() where (tree.directories[path] ?? 0) > limit {
            return "fichier ajouté, supprimé ou renommé dans \(path)/"
        }
        return nil
    }

    private static func isComplete(projectURL: URL, builtAt: Date) -> Bool {
        completionMarkers.allSatisfy { name in
            guard let date = modificationDate(of: projectURL.appendingPathComponent(".next/\(name)")) else { return false }
            return date >= builtAt.addingTimeInterval(-1)
        }
    }

    private static func entry(_ attributes: [FileAttributeKey: Any]) -> SourceEntry? {
        guard let date = attributes[.modificationDate] as? Date else { return nil }
        let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
        return SourceEntry(modified: date.timeIntervalSince1970, size: size)
    }

    private static func buildIDURL(_ projectURL: URL) -> URL {
        projectURL.appendingPathComponent(".next/BUILD_ID")
    }

    private static func modificationDate(of url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }
}

// MARK: - Processus

enum ProcessTools {
    struct StartTime: Sendable, Equatable {
        let seconds: Int
        let microseconds: Int32
    }

    /// Date de démarrage d'un processus (sysctl KERN_PROC_PID) ; nil s'il n'existe pas.
    /// Associée au PID, elle identifie un processus sans risque de confusion avec un PID réutilisé.
    static func startTime(of pid: pid_t) -> StartTime? {
        guard pid > 0 else { return nil }
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0, size > 0 else { return nil }
        let started = info.kp_proc.p_un.__p_starttime
        return StartTime(seconds: started.tv_sec, microseconds: started.tv_usec)
    }

    static func isAlive(_ pid: pid_t) -> Bool {
        guard pid > 0 else { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }

    /// Envoie un signal au groupe du processus (Foundation.Process place chaque enfant dans son
    /// propre groupe : Node et ses éventuels sous-processus le reçoivent ensemble).
    static func signalGroup(_ pid: pid_t, _ signal: Int32) {
        guard pid > 1 else { return }
        if kill(-pid, signal) != 0 { _ = kill(pid, signal) }
    }

    /// SIGTERM, attente jusqu'à `grace` secondes, puis SIGKILL. Bloquant.
    static func terminateGroup(_ pid: pid_t, grace: TimeInterval) {
        guard isAlive(pid) else { return }
        signalGroup(pid, SIGTERM)
        let deadline = Date().addingTimeInterval(grace)
        while isAlive(pid), Date() < deadline { usleep(50_000) }
        if isAlive(pid) {
            signalGroup(pid, SIGKILL)
            let hardDeadline = Date().addingTimeInterval(2)
            while isAlive(pid), Date() < hardDeadline { usleep(20_000) }
        }
    }
}

/// ~/Library/Application Support/Vigie/server.pid : processus lancé par l'application (serveur ou
/// compilation), pour retrouver et arrêter un orphelin après un plantage.
enum PidFile {
    struct Record: Sendable {
        let pid: pid_t
        let startTime: ProcessTools.StartTime
        let kind: String
    }

    static func write(_ record: Record) {
        AppPaths.ensureDirectories()
        let line = "\(record.pid) \(record.startTime.seconds) \(record.startTime.microseconds) \(record.kind)\n"
        try? Data(line.utf8).write(to: AppPaths.pidFile, options: .atomic)
    }

    static func read() -> Record? {
        guard let text = try? String(contentsOf: AppPaths.pidFile, encoding: .utf8) else { return nil }
        let fields = text.split(whereSeparator: { $0 == " " || $0.isNewline })
        guard fields.count >= 4, let pid = pid_t(fields[0]), let seconds = Int(fields[1]),
              let microseconds = Int32(fields[2]) else { return nil }
        return Record(pid: pid, startTime: .init(seconds: seconds, microseconds: microseconds), kind: String(fields[3]))
    }

    static func remove() {
        try? FileManager.default.removeItem(at: AppPaths.pidFile)
    }
}

enum OrphanGuard {
    /// Arrête le serveur (ou la compilation) laissé par une session précédente de Vigie qui s'est
    /// mal terminée. Le processus n'est arrêté que si son PID *et* sa date de démarrage
    /// correspondent au fichier PID. Renvoie une note pour le journal, ou nil.
    static func cleanUp() -> String? {
        guard let record = PidFile.read() else { return nil }
        defer { PidFile.remove() }
        guard record.pid > 1, let started = ProcessTools.startTime(of: record.pid), started == record.startTime else {
            return nil
        }
        ProcessTools.terminateGroup(record.pid, grace: 5)
        return "Processus « \(record.kind) » resté actif après une session précédente (PID \(record.pid)) : arrêté."
    }
}

// MARK: - Surveillance du processus parent

/// Script préchargé dans Node (`node --require …`) : si l'application disparaît sans arrêter son
/// serveur (plantage, arrêt forcé), Node est rattaché à launchd, son PID parent change, et il
/// s'arrête proprement (SIGTERM) au lieu de garder la base PGlite ouverte.
enum ParentWatchdog {
    static let source = """
    // Vigie (application Mac) — script préchargé par `node --require`.
    // Arrête ce processus si l'application qui l'a lancé disparaît (plantage, arrêt forcé).
    'use strict';
    const initialParent = process.ppid;
    const timer = setInterval(() => {
      if (process.ppid === initialParent) return;
      clearInterval(timer);
      try { process.kill(process.pid, 'SIGTERM'); } catch {}
      setTimeout(() => process.exit(1), 10000).unref();
    }, 2000);
    timer.unref();

    """

    /// Écrit le script dans Application Support (hors du paquet de l'application, qui peut se trouver
    /// sur le Bureau, dossier protégé). Renvoie son emplacement, ou nil en cas d'échec.
    static func install() -> URL? {
        AppPaths.ensureDirectories()
        let url = AppPaths.watchdogScript
        let data = Data(source.utf8)
        if (try? Data(contentsOf: url)) == data { return url }
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
