import AppKit

// Générateur de l'icône de Vigie.app : dessine l'icône 1024 × 1024 (voir BrandMark.drawAppIcon)
// et l'écrit en PNG. Compilé et lancé par desktop-app/build.sh avec ../Sources/BrandMark.swift :
//   make_icon <sortie.png>
// build.sh en tire ensuite le .iconset (sips) puis Vigie.icns (iconutil).

@main
struct MakeIcon {
    static func main() {
        let arguments = CommandLine.arguments
        guard arguments.count == 2 else {
            FileHandle.standardError.write(Data("usage : make_icon <sortie.png>\n".utf8))
            exit(2)
        }
        let output = URL(fileURLWithPath: arguments[1])
        let size = 1024
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            fail("contexte graphique indisponible")
        }
        ctx.setShouldAntialias(true)
        ctx.interpolationQuality = .high
        ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))
        BrandMark.drawAppIcon(in: ctx, canvas: CGFloat(size))

        guard let image = ctx.makeImage() else { fail("rendu impossible") }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { fail("encodage PNG impossible") }
        do {
            try png.write(to: output, options: .atomic)
        } catch {
            fail("écriture de \(output.path) impossible : \(error.localizedDescription)")
        }
    }

    static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data("make_icon : \(message)\n".utf8))
        exit(1)
    }
}
