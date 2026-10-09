import AppKit
import CoreText

// Couleurs et marque Vigie (design system Nocturne, voir src/app/nocturne.css).
// Fichier partagé par l'application et par le générateur d'icône (icon/make_icon.swift) :
// il ne dépend d'aucun autre fichier du projet.

enum Brand {
    /// --color-bg
    static var background: NSColor { rgb(0x161826) }
    /// --color-surface
    static var surface: NSColor { rgb(0x232532) }
    /// Fond des zones de texte (journal) : entre le fond et la surface.
    static var well: NSColor { rgb(0x1C1E2C) }
    /// --color-text
    static var text: NSColor { rgb(0xE9E9ED) }
    /// --color-neutral-500
    static var secondaryText: NSColor { rgb(0x9397AB) }
    /// --color-accent
    static var accent: NSColor { rgb(0x9184D9) }
    /// --tone-danger-dot (oklch(0.70 0.15 22) converti en sRGB)
    static var danger: NSColor { rgb(0xED7473) }
    /// --color-divider (texte à 16 %)
    static var divider: NSColor { rgb(0xE9E9ED, alpha: 0.16) }

    static func rgb(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: alpha)
    }
}

enum BrandMark {
    /// Proportions de `.vg-brand-mark` (carré de 22 px, rayon 6 px, « V » en 12 px, graisse 500).
    static let cornerRatio: CGFloat = 6.0 / 22.0
    static let glyphRatio: CGFloat = 0.58

    /// Dessine la marque : carré arrondi en contour et « V » centré, dans la couleur d'accent.
    /// `lineWidthRatio` : épaisseur du contour rapportée au côté du carré.
    static func drawMark(in rect: CGRect, context ctx: CGContext, lineWidthRatio: CGFloat,
                         color: CGColor = Brand.accent.cgColor) {
        let side = min(rect.width, rect.height)
        guard side > 0 else { return }
        let square = CGRect(x: rect.midX - side / 2, y: rect.midY - side / 2, width: side, height: side)
        let lineWidth = max(side * lineWidthRatio, 0.5)
        let box = square.insetBy(dx: lineWidth / 2, dy: lineWidth / 2)
        let radius = max(side * cornerRatio - lineWidth / 2, 0)

        ctx.saveGState()
        ctx.setStrokeColor(color)
        ctx.setLineWidth(lineWidth)
        ctx.addPath(CGPath(roundedRect: box, cornerWidth: radius, cornerHeight: radius, transform: nil))
        ctx.strokePath()

        // « V » : contour exact du glyphe, centré sur son encre (pas sur la boîte de la police).
        let font = NSFont.systemFont(ofSize: side * glyphRatio, weight: .medium) as CTFont
        var characters: [UniChar] = [0x56] // « V »
        var glyphs: [CGGlyph] = [0]
        if CTFontGetGlyphsForCharacters(font, &characters, &glyphs, 1),
           let glyphPath = CTFontCreatePathForGlyph(font, glyphs[0], nil) {
            let bounds = glyphPath.boundingBoxOfPath
            var move = CGAffineTransform(translationX: square.midX - bounds.midX, y: square.midY - bounds.midY)
            if let centered = glyphPath.copy(using: &move) {
                ctx.addPath(centered)
                ctx.setFillColor(color)
                ctx.fillPath()
            }
        }
        ctx.restoreGState()
    }

