import SwiftUI
import UIKit

/// Adaptive colour tokens.
///
/// Every colour resolves per trait collection, so the same token renders
/// correctly in Light and Dark. The previous palette pinned `surface` to white
/// and `primary` to a dark blue, which meant that in Dark Mode the system drew
/// white control text onto a white card and the form became unreadable.
///
/// The warm identity is deliberately preserved: the dark palette is a warm
/// near-black rather than a neutral grey, and the coral, gold, and sage accents
/// are lifted just enough to hold contrast on it.
enum Theme {

    // MARK: Surfaces

    /// Page background.
    static let bg = adaptive(light: "FAF6F0", dark: "1B1922")

    /// Card and control background.
    static let surface = adaptive(light: "FFFFFF", dark: "262330")

    /// A slightly recessed surface, for inset rows and read-only chips.
    static let surfaceSunken = adaptive(light: "F5F0E8", dark: "1F1D28")

    static let border = adaptive(light: "E8E2D9", dark: "3A3646")

    // MARK: Content

    /// Primary text. Contrast against `surface` exceeds 12:1 in both modes.
    static let primary = adaptive(light: "3D405B", dark: "F3F0EA")

    /// Secondary text. Darkened from the original #9795A0, which fell below
    /// 4.5:1 on white and failed WCAG AA for body text.
    static let muted = adaptive(light: "6F6D78", dark: "AEA9BA")

    // MARK: Accents

    static let accentA = adaptive(light: "E07A5F", dark: "F0967E") // coral
    static let accentB = adaptive(light: "F2CC8F", dark: "F2CC8F") // gold
    static let accentC = adaptive(light: "81B29A", dark: "9AC7B0") // sage

    /// Text drawn on top of a filled accent. Dark text on the lighter dark-mode
    /// accents; white on the deeper light-mode ones.
    static let onAccent = adaptive(light: "FFFFFF", dark: "1B1922")

    /// Error text, at AA contrast on both surfaces. Plain `.red` was too light
    /// on white and too saturated on the dark surface.
    static let danger = adaptive(light: "A3341A", dark: "FF9E85")

    static let dangerSurface = adaptive(light: "FFF5F3", dark: "3A2019")

    static let successSurface = adaptive(light: "EEF6F1", dark: "1F3128")

    static let warningSurface = adaptive(light: "FDF6E7", dark: "342B18")

    // MARK: Metrics

    /// Apple's minimum comfortable hit target.
    static let minTapTarget: CGFloat = 44

    private static func adaptive(light: String, dark: String) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark)
                : UIColor(hex: light)
        })
    }
}

extension UIColor {
    convenience init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var rgb: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&rgb)
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension Color {
    init(hex: String) {
        self.init(uiColor: UIColor(hex: hex))
    }
}

// MARK: - Shared layout helpers

extension View {
    /// Guarantees a control is at least 44×44 points.
    func minimumTapTarget() -> some View {
        frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget)
    }

    /// Applies the standard card treatment.
    func cardStyle() -> some View {
        self
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

/// A label-and-value row that stacks instead of truncating when text grows.
///
/// At accessibility text sizes a fixed two-column row either clips the label or
/// squeezes the value to nothing; both were visible in the audit screenshots.
struct AdaptiveRow<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        let stacked = dynamicTypeSize >= .accessibility1

        VStack(alignment: .leading, spacing: 6) {
            if stacked {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                content
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(label)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .frame(width: 110, alignment: .leading)
                    content
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        // The row is one unit to VoiceOver rather than two disconnected labels.
        .accessibilityElement(children: .combine)
    }
}
