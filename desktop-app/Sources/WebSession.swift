import AppKit
import WebKit

/// Configuration WebKit commune à toutes les fenêtres : stockage persistant (cookies du rôle et du
/// site choisis), agent utilisateur, et pont d'impression `window.print()` → impression native.
@MainActor
final class WebSession: NSObject, WKScriptMessageHandler {
    static let shared = WebSession()

    static let printMessage = "vigiePrint"

    /// `window.print()` ne fait rien dans un WKWebView : on le remplace, dans tous les cadres et dès
    /// le début du document, par un message traité nativement (bouton « Imprimer / PDF » de la revue
    /// de direction, par exemple).
    private static let printShim = """
    (() => {
      const handlers = window.webkit && window.webkit.messageHandlers;
      if (!handlers || !handlers.\(printMessage)) return;
      const print = function print() { handlers.\(printMessage).postMessage(null); };
      try {
        Object.defineProperty(window, 'print', { value: print, writable: true, configurable: true });
      } catch (error) {
        window.print = print;
      }
    })();
    """

    let configuration: WKWebViewConfiguration

    override private init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "VigieDesktop/1.0"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.preferences.isElementFullscreenEnabled = true

        let contentController = WKUserContentController()
        contentController.addUserScript(WKUserScript(source: Self.printShim, injectionTime: .atDocumentStart,
                                                     forMainFrameOnly: false))
        configuration.userContentController = contentController
        self.configuration = configuration
        super.init()
        // Le contrôleur garde une référence forte : sans conséquence pour ce singleton.
        contentController.add(self, name: Self.printMessage)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.printMessage,
              let controller = message.webView?.window?.windowController as? WebWindowController else { return }
        controller.printPage(nil)
    }
}

/// Téléchargements (export CSV du DUERP, registre des déchets, pièces jointes non affichables) :
/// enregistrés dans ~/Downloads sous un nom unique, puis signalés dans la fenêtre.
@MainActor
final class DownloadCoordinator: NSObject, WKDownloadDelegate {
    static let shared = DownloadCoordinator()

    private struct Entry {
        var destination: URL?
        /// Fenêtre où afficher le bandeau de fin de téléchargement.
        weak var presenter: WebWindowController?
        /// Fenêtre secondaire jamais affichée, ouverte par le lien : fermée à la fin du téléchargement.
        var carrier: WebWindowController?
    }

    private var entries: [ObjectIdentifier: Entry] = [:]

    func track(_ download: WKDownload, presenter: WebWindowController?, carrier: WebWindowController?) {
        entries[ObjectIdentifier(download)] = Entry(destination: nil, presenter: presenter, carrier: carrier)
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let key = ObjectIdentifier(download)
        // Le dossier Téléchargements est consulté hors du fil principal : la première fois, macOS peut
        // demander l'autorisation d'y accéder, ce qui bloquerait sinon toute l'interface.
        Task {
            var destination: URL?
            for _ in 0..<5 {
                let reserved = reservedPaths()
                let candidate = await Task.detached(operation: {
                    Self.uniqueDestination(suggestedName: suggestedFilename, reserved: reserved)
                }).value
                // Un autre téléchargement a pu retenir le même nom pendant la recherche : on recommence.
                guard let candidate, !reservedPaths().contains(candidate.path) else { continue }
                destination = candidate
                break
            }
            if let destination { entries[key, default: Entry()].destination = destination }
            completionHandler(destination)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        let entry = entries.removeValue(forKey: ObjectIdentifier(download))
        defer { entry?.carrier?.downloadCarrierDidFinish() }
        guard let destination = entry?.destination else { return }
        // Fait rebondir la pile « Téléchargements » du Dock, comme Safari.
        DistributedNotificationCenter.default().post(name: Notification.Name("com.apple.DownloadFileFinished"),
                                                     object: destination.path)
        if let controller = visibleWindow(preferred: entry?.presenter) {
            controller.showToast(symbol: "arrow.down.circle",
                                 message: "« \(destination.lastPathComponent) » enregistré dans Téléchargements",
                                 actionTitle: "Afficher dans le Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([destination])
            }
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([destination])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        let entry = entries.removeValue(forKey: ObjectIdentifier(download))
        if let destination = entry?.destination { try? FileManager.default.removeItem(at: destination) }
        entry?.carrier?.downloadCarrierDidFinish()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Le téléchargement a échoué"
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "OK")
        if let window = visibleWindow(preferred: entry?.presenter)?.window, window.attachedSheet == nil {
            alert.beginSheetModal(for: window)
        } else {
            alert.runModal()
        }
    }

    private func reservedPaths() -> Set<String> {
        Set(entries.values.compactMap { $0.destination?.path })
    }

    /// La fenêtre indiquée si elle est à l'écran, sinon la fenêtre Vigie au premier plan.
    private func visibleWindow(preferred: WebWindowController?) -> WebWindowController? {
        if let preferred, preferred.window?.isVisible == true { return preferred }
        return NSApplication.shared.orderedWindows
            .first { $0.isVisible && $0.windowController is WebWindowController }?
            .windowController as? WebWindowController
    }

    /// « nom.csv », puis « nom 2.csv », « nom 3.csv »… (comme le Finder), dans ~/Downloads.
    /// Accès disque : appelé hors du fil principal.
    nonisolated private static func uniqueDestination(suggestedName: String, reserved: Set<String>) -> URL? {
        let fm = FileManager.default
        let directory = AppPaths.downloadsDirectory
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        var name = suggestedName
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while name.hasPrefix(".") { name.removeFirst() }
        if name.isEmpty { name = "Téléchargement Vigie" }

        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var candidate = directory.appendingPathComponent(name)
        var index = 2
        while fm.fileExists(atPath: candidate.path) || reserved.contains(candidate.path) {
            guard index < 10_000 else { return nil }
            let numbered = ext.isEmpty ? "\(base) \(index)" : "\(base) \(index).\(ext)"
            candidate = directory.appendingPathComponent(numbered)
            index += 1
        }
        return candidate
    }
}
