import AppKit

/// Vue native affichée pendant le démarrage du serveur, puis en cas d'erreur :
/// marque Vigie, indicateur d'activité et message ; ou erreur, extrait du journal et boutons
/// « Réessayer », « Ouvrir le journal », « Quitter ».
@MainActor
final class LoadingView: NSView {
    var onRetry: (() -> Void)?
    var onOpenLog: (() -> Void)?
    var onQuit: (() -> Void)?

    private let mark = BrandMarkView()
    private let wordmark = NSTextField(labelWithString: "Vigie")

    private let progressGroup = NSStackView()
    private let spinner = NSProgressIndicator()
    private let statusLabel = NSTextField(wrappingLabelWithString: "")
    private let detailLabel = NSTextField(labelWithString: "")

    private let errorGroup = NSStackView()
    private let errorIcon = NSImageView()
    private let errorTitle = NSTextField(wrappingLabelWithString: "")
    private let errorMessage = NSTextField(wrappingLabelWithString: "")
    private let logScroll = NSTextView.scrollableTextView()
    private let retryButton = NSButton(title: "Réessayer", target: nil, action: nil)
    private let logButton = NSButton(title: "Ouvrir le journal", target: nil, action: nil)
    private let quitButton = NSButton(title: "Quitter", target: nil, action: nil)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        build()
    }

    required init?(coder: NSCoder) {
        return nil
    }

    override var isOpaque: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        Brand.background.setFill()
        dirtyRect.fill()
    }

    // Les clics ne traversent pas vers la page placée dessous.
    override func mouseDown(with event: NSEvent) {}
    override func scrollWheel(with event: NSEvent) {}

    // MARK: États

    func showProgress(status: String, detail: String?) {
        statusLabel.stringValue = status
        detailLabel.stringValue = detail ?? ""
        detailLabel.isHidden = (detail ?? "").isEmpty
        errorGroup.isHidden = true
        progressGroup.isHidden = false
        spinner.startAnimation(nil)
    }

    func showError(_ failure: ServerFailure) {
        spinner.stopAnimation(nil)
        progressGroup.isHidden = true
        errorTitle.stringValue = failure.title
        errorMessage.stringValue = failure.message
        let log = failure.log?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let textView = logScroll.documentView as? NSTextView {
            textView.string = log
            textView.scrollToEndOfDocument(nil)
        }
        logScroll.isHidden = log.isEmpty
        errorGroup.isHidden = false
        window?.makeFirstResponder(retryButton)
    }

    // MARK: Construction

    private func build() {
        wantsLayer = true

        mark.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([mark.widthAnchor.constraint(equalToConstant: 64),
                                     mark.heightAnchor.constraint(equalToConstant: 64)])
        wordmark.font = .systemFont(ofSize: 26, weight: .medium)
        wordmark.textColor = Brand.text
        let header = NSStackView(views: [mark, wordmark])
        header.orientation = .vertical
        header.spacing = 14

        // Progression
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        statusLabel.font = .systemFont(ofSize: 14)
        statusLabel.textColor = Brand.text
        statusLabel.alignment = .center
        statusLabel.isSelectable = false
        statusLabel.preferredMaxLayoutWidth = 620
        detailLabel.font = .monospacedDigitSystemFont(ofSize: 11.5, weight: .regular)
        detailLabel.textColor = Brand.secondaryText
        detailLabel.alignment = .center
        detailLabel.lineBreakMode = .byTruncatingMiddle
        detailLabel.isHidden = true
        progressGroup.setViews([spinner, statusLabel, detailLabel], in: .center)
        progressGroup.orientation = .vertical
        progressGroup.spacing = 10
        progressGroup.setCustomSpacing(14, after: spinner)

        // Erreur
        if let symbol = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "Erreur") {
            errorIcon.image = symbol
            errorIcon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 22, weight: .regular)
        }
        errorIcon.contentTintColor = Brand.danger
        errorTitle.font = .systemFont(ofSize: 17, weight: .semibold)
        errorTitle.textColor = Brand.text
        errorTitle.alignment = .center
        errorTitle.preferredMaxLayoutWidth = 620
        errorMessage.font = .systemFont(ofSize: 13)
        errorMessage.textColor = Brand.secondaryText
        errorMessage.alignment = .center
        errorMessage.isSelectable = true
        errorMessage.preferredMaxLayoutWidth = 620

        logScroll.hasVerticalScroller = true
        logScroll.hasHorizontalScroller = false
        logScroll.borderType = .noBorder
        logScroll.drawsBackground = true
        logScroll.backgroundColor = Brand.well
        logScroll.wantsLayer = true
        logScroll.layer?.cornerRadius = 8
        logScroll.layer?.borderWidth = 1
        logScroll.layer?.borderColor = Brand.divider.cgColor
        logScroll.translatesAutoresizingMaskIntoConstraints = false
        if let textView = logScroll.documentView as? NSTextView {
            textView.isEditable = false
            textView.isSelectable = true
            textView.isRichText = false
            textView.drawsBackground = true
            textView.backgroundColor = Brand.well
            textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
            textView.textColor = Brand.secondaryText
            textView.textContainerInset = NSSize(width: 10, height: 10)
        }

        for (button, action) in [(retryButton, #selector(retry(_:))), (logButton, #selector(openLog(_:))),
                                 (quitButton, #selector(quit(_:)))] {
            button.target = self
            button.action = action
        }
        retryButton.keyEquivalent = "\r"
        retryButton.bezelColor = Brand.accent
        let buttons = NSStackView(views: [quitButton, logButton, retryButton])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        errorGroup.setViews([errorIcon, errorTitle, errorMessage, logScroll, buttons], in: .center)
        errorGroup.orientation = .vertical
        errorGroup.spacing = 10
        errorGroup.setCustomSpacing(16, after: errorMessage)
        errorGroup.setCustomSpacing(20, after: logScroll)
        errorGroup.isHidden = true

        let content = NSStackView(views: [header, progressGroup, errorGroup])
        content.orientation = .vertical
        content.spacing = 28
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)

        let preferredWidth = content.widthAnchor.constraint(equalToConstant: 620)
        preferredWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            content.centerXAnchor.constraint(equalTo: centerXAnchor),
            content.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -24),
            content.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -64),
            content.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: 24),
            content.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -24),
            preferredWidth,
            statusLabel.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor),
            detailLabel.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor),
            errorGroup.widthAnchor.constraint(equalTo: content.widthAnchor),
            errorTitle.widthAnchor.constraint(equalTo: errorGroup.widthAnchor),
            errorMessage.widthAnchor.constraint(equalTo: errorGroup.widthAnchor),
            logScroll.widthAnchor.constraint(equalTo: errorGroup.widthAnchor),
            logScroll.heightAnchor.constraint(equalToConstant: 240),
        ])
        showProgress(status: Texts.starting, detail: nil)
    }

    @objc private func retry(_ sender: Any?) { onRetry?() }
    @objc private func openLog(_ sender: Any?) { onOpenLog?() }
    @objc private func quit(_ sender: Any?) { onQuit?() }
}

/// Marque Vigie (carré arrondi et « V »), comme dans la barre latérale de l'application web.
@MainActor
final class BrandMarkView: NSView {
    override var intrinsicContentSize: NSSize { NSSize(width: 64, height: 64) }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        BrandMark.drawMark(in: bounds.insetBy(dx: 1, dy: 1), context: ctx, lineWidthRatio: 1.0 / 28.0)
    }
}
