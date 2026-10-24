import AppKit
import WebKit

/// Cycle de vie de l'application : instance unique, fenêtre principale, serveur, menus, arrêt propre.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, ServerControllerDelegate, WebWindowHost {
    let config = AppConfig.load()
    private lazy var server = ServerController(config: config)
    private var mainWindow: WebWindowController?
    private var secondaryWindows: [WebWindowController] = []
    private var signalSources: [any DispatchSourceSignal] = []
    private var instanceLock: Int32 = -1
    /// Une demande de fermeture a été émise (⌘Q, fermeture de la fenêtre principale, signal, règle
    /// « dernière fenêtre fermée ») : les suivantes sont ignorées, pour qu'AppKit n'en reçoive qu'une.
    private var terminationRequested = false
    /// applicationShouldTerminate a accepté la fermeture (arrêt du serveur en cours ou terminé).
    private var isTerminating = false

    // MARK: Lancement

    func applicationWillFinishLaunching(_ notification: Notification) {
        AppPaths.ensureDirectories()
        // Instance unique : si Vigie tourne déjà, on l'active et on s'arrête là.
        guard acquireInstanceLock() else {
            activateOtherInstance()
            exit(0)
        }
        NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApplication.shared.mainMenu = MainMenu.make(appDelegate: self)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installSignalHandlers()

        let main = WebWindowController(role: .main, configuration: WebSession.shared.configuration, host: self)
        mainWindow = main
        main.showWindow(nil)
        main.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApplication.shared.activate()
        } else {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }

        server.delegate = self
        server.start()
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    /// Fermer la dernière fenêtre quitte l'application, sauf si la fermeture est déjà demandée
    /// (fenêtre principale fermée, ⌘Q pendant l'arrêt du serveur…) : pas de second `terminate`.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        guard !terminationRequested else { return false }
        terminationRequested = true
        return true
    }

    /// Clic sur l'icône du Dock : ramène la fenêtre principale si elle n'est plus visible.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag, let window = mainWindow?.window {
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }

    // MARK: Arrêt

    /// Point d'entrée unique des fermetures demandées par l'application elle-même (menu Quitter,
    /// bouton « Quitter », fermeture de la fenêtre principale, SIGTERM…) : un seul `terminate`.
    func requestTermination() {
        guard !terminationRequested else { return }
        terminationRequested = true
        NSApplication.shared.terminate(nil)
    }

    @objc func quitApplication(_ sender: Any?) {
        requestTermination()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Fermeture demandée par le système (Dock, fermeture de session) pendant l'arrêt du serveur :
        // la première demande aboutira.
        guard !isTerminating else { return .terminateCancel }
        isTerminating = true
        terminationRequested = true
        guard server.hasRunningChild else {
            return .terminateNow // rien à arrêter (serveur réutilisé, ou pas encore lancé)
        }
        // Le serveur lancé par l'application est arrêté avant de quitter (SIGTERM, puis SIGKILL après 5 s).
        // Arrêt synchrone : avec .terminateLater, AppKit attend la réponse dans une boucle modale qui ne
        // traite pas la file principale, si bien qu'une tâche @MainActor n'y répondait jamais (blocage).
        server.stopImmediately()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        server.stopImmediately() // filet de sécurité, normalement sans effet
        if instanceLock >= 0 { close(instanceLock) }
    }

    /// SIGTERM / SIGINT / SIGHUP (kill, Ctrl-C dans un terminal, build.sh qui remplace l'application) :
    /// même chemin que ⌘Q, pour arrêter le serveur.
    private func installSignalHandlers() {
        for signalNumber in [SIGTERM, SIGINT, SIGHUP] {
            signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in
                MainActor.assumeIsolated {
                    self?.requestTermination()
                }
            }
            source.resume()
            signalSources.append(source)
        }
    }

    // MARK: Instance unique

    private func acquireInstanceLock() -> Bool {
        let fd = open(AppPaths.instanceLock.path, O_RDWR | O_CREAT | O_CLOEXEC, 0o644)
        guard fd >= 0 else { return true } // verrou impossible : on ne bloque pas le lancement
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            close(fd)
            return false
        }
        instanceLock = fd
        return true
    }

    private func activateOtherInstance() {
        let identifier = Bundle.main.bundleIdentifier ?? "com.epc2i.vigie"
        let current = ProcessInfo.processInfo.processIdentifier
        guard let other = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
            .first(where: { $0.processIdentifier != current }) else { return }
        if #available(macOS 14.0, *) {
            other.activate()
        } else {
            other.activate(options: [.activateIgnoringOtherApps])
        }
    }

    // MARK: ServerControllerDelegate

    func serverController(_ controller: ServerController, didChange state: ServerState) {
        guard let mainWindow else { return }
        switch state {
        case .working(let status, let detail):
            mainWindow.showStatus(status, detail: detail)
        case .ready(let url):
            mainWindow.serverDidBecomeReady(baseURL: url)
        case .failed(let failure):
            mainWindow.showFailure(failure)
        case .stopping:
            mainWindow.showStatus(Texts.stopping, detail: nil)
        }
    }

    // MARK: WebWindowHost

    func openWindow(configuration: WKWebViewConfiguration, features: WKWindowFeatures?,
                    from: WebWindowController) -> WebWindowController {
        let controller = WebWindowController(role: .secondary, configuration: configuration, host: self, features: features)
        controller.opener = from
        secondaryWindows.append(controller)
        // Affichée au premier contenu de la page : pas de fenêtre vide si le lien aboutit à un téléchargement.
        controller.presentWhenReady()
        return controller
    }

    func webWindowDidFailToReachServer(_ controller: WebWindowController, error: NSError) {
        Task {
            if await server.isResponding() {
                controller.showPageFailure(error.localizedDescription)
            } else {
                server.reportUnreachable()
                if controller.role == .secondary { controller.showPageFailure(error.localizedDescription) }
            }
        }
    }

    func webWindowRequestsServerRetry(_ controller: WebWindowController) {
        server.start()
    }

    func webWindowWillClose(_ controller: WebWindowController) {
        switch controller.role {
        case .main:
            // Fermer la fenêtre principale quitte l'application (et arrête le serveur qu'elle a lancé),
            // même si d'autres fenêtres sont ouvertes. Hors de windowWillClose, pour ne pas y imbriquer
            // l'attente de l'arrêt du serveur. Si c'était la dernière fenêtre, la règle « dernière fenêtre
            // fermée » a peut-être déjà demandé la fermeture : requestTermination ne la répète pas.
            Task { @MainActor in self.requestTermination() }
        case .secondary:
            secondaryWindows.removeAll { $0 === controller }
        }
    }

    func showServerLog() {
        ServerLog.ensureExists()
        NSWorkspace.shared.open(ServerLog.url)
    }

    // MARK: Actions des menus

    @objc func showAbout(_ sender: Any?) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let serverLine: String
        switch server.mode {
        case .owned where server.listensOnNetwork:
            serverLine = "Serveur lancé par l'application, accessible depuis le réseau local"
        case .owned: serverLine = "Serveur local lancé par l'application (accessible depuis ce Mac seulement)"
        case .attached: serverLine = "Serveur déjà actif réutilisé"
        case .remote: serverLine = "Client du serveur central"
        case .none: serverLine = "Serveur non démarré"
        }
        let credits = NSAttributedString(
            string: "Pilotage QHSE — EPC2i\n\(serverLine) · \(config.baseURL.absoluteString)",
            attributes: [.font: NSFont.systemFont(ofSize: 11),
                         .foregroundColor: NSColor.secondaryLabelColor,
                         .paragraphStyle: paragraph])
        NSApplication.shared.orderFrontStandardAboutPanel(options: [
            .applicationName: "Vigie",
            .applicationVersion: config.version,
            .version: config.build,
            .credits: credits,
        ])
        if #available(macOS 14.0, *) {
            NSApplication.shared.activate()
        } else {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    }

    /// Ouvre la page affichée (ou l'accueil) dans le navigateur par défaut.
    @objc func openInBrowser(_ sender: Any?) {
        let active = (NSApplication.shared.keyWindow?.windowController as? WebWindowController) ?? mainWindow
        if let url = active?.webView.url, config.isAppURL(url) {
            NSWorkspace.shared.open(url)
        } else {
            NSWorkspace.shared.open(config.baseURL)
        }
    }

    @objc func showServerLogAction(_ sender: Any?) {
        showServerLog()
    }
}
