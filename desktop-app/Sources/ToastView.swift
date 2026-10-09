import AppKit

/// Petit bandeau affiché en bas de la fenêtre (fin d'un téléchargement), qui disparaît seul.
@MainActor
final class ToastView: NSView {
    private var action: (() -> Void)?
    private var dismissTask: Task<Void, Never>?

    init(symbol: String, message: String, actionTitle: String?, action: (() -> Void)?) {
        self.action = action
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = Brand.surface.cgColor
        layer?.cornerRadius = 10
        layer?.borderWidth = 1
        layer?.borderColor = Brand.divider.cgColor
        shadow = {
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.45)
            shadow.shadowBlurRadius = 16
            shadow.shadowOffset = NSSize(width: 0, height: -4)
            return shadow
        }()

        let icon = NSImageView()
        if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) {
            icon.image = image
            icon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
        }
        icon.contentTintColor = Brand.accent

        let label = NSTextField(labelWithString: message)
        label.font = .systemFont(ofSize: 13)
        label.textColor = Brand.text
        label.lineBreakMode = .byTruncatingMiddle
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        var views: [NSView] = [icon, label]
        if let actionTitle {
            let button = NSButton(title: actionTitle, target: self, action: #selector(performAction(_:)))
            button.controlSize = .small
            views.append(button)
        }
        let closeButton = NSButton(title: "", target: self, action: #selector(close(_:)))
        closeButton.isBordered = false
        closeButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Fermer")
        closeButton.contentTintColor = Brand.secondaryText
        views.append(closeButton)

        let stack = NSStackView(views: views)
        stack.orientation = .horizontal
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 10, left: 14, bottom: 10, right: 12)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        return nil
    }

    /// Affiche le bandeau en bas, au centre de `container`, pendant `duration` secondes.
    func present(in container: NSView, duration: TimeInterval = 7) {
        translatesAutoresizingMaskIntoConstraints = false
        alphaValue = 0
        container.addSubview(self, positioned: .above, relativeTo: nil)
        NSLayoutConstraint.activate([
            centerXAnchor.constraint(equalTo: container.centerXAnchor),
            bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -24),
            widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, constant: -48),
            widthAnchor.constraint(lessThanOrEqualToConstant: 620),
        ])
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            self.animator().alphaValue = 1
        }
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            self?.dismiss()
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.25
            self.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            Task { @MainActor in self?.removeFromSuperview() }
        })
    }

    @objc private func performAction(_ sender: Any?) {
        action?()
        dismiss()
    }

    @objc private func close(_ sender: Any?) {
        dismiss()
    }
}
