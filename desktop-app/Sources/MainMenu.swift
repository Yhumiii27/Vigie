import AppKit

/// Barre de menus (en français, raccourcis standard du Mac).
///
/// Les commandes propres à une page (recharger, zoom, précédent…) n'ont pas de cible : elles
/// remontent la chaîne de répondeurs jusqu'au WebWindowController de la fenêtre active.
/// Le menu Édition est indispensable pour que ⌘C, ⌘V, ⌘Z… fonctionnent dans les champs de la page.
@MainActor
enum MainMenu {
    static func make(appDelegate: AppDelegate) -> NSMenu {
        let mainMenu = NSMenu()
        mainMenu.addItem(submenu(applicationMenu(appDelegate)))
        mainMenu.addItem(submenu(fileMenu()))
        mainMenu.addItem(submenu(editMenu()))
        mainMenu.addItem(submenu(viewMenu()))
        mainMenu.addItem(submenu(navigationMenu()))
        let windowMenu = windowMenu()
        mainMenu.addItem(submenu(windowMenu))
        let helpMenu = helpMenu(appDelegate)
        mainMenu.addItem(submenu(helpMenu))
        NSApplication.shared.windowsMenu = windowMenu
        NSApplication.shared.helpMenu = helpMenu
        return mainMenu
    }

    private static func applicationMenu(_ delegate: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: "Vigie")
        menu.addItem(item("À propos de Vigie", #selector(AppDelegate.showAbout(_:)), target: delegate))
        menu.addItem(.separator())
        let services = NSMenu(title: "Services")
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = services
        NSApplication.shared.servicesMenu = services
        menu.addItem(servicesItem)
        menu.addItem(.separator())
        menu.addItem(item("Masquer Vigie", #selector(NSApplication.hide(_:)), "h"))
        menu.addItem(item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        menu.addItem(item("Tout afficher", #selector(NSApplication.unhideAllApplications(_:))))
        menu.addItem(.separator())
        // Passe par AppDelegate : une seule demande de fermeture, même si ⌘Q est répété pendant l'arrêt du serveur.
        menu.addItem(item("Quitter Vigie", #selector(AppDelegate.quitApplication(_:)), "q", target: delegate))
        return menu
    }

    private static func fileMenu() -> NSMenu {
        let menu = NSMenu(title: "Fichier")
        menu.addItem(item("Fermer la fenêtre", #selector(NSWindow.performClose(_:)), "w"))
        menu.addItem(.separator())
        menu.addItem(item("Imprimer…", #selector(WebWindowController.printPage(_:)), "p"))
        return menu
    }

    private static func editMenu() -> NSMenu {
        let menu = NSMenu(title: "Édition")
        menu.addItem(item("Annuler", Selector(("undo:")), "z"))
        menu.addItem(item("Rétablir", Selector(("redo:")), "z", [.command, .shift]))
        menu.addItem(.separator())
        menu.addItem(item("Couper", #selector(NSText.cut(_:)), "x"))
        menu.addItem(item("Copier", #selector(NSText.copy(_:)), "c"))
        menu.addItem(item("Coller", #selector(NSText.paste(_:)), "v"))
        menu.addItem(item("Coller et adapter le style", #selector(NSTextView.pasteAsPlainText(_:)), "v",
                          [.command, .option, .shift]))
        menu.addItem(item("Supprimer", #selector(NSText.delete(_:))))
        menu.addItem(item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"))
        return menu
    }

    private static func viewMenu() -> NSMenu {
        let menu = NSMenu(title: "Présentation")
        menu.addItem(item("Recharger la page", #selector(WebWindowController.reloadPage(_:)), "r"))
        menu.addItem(.separator())
        menu.addItem(item("Taille réelle", #selector(WebWindowController.actualSizePage(_:)), "0"))
        menu.addItem(item("Agrandir", #selector(WebWindowController.zoomInPage(_:)), "+"))
        // ⌘= : même touche que ⌘+ sur un clavier américain (élément masqué, raccourci actif).
        let zoomInAlias = item("Agrandir", #selector(WebWindowController.zoomInPage(_:)), "=")
        zoomInAlias.isHidden = true
        zoomInAlias.allowsKeyEquivalentWhenHidden = true
        menu.addItem(zoomInAlias)
        menu.addItem(item("Réduire", #selector(WebWindowController.zoomOutPage(_:)), "-"))
        menu.addItem(.separator())
        menu.addItem(item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        return menu
    }

    private static func navigationMenu() -> NSMenu {
        let menu = NSMenu(title: "Navigation")
        menu.addItem(item("Précédent", #selector(WebWindowController.goBackPage(_:)), "["))
        menu.addItem(item("Suivant", #selector(WebWindowController.goForwardPage(_:)), "]"))
        menu.addItem(.separator())
        menu.addItem(item("Tableau de bord", #selector(WebWindowController.goHomePage(_:)), "h", [.command, .shift]))
        return menu
    }

    private static func windowMenu() -> NSMenu {
        let menu = NSMenu(title: "Fenêtre")
        menu.addItem(item("Placer dans le Dock", #selector(NSWindow.performMiniaturize(_:)), "m"))
        menu.addItem(item("Réduire/agrandir", #selector(NSWindow.performZoom(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Tout ramener au premier plan", #selector(NSApplication.arrangeInFront(_:))))
        return menu
    }

    private static func helpMenu(_ delegate: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: "Aide")
        menu.addItem(item("Ouvrir dans le navigateur", #selector(AppDelegate.openInBrowser(_:)), target: delegate))
        menu.addItem(item("Journal du serveur", #selector(AppDelegate.showServerLogAction(_:)), target: delegate))
        menu.addItem(.separator())
        menu.addItem(item("À propos de Vigie", #selector(AppDelegate.showAbout(_:)), target: delegate))
        return menu
    }

    // MARK: Outils

    private static func submenu(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }

    private static func item(_ title: String, _ action: Selector, _ key: String = "",
                             _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : modifiers
        item.target = target
        return item
    }
}
