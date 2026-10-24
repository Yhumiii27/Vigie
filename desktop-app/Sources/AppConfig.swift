import Foundation

/// Réglages de l'application : dossier du projet, Node.js, port et adresses du serveur local.
///
/// Le chemin du projet et le dossier de Node.js sont inscrits dans Info.plist par build.sh
/// (clés `VigieProjectPath` et `VigieNodeDir`). Le chemin du projet peut être remplacé sans
/// reconstruire : `defaults write com.epc2i.vigie VigieProjectPath "/chemin/vers/Vigie"`.
/// Accès depuis le réseau local (désactivé par défaut) :
/// `defaults write com.epc2i.vigie VigieNetworkAccess -bool true`.
///
/// Client du serveur central (PRD-14) : avec `defaults write com.epc2i.vigie VigieServerURL "https://vigie.epc2i.fr"`
/// (ou la clé `VigieServerURL` d'Info.plist, posée par `VIGIE_SERVER_URL=… bash desktop-app/build.sh`), l'application
/// n'a plus besoin du projet ni de Node.js : elle ouvre le serveur central (connexion Microsoft Entra ID dans la
/// fenêtre), sans lancer de serveur local ni de base PGlite. Retour au serveur local de démonstration :
/// `defaults delete com.epc2i.vigie VigieServerURL`.
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
    /// Serveur central (https, ou http sur ce Mac pour un essai) ; nil = serveur local de démonstration lancé par l'application.
    let remoteServerURL: URL?

    /// Vrai si l'application est cliente du serveur central (aucun serveur local).
    var isRemote: Bool { remoteServerURL != nil }

    static func load(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> AppConfig {
        let info = bundle.infoDictionary ?? [:]
        let projectPath = nonEmpty(defaults.string(forKey: "VigieProjectPath"))
            ?? nonEmpty(info["VigieProjectPath"] as? String)
            ?? "/Users/gga/Systeme EPC2i/Vigie"
        let remote = serverOrigin(nonEmpty(defaults.string(forKey: "VigieServerURL")) ?? nonEmpty(info["VigieServerURL"] as? String))
        if let remote {
            return AppConfig(
                projectURL: URL(fileURLWithPath: projectPath, isDirectory: true).standardizedFileURL,
                nodeDirectoryHint: nil,
                version: nonEmpty(info["CFBundleShortVersionString"] as? String) ?? "1.0",
                build: nonEmpty(info["CFBundleVersion"] as? String) ?? "1",
                allowsNetworkAccess: false,
                baseURL: remote,
                // Route de santé du serveur central (publique, sans session, 200 ou 503).
                probeURL: remote.appendingPathComponent("api/sante"),
                remoteServerURL: remote)
        }
        return AppConfig(
            projectURL: URL(fileURLWithPath: projectPath, isDirectory: true).standardizedFileURL,
            nodeDirectoryHint: nonEmpty(info["VigieNodeDir"] as? String),
            version: nonEmpty(info["CFBundleShortVersionString"] as? String) ?? "1.0",
            build: nonEmpty(info["CFBundleVersion"] as? String) ?? "1",
            allowsNetworkAccess: defaults.bool(forKey: "VigieNetworkAccess"),
            baseURL: localURL(host: "localhost"),
            probeURL: localURL(host: "localhost", path: "/_next/static/vigie-desktop-probe"),
            remoteServerURL: nil)
    }

    /// Origine du serveur central (schéma, hôte, port ; sans chemin) : https, ou http pour localhost seulement
    /// (essai sur ce Mac). Toute autre valeur est ignorée (serveur local de démonstration).
    static func serverOrigin(_ raw: String?) -> URL? {
        guard let raw, var components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        let loopback = ["localhost", "127.0.0.1", "::1"].contains(host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")))
        guard scheme == "https" || (scheme == "http" && loopback) else { return nil }
        components.scheme = scheme
        components.path = "/"
        components.query = nil
        components.fragment = nil
        components.user = nil
        components.password = nil
        return components.url
    }

    /// Vrai pour une adresse servie par Vigie : le serveur central (même schéma, hôte et port), sinon le serveur local
    /// (localhost, 127.0.0.1 ou ::1, port 3200).
    func isAppURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              var host = components.host?.lowercased() else { return false }
        if let remote = remoteServerURL {
            let defaultPort = { (s: String) in s == "https" ? 443 : 80 }
            let remoteScheme = remote.scheme?.lowercased() ?? "https"
            return scheme == remoteScheme && host == remote.host?.lowercased()
                && (components.port ?? defaultPort(scheme)) == (remote.port ?? defaultPort(remoteScheme))
        }
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
