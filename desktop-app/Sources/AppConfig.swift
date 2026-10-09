import Foundation

/// Réglages de l'application : dossier du projet, Node.js, port et adresses du serveur local.
///
/// Le chemin du projet et le dossier de Node.js sont inscrits dans Info.plist par build.sh
/// (clés `VigieProjectPath` et `VigieNodeDir`). Le chemin du projet peut être remplacé sans
/// reconstruire : `defaults write com.epc2i.vigie VigieProjectPath "/chemin/vers/Vigie"`.
/// Accès depuis le réseau local (désactivé par défaut) :
/// `defaults write com.epc2i.vigie VigieNetworkAccess -bool true`.
struct AppConfig: Sendable {
    /// Port des scripts `dev` et `start` du projet.
    static let port: UInt16 = 3200

    let projectURL: URL
    let nodeDirectoryHint: String?
    let version: String
    let build: String
    /// Vrai si le serveur lancé par l'application doit écouter sur toutes les interfaces (téléphone du
    /// réseau local pour /signaler, par exemple). Par défaut il n'écoute que sur ce Mac (::1).
    let allowsNetworkAccess: Bool

    /// Adresse chargée dans les fenêtres. `localhost` plutôt que 127.0.0.1 : le serveur de
    /// développement Next.js (npm run dev) n'accepte ses ressources internes (/_next, HMR)
    /// que depuis localhost, et les cookies (rôle, site) restent attachés à un seul hôte.
    let baseURL: URL
    /// Adresse sondée pour savoir si un serveur répond : ressource statique inexistante, à laquelle
    /// Next.js répond aussitôt « 404 » sans rendre de page (voir PortProbe.responds).
    let probeURL: URL

    static func load(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> AppConfig {
        let info = bundle.infoDictionary ?? [:]
        let projectPath = nonEmpty(defaults.string(forKey: "VigieProjectPath"))
            ?? nonEmpty(info["VigieProjectPath"] as? String)
            ?? "/Users/gga/Systeme EPC2i/Vigie"
        return AppConfig(
            projectURL: URL(fileURLWithPath: projectPath, isDirectory: true).standardizedFileURL,
            nodeDirectoryHint: nonEmpty(info["VigieNodeDir"] as? String),
            version: nonEmpty(info["CFBundleShortVersionString"] as? String) ?? "1.0",
            build: nonEmpty(info["CFBundleVersion"] as? String) ?? "1",
            allowsNetworkAccess: defaults.bool(forKey: "VigieNetworkAccess"),
            baseURL: localURL(host: "localhost"),
            probeURL: localURL(host: "localhost", path: "/_next/static/vigie-desktop-probe"))
    }

    /// Vrai pour une adresse servie par le serveur local de Vigie (localhost, 127.0.0.1 ou ::1, port 3200).
    func isAppURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              var host = components.host?.lowercased() else { return false }
        host = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard ["localhost", "127.0.0.1", "::1"].contains(host) else { return false }
        return (components.port ?? (scheme == "https" ? 443 : 80)) == Int(Self.port)
    }

    private static func localURL(host: String, path: String = "/") -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = Int(port)
        components.path = path
        return components.url ?? URL(fileURLWithPath: "/")
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}

/// Emplacements des fichiers de l'application (hors du projet).
enum AppPaths {
    private static var home: URL { FileManager.default.homeDirectoryForCurrentUser }

    /// ~/Library/Application Support/Vigie : PID du serveur, verrou d'instance, script de surveillance,
    /// témoin de la dernière compilation réussie.
    static var supportDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? home.appendingPathComponent("Library/Application Support", isDirectory: true)
        return base.appendingPathComponent("Vigie", isDirectory: true)
    }

    /// ~/Library/Logs/Vigie
    static var logsDirectory: URL {
        home.appendingPathComponent("Library/Logs/Vigie", isDirectory: true)
    }

    static var serverLog: URL { logsDirectory.appendingPathComponent("server.log") }
    static var previousServerLog: URL { logsDirectory.appendingPathComponent("server.log.1") }
    static var pidFile: URL { supportDirectory.appendingPathComponent("server.pid") }
    static var buildStamp: URL { supportDirectory.appendingPathComponent("build-stamp.json") }
    static var instanceLock: URL { supportDirectory.appendingPathComponent("instance.lock") }
    static var watchdogScript: URL { supportDirectory.appendingPathComponent("parent-watchdog.cjs") }

    static var downloadsDirectory: URL {
        FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? home.appendingPathComponent("Downloads", isDirectory: true)
    }

    static func ensureDirectories() {
        for directory in [supportDirectory, logsDirectory] {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }
}