    /// Icône d'application 1024 × 1024 (gabarit macOS : corps de 824 px centré, coins continus à 22,5 %).
    static func drawAppIcon(in ctx: CGContext, canvas: CGFloat) {
        let scale = canvas / 1024
        let body = CGRect(x: 100 * scale, y: 100 * scale, width: 824 * scale, height: 824 * scale)
        let shape = continuousRoundedRect(body, radius: body.width * 0.225)
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

        // Fond : #161826 avec un léger dégradé vertical (plus clair en haut).
        ctx.saveGState()
        ctx.addPath(shape)
        ctx.clip()
        let ground = [Brand.rgb(0x232640).cgColor, Brand.rgb(0x161826).cgColor, Brand.rgb(0x101119).cgColor] as CFArray
        if let gradient = CGGradient(colorsSpace: space, colors: ground, locations: [0, 0.55, 1]) {
            ctx.drawLinearGradient(gradient, start: CGPoint(x: body.midX, y: body.maxY),
                                   end: CGPoint(x: body.midX, y: body.minY), options: [])
        }
        // Halo d'accent très discret derrière la marque.
        let glow = [Brand.rgb(0x9184D9, alpha: 0.16).cgColor, Brand.rgb(0x9184D9, alpha: 0).cgColor] as CFArray
        if let radial = CGGradient(colorsSpace: space, colors: glow, locations: [0, 1]) {
            let center = CGPoint(x: body.midX, y: body.midY)
            ctx.drawRadialGradient(radial, startCenter: center, startRadius: 0,
                                   endCenter: center, endRadius: body.width * 0.48, options: [])
        }
        // Liseré intérieur clair, pour détacher l'icône sur un Dock sombre.
        ctx.addPath(shape)
        ctx.setStrokeColor(Brand.rgb(0xFFFFFF, alpha: 0.09).cgColor)
        ctx.setLineWidth(6 * scale)
        ctx.strokePath()
        ctx.restoreGState()

        // Marque : carré intérieur (contour ≈ 1/16 de son côté) et « V ».
        let side = body.width * 0.52
        let markRect = CGRect(x: body.midX - side / 2, y: body.midY - side / 2, width: side, height: side)
        drawMark(in: markRect, context: ctx, lineWidthRatio: 1.0 / 16.0)
    }

    /// Rectangle à coins continus (« squircle » des icônes Apple), d'après l'approximation
    /// en courbes de Bézier du gabarit iOS 7 / macOS 11.
    static func continuousRoundedRect(_ rect: CGRect, radius: CGFloat) -> CGPath {
        let r = min(radius, min(rect.width, rect.height) / 2 / 1.52866483)
        // Pour chaque coin : sommet, direction d'arrivée (a) et de départ (b).
        // Un point (s, t) du coin vaut sommet − a·s·r + b·t·r.
        let corners: [(CGPoint, CGVector, CGVector)] = [
            (CGPoint(x: rect.maxX, y: rect.minY), CGVector(dx: 1, dy: 0), CGVector(dx: 0, dy: 1)),
            (CGPoint(x: rect.maxX, y: rect.maxY), CGVector(dx: 0, dy: 1), CGVector(dx: -1, dy: 0)),
            (CGPoint(x: rect.minX, y: rect.maxY), CGVector(dx: -1, dy: 0), CGVector(dx: 0, dy: -1)),
            (CGPoint(x: rect.minX, y: rect.minY), CGVector(dx: 0, dy: -1), CGVector(dx: 1, dy: 0)),
        ]
        func point(_ corner: (CGPoint, CGVector, CGVector), _ s: CGFloat, _ t: CGFloat) -> CGPoint {
            let (c, a, b) = corner
            return CGPoint(x: c.x - a.dx * s * r + b.dx * t * r, y: c.y - a.dy * s * r + b.dy * t * r)
        }
        let path = CGMutablePath()
        for (index, corner) in corners.enumerated() {
            let start = point(corner, 1.52866483, 0)
            if index == 0 { path.move(to: start) } else { path.addLine(to: start) }
            path.addCurve(to: point(corner, 0.63149399, 0.07491176),
                          control1: point(corner, 1.08849323, 0), control2: point(corner, 0.86840689, 0))
            path.addCurve(to: point(corner, 0.07491176, 0.63149399),
                          control1: point(corner, 0.37282392, 0.16906001), control2: point(corner, 0.16906001, 0.37282392))
            path.addCurve(to: point(corner, 0, 1.52866483),
                          control1: point(corner, 0, 0.86840689), control2: point(corner, 0, 1.08849323))
        }
        path.closeSubpath()
        return path
    }
}
