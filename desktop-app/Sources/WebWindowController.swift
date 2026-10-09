import AppKit
import WebKit

/// Ce qu'une fenêtre demande à l'application.
@MainActor
protocol WebWindowHost: AnyObject {
    var config: AppConfig { get }
    /// Nouvelle fenêtre de l'application pour une page interne (target=_blank, window.open, ⌘-clic).
    func openWindow(configuration: WKWebViewConfiguration, features: WKWindowFeatures?, from: WebWindowController) -> WebWindowController
    /// Une page interne n'a pas pu joindre le serveur.
    func webWindowDidFailToReachServer(_ controller: WebWindowController, error: NSError)
    func webWindowRequestsServerRetry(_ controller: WebWindowController)
    func showServerLog()
    func webWindowWillClose(_ controller: WebWindowController)
    /// Quitter l'application (une seule demande, voir AppDelegate.requestTermination).
    func requestTermination()
}

/// Fenêtre de l'application : un WKWebView et, pour la fenêtre principale, la vue de chargement native.
@MainActor
final class WebWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, NSMenuItemValidation {
    enum Role {
        /// Fenêtre principale : sa fermeture quitte l'application.
        case main
        /// Fenêtre ouverte depuis une page (revue de direction, pièce jointe…).
        case secondary
    }

