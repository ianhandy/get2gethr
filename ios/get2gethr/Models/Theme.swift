import SwiftUI

enum Theme {
    // Core palette — matches web globals.css
    static let bg = Color(hex: "FAF6F0")
    static let surface = Color.white
    static let primary = Color(hex: "3D405B")
    static let accentA = Color(hex: "E07A5F")   // coral/burnt orange
    static let accentB = Color(hex: "F2CC8F")   // gold
    static let accentC = Color(hex: "81B29A")   // sage green
    static let muted = Color(hex: "9795A0")
    static let border = Color(hex: "E8E2D9")
}

extension Color {
    init(hex: String) {
        let scanner = Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")))
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
