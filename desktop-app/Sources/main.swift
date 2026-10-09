import AppKit

// Point d'entrée de Vigie.app : application AppKit classique, sans storyboard ni SwiftUI.
// Le délégué est gardé ici (NSApplication.delegate est une référence faible).

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
application.setActivationPolicy(.regular)
application.run()