    static let zoomDefaultsKey = "VigiePageZoom"
    private static let zoomLevels: [CGFloat] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]

    let role: Role
    let webView: WKWebView
    /// Fenêtre dont un lien a ouvert celle-ci : le bandeau d'un téléchargement y est affiché quand
    /// cette fenêtre n'a rien montré (pièce jointe Word ou Excel ouverte par un lien target=_blank).
    weak var opener: WebWindowController?
    private weak var host: WebWindowHost?
    private let appConfig: AppConfig
    private let container = NSView()
    private let loadingView: LoadingView?
    private var titleObservation: NSKeyValueObservation?
    /// Vrai entre « serveur prêt » et la fin du premier chargement : la vue de chargement reste affichée.
    private var revealPending = false
    private var revealFallback: Task<Void, Never>?
    private weak var toast: ToastView?
    /// Vrai dès que la page a commencé à s'afficher (didCommit).
    private var hasCommitted = false
    /// Fenêtre secondaire : affichage différé jusqu'au premier contenu (voir presentWhenReady).
    private var presentTask: Task<Void, Never>?
    /// Fenêtre secondaire retirée de l'écran parce que son lien est devenu un téléchargement ;
    /// elle est fermée à la fin de celui-ci.
    private var carriesDownload = false
    /// Arrêts récents du processus d'affichage de WebKit (protection contre une boucle de rechargements).
    private var contentProcessTerminations: [Date] = []

    init(role: Role, configuration: WKWebViewConfiguration, host: WebWindowHost, features: WKWindowFeatures? = nil) {
        self.role = role
        self.host = host
        self.appConfig = host.config
        self.webView = WKWebView(frame: .zero, configuration: configuration)
        self.loadingView = role == .main ? LoadingView() : nil

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        super.init(window: window)

        configureWindow(window, features: features)
        configureWebView()
        layoutContent(in: window)
    }

    required init?(coder: NSCoder) {
        return nil
    }

    // MARK: Mise en place

    private func configureWindow(_ window: NSWindow, features: WKWindowFeatures?) {
        window.title = "Vigie"
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = Brand.background
        window.titlebarAppearsTransparent = true // la barre de titre prend la couleur de fond
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self

        let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        switch role {
        case .main:
            window.contentMinSize = NSSize(width: 1100, height: 700)
            let size = NSSize(width: max(min(1440, visible.width - 40), 1100),
                              height: max(min(900, visible.height - 40), 700))
            window.setContentSize(size)
            window.center()
            window.setFrameAutosaveName("VigieMainWindow")
            window.setFrameUsingName("VigieMainWindow")
        case .secondary:
            window.contentMinSize = NSSize(width: 640, height: 480)
            var size = NSSize(width: min(1180, visible.width - 80), height: min(860, visible.height - 80))
            if let width = features?.width?.doubleValue, width > 0 { size.width = min(max(width, 640), visible.width) }
            if let height = features?.height?.doubleValue, height > 0 { size.height = min(max(height, 480), visible.height) }
            window.setContentSize(size)
            if let reference = NSApplication.shared.keyWindow ?? NSApplication.shared.mainWindow {
                window.setFrameTopLeftPoint(NSPoint(x: reference.frame.minX + 28, y: reference.frame.maxY - 28))
            } else {
                window.center()
            }
            // Titre de la page (ex. « Revue de direction · Vigie »).
            titleObservation = webView.observe(\.title, options: [.new]) { [weak self] webView, _ in
                MainActor.assumeIsolated {
                    let title = webView.title ?? ""
                    self?.window?.title = title.isEmpty ? "Vigie" : title
                }
            }
        }
    }

    private func configureWebView() {
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        webView.underPageBackgroundColor = Brand.background
        if role == .secondary {
            // Fond transparent jusqu'à la fin du premier chargement : la couleur de la fenêtre (#161826)
            // apparaît au lieu du blanc que WebKit peint avant la page.
            setDrawsBackground(false)
        }
        let zoom = UserDefaults.standard.double(forKey: Self.zoomDefaultsKey)
        webView.pageZoom = zoom > 0 ? CGFloat(zoom) : 1
        if #available(macOS 13.3, *) {
            webView.isInspectable = true // inspecteur web de Safari (menu Développement)
        }
    }

    private func layoutContent(in window: NSWindow) {
        container.wantsLayer = true
        container.layer?.backgroundColor = Brand.background.cgColor
        var views: [NSView] = [webView]
        if let loadingView {
            loadingView.onRetry = { [weak self] in
                guard let self else { return }
                self.host?.webWindowRequestsServerRetry(self)
            }
            loadingView.onOpenLog = { [weak self] in self?.host?.showServerLog() }
            loadingView.onQuit = { [weak self] in
                if let host = self?.host { host.requestTermination() } else { NSApplication.shared.terminate(nil) }
            }
            // Opaque et au-dessus de la page : pas de flash blanc, et WebKit peint la page dessous
            // avant qu'elle ne soit dévoilée.
            views.append(loadingView)
        }
        for view in views {
            view.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                view.topAnchor.constraint(equalTo: container.topAnchor),
                view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            ])
        }
        window.contentView = container
        window.initialFirstResponder = webView
    }

    /// WebKit peint un fond blanc avant le premier rendu de la page. Sa propriété `_drawsBackground`
    /// (privée, accessible par KVC sous le nom « drawsBackground ») permet de laisser voir le fond de
    /// la fenêtre ; elle n'est utilisée que si WebKit la fournit.
    private func setDrawsBackground(_ draws: Bool) {
        guard webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) else { return }
        webView.setValue(draws, forKey: "drawsBackground")
    }

    // MARK: Fenêtres secondaires

    /// Affiche la fenêtre secondaire au premier contenu de la page (didCommit) ou, au plus tard,
    /// après 0,6 s (page écrite par script, serveur lent). Un lien vers une pièce jointe non affichable
    /// (Word, Excel, CSV…) devient un téléchargement avant tout contenu : la fenêtre n'apparaît pas.
    func presentWhenReady() {
        guard role == .secondary else {
            showWindow(nil)
            return
        }
        presentTask?.cancel()
        presentTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            self?.presentNow()
        }
    }

    private func presentNow() {
        presentTask?.cancel()
        presentTask = nil
        guard !carriesDownload, let window, !window.isVisible, !window.isMiniaturized else { return }
        showWindow(nil)
    }

    /// Fin du téléchargement porté par cette fenêtre (jamais affichée) : on la ferme.
    func downloadCarrierDidFinish() {
        guard carriesDownload else { return }
        window?.close()
    }

    /// Un lien ou une réponse est devenu un téléchargement.
    private func adoptDownload(_ download: WKDownload) {
        if role == .secondary, !hasCommitted {
            // La fenêtre n'a rien affiché (lien target=_blank vers une pièce jointe non affichable) :
            // elle est retirée de l'écran, et fermée une fois le fichier enregistré. Le bandeau de fin
            // de téléchargement s'affiche dans la fenêtre d'origine.
            carriesDownload = true
            presentTask?.cancel()
            presentTask = nil
            window?.isExcludedFromWindowsMenu = true
            window?.orderOut(nil)
            DownloadCoordinator.shared.track(download, presenter: opener, carrier: self)
        } else {
            DownloadCoordinator.shared.track(download, presenter: self, carrier: nil)
        }
    }

    // MARK: États du serveur (fenêtre principale)

    func showStatus(_ status: String, detail: String?) {
        guard let loadingView else { return }
        revealFallback?.cancel()
        loadingView.alphaValue = 1
        loadingView.isHidden = false
        loadingView.showProgress(status: status, detail: detail)
    }

    func showFailure(_ failure: ServerFailure) {
        guard let loadingView else { return }
        revealPending = false
        revealFallback?.cancel()
        loadingView.onRetry = { [weak self] in
            guard let self else { return }
            self.host?.webWindowRequestsServerRetry(self)
        }
        loadingView.alphaValue = 1
        loadingView.isHidden = false
        loadingView.showError(failure)
    }

    /// Le serveur répond : charge la page d'accueil (ou recharge la page en cours après une reprise).
    func serverDidBecomeReady(baseURL: URL) {
        showStatus(Texts.opening, detail: nil)
        revealPending = true
        if let current = webView.url, appConfig.isAppURL(current) {
            webView.reload()
        } else {
            webView.load(URLRequest(url: baseURL))
        }
        // Filet de sécurité : la page est révélée même si son chargement s'éternise.
        revealFallback = Task { [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard !Task.isCancelled else { return }
            self?.reveal()
        }
    }

    private func reveal() {
        revealPending = false
        revealFallback?.cancel()
        guard let loadingView, !loadingView.isHidden else { return }
        window?.makeFirstResponder(webView)
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.25
            loadingView.animator().alphaValue = 0
        }, completionHandler: { [weak loadingView] in
            Task { @MainActor in
                guard let loadingView, loadingView.alphaValue == 0 else { return }
                loadingView.isHidden = true
                loadingView.alphaValue = 1
            }
        })
    }

    /// Erreur propre à une page (le serveur répond) : réessayer recharge la page.
    func showPageFailure(_ message: String) {
        if let loadingView {
            revealPending = false
            revealFallback?.cancel()
            loadingView.onRetry = { [weak self] in
                guard let self else { return }
                self.showStatus(Texts.opening, detail: nil)
                self.revealPending = true
                if self.webView.url != nil {
                    self.webView.reload()
                } else {
                    self.webView.load(URLRequest(url: self.appConfig.baseURL))
                }
            }
            loadingView.alphaValue = 1
            loadingView.isHidden = false
            loadingView.showError(Failures.pageFailed(message))
        } else {
            setDrawsBackground(true)
            presentNow()
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "La page n'a pas pu être chargée"
            alert.informativeText = message
            alert.addButton(withTitle: "OK")
            present(alert) { _ in }
        }
    }

    // MARK: Bandeau

    func showToast(symbol: String, message: String, actionTitle: String?, action: (() -> Void)?) {
        toast?.dismiss()
        let view = ToastView(symbol: symbol, message: message, actionTitle: actionTitle, action: action)
        view.present(in: container)
        toast = view
    }

    // MARK: Actions des menus (chaîne de répondeurs)

    @objc func reloadPage(_ sender: Any?) {
        if webView.url != nil {
            webView.reload()
        } else if role == .main {
            webView.load(URLRequest(url: appConfig.baseURL))
        }
    }

    @objc func goBackPage(_ sender: Any?) { webView.goBack() }
    @objc func goForwardPage(_ sender: Any?) { webView.goForward() }

    @objc func goHomePage(_ sender: Any?) {
        webView.load(URLRequest(url: appConfig.baseURL))
    }

    /// Taille réelle : zoom de la page (⌘+ / ⌘−) et agrandissement au pincement du trackpad.
    @objc func actualSizePage(_ sender: Any?) {
        setZoom(1)
        webView.magnification = 1
    }

    @objc func zoomInPage(_ sender: Any?) {
        if let next = Self.zoomLevels.first(where: { $0 > webView.pageZoom + 0.001 }) { setZoom(next) }
    }

    @objc func zoomOutPage(_ sender: Any?) {
        if let previous = Self.zoomLevels.last(where: { $0 < webView.pageZoom - 0.001 }) { setZoom(previous) }
    }

    private func setZoom(_ zoom: CGFloat) {
        webView.pageZoom = zoom
        UserDefaults.standard.set(Double(zoom), forKey: Self.zoomDefaultsKey)
    }

    /// Impression native de la page (menu Fichier › Imprimer… ou `window.print()` dans la page).
    @objc func printPage(_ sender: Any?) {
        guard let window, window.attachedSheet == nil, webView.url != nil else {
            NSSound.beep()
            return
        }
        let printInfo = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        printInfo.horizontalPagination = .automatic
        printInfo.verticalPagination = .automatic
        printInfo.isHorizontallyCentered = false
        printInfo.isVerticallyCentered = false
        printInfo.topMargin = 28
        printInfo.bottomMargin = 28
        printInfo.leftMargin = 28
        printInfo.rightMargin = 28

        let operation = webView.printOperation(with: printInfo)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.jobTitle = webView.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Vigie"
        operation.printPanel.options.formUnion([.showsPaperSize, .showsOrientation, .showsScaling, .showsPreview])
        // Sans cadre explicite, WebKit imprime des pages blanches.
        operation.view?.frame = webView.bounds
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        let pageShown = webView.url != nil && (loadingView?.isHidden ?? true)
        switch menuItem.action {
        case #selector(goBackPage(_:)): return pageShown && webView.canGoBack
        case #selector(goForwardPage(_:)): return pageShown && webView.canGoForward
        case #selector(zoomInPage(_:)): return webView.pageZoom < (Self.zoomLevels.last ?? 2) - 0.001
        case #selector(zoomOutPage(_:)): return webView.pageZoom > (Self.zoomLevels.first ?? 0.5) + 0.001
        case #selector(actualSizePage(_:)):
            return abs(webView.pageZoom - 1) > 0.001 || abs(webView.magnification - 1) > 0.001
        case #selector(printPage(_:)): return pageShown
        case #selector(goHomePage(_:)), #selector(reloadPage(_:)): return pageShown || role == .main
        default: return true
        }
    }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        revealFallback?.cancel()
        presentTask?.cancel()
        webView.stopLoading()
        host?.webWindowWillClose(self)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        decisionHandler(policy(for: navigationAction))
    }

    private func policy(for action: WKNavigationAction) -> WKNavigationActionPolicy {
        if action.shouldPerformDownload { return .download } // <a download>
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return .allow }
        // targetFrame nil : lien target=_blank ou window.open (nouvelle fenêtre).
        let isMainFrame = action.targetFrame?.isMainFrame ?? true
        let clicked = action.navigationType == .linkActivated

        switch scheme {
        case "http", "https":
            if appConfig.isAppURL(url) {
                // ⌘-clic ou clic du milieu sur un lien interne : nouvelle fenêtre de l'application.
                if clicked, isMainFrame, action.modifierFlags.contains(.command) || action.buttonNumber == 2,
                   let host {
                    let controller = host.openWindow(configuration: webView.configuration, features: nil, from: self)
                    controller.webView.load(URLRequest(url: url))
                    return .cancel
                }
                return .allow
            }
            // Lien externe cliqué : navigateur par défaut. Les redirections (connexion Entra ID à venir,
            // par exemple) et les cadres intégrés restent dans l'application.
            if clicked, isMainFrame {
                NSWorkspace.shared.open(url)
                return .cancel
            }
            return .allow
        case "mailto", "tel", "sms", "facetime", "facetime-audio":
            NSWorkspace.shared.open(url)
            return .cancel
        case "about", "data", "blob", "javascript":
            return .allow
        case "file":
            return .cancel
        default:
            // Schéma d'une autre application (teams:, ms-word:…) : seulement sur un clic.
            if clicked { NSWorkspace.shared.open(url) }
            return .cancel
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(policy(for: navigationResponse))
    }

    private func policy(for response: WKNavigationResponse) -> WKNavigationResponsePolicy {
        if let http = response.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("attachment") {
            return .download // exports CSV du DUERP (/risques/export), registre des déchets…
        }
        let mime = response.response.mimeType?.lowercased() ?? ""
        if mime == "text/csv" || mime == "application/csv" { return .download }
        return response.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        adoptDownload(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        adoptDownload(download)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hasCommitted = true
        if role == .secondary { presentNow() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if role == .secondary { setDrawsBackground(true) }
        if revealPending { reveal() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        handleLoadFailure(error as NSError)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        handleLoadFailure(error as NSError)
    }

    private func handleLoadFailure(_ error: NSError) {
        // Navigation annulée, remplacée par un téléchargement ou confiée à un module : pas une erreur.
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
        if error.domain == "WebKitErrorDomain", [102, 204].contains(error.code) { return }

        let failingURL = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        let isInternal = failingURL.map { appConfig.isAppURL($0) } ?? true
        let connectionErrors: Set<Int> = [NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost,
                                          NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorNotConnectedToInternet]
        if error.domain == NSURLErrorDomain, connectionErrors.contains(error.code), isInternal, let host {
            host.webWindowDidFailToReachServer(self, error: error)
            return
        }
        showPageFailure(error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Le processus de rendu a planté (mémoire, par exemple) : on recharge, sauf s'il s'est arrêté
        // trois fois en 30 secondes (page qui le fait planter à chaque chargement).
        let now = Date()
        contentProcessTerminations = contentProcessTerminations.filter { now.timeIntervalSince($0) < 30 } + [now]
        if contentProcessTerminations.count >= 3 {
            contentProcessTerminations.removeAll()
            showPageFailure("La page a cessé de fonctionner à plusieurs reprises : elle n'est plus rechargée automatiquement.")
            return
        }
        if webView.url != nil {
            webView.reload()
        } else if role == .main {
            webView.load(URLRequest(url: appConfig.baseURL))
        }
    }

    // MARK: WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() {
            if scheme == "http" || scheme == "https" {
                if !appConfig.isAppURL(url) {
                    NSWorkspace.shared.open(url) // page externe : navigateur par défaut
                    return nil
                }
            } else if !["about", "blob", "data"].contains(scheme) {
                NSWorkspace.shared.open(url)
                return nil
            }
        }
        guard let host else { return nil }
        // La nouvelle vue doit utiliser la configuration fournie par WebKit (même session, mêmes scripts).
        return host.openWindow(configuration: configuration, features: windowFeatures, from: self).webView
    }

    func webViewDidClose(_ webView: WKWebView) {
        if role == .secondary { window?.close() }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.resolvesAliases = true
        panel.prompt = "Choisir"
        let finish: (NSApplication.ModalResponse) -> Void = { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
        if let window, window.isVisible {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(panel.runModal())
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = makeAlert(message)
        alert.addButton(withTitle: "OK")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = makeAlert(message)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annuler")
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let alert = makeAlert(prompt)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annuler")
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 300, height: 24)
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    /// Ni caméra ni micro : l'application ne les demande pas (pas de clé d'usage dans Info.plist).
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    private func makeAlert(_ message: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "Vigie"
        alert.informativeText = message
        return alert
    }

    private func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }
}
