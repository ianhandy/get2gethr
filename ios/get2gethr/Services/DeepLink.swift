import Foundation
import SwiftUI

/// A destination inside the app that a link can address.
enum DeepLink: Equatable, Hashable {
    /// An invitation: connect a calendar, or decline.
    case invite(token: String)
    /// The slot-confirmation screen for an invitation.
    case confirmSlot(token: String)
    /// The organizer's view. Requires the organizer capability from the URL.
    case event(id: String, organizerToken: String?)

    /// Fallback scheme, registered so `ASWebAuthenticationSession` can return
    /// to the app. Shareable links are always HTTPS universal links.
    static let scheme = "get2gethr"

    /// Parses a universal link or a `get2gethr://` URL into a destination.
    ///
    /// Anything unrecognised returns `nil` so the caller can hand it to Safari
    /// rather than silently swallowing a link the app does not understand.
    static func parse(_ url: URL) -> DeepLink? {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)

        // For `get2gethr://invite/abc` the host is the first path element.
        var segments: [String]
        if url.scheme == scheme {
            segments = [components?.host].compactMap { $0 }
                + url.pathComponents.filter { $0 != "/" }
        } else {
            guard url.scheme == "https" else { return nil }
            // Only our own host may open the app.
            guard url.host == AppEnvironment.universalLinkHost else { return nil }
            segments = url.pathComponents.filter { $0 != "/" }
        }

        guard let first = segments.first else { return nil }

        switch first {
        case "invite":
            guard segments.count >= 2 else { return nil }
            let token = segments[1]
            guard !token.isEmpty else { return nil }
            if segments.count >= 3, segments[2] == "confirm" {
                return .confirmSlot(token: token)
            }
            return .invite(token: token)

        case "events":
            guard segments.count >= 2, !segments[1].isEmpty else { return nil }
            let organizerToken = components?.queryItems?
                .first(where: { $0.name == "organizerToken" })?.value
            return .event(id: segments[1], organizerToken: organizerToken)

        default:
            return nil
        }
    }

    /// The canonical shareable HTTPS address for this destination.
    var webURL: URL {
        switch self {
        case .invite(let token):
            return AppEnvironment.baseURL.appendingPathComponent("/invite/\(token)")
        case .confirmSlot(let token):
            return AppEnvironment.baseURL.appendingPathComponent("/invite/\(token)/confirm")
        case .event(let id, let organizerToken):
            var components = URLComponents(
                url: AppEnvironment.baseURL.appendingPathComponent("/events/\(id)"),
                resolvingAgainstBaseURL: false
            )!
            if let organizerToken {
                components.queryItems = [
                    URLQueryItem(name: "organizerToken", value: organizerToken)
                ]
            }
            return components.url!
        }
    }
}

/// Navigation state for the whole app.
///
/// Holding the path here — rather than inside a single screen — is what lets an
/// emailed link open the right view, and what lets the app come back to where
/// the person was after it is relaunched.
@MainActor
final class Router: ObservableObject {
    @Published var path: [DeepLink] = []

    /// Set when a link arrives that this app cannot handle, so the UI can
    /// offer to open it on the web instead of doing nothing.
    @Published var unhandledLink: URL?

    private static let restorationKey = "router.lastDestination"

    func open(_ url: URL) {
        guard let destination = DeepLink.parse(url) else {
            unhandledLink = url
            return
        }
        navigate(to: destination)
    }

    func navigate(to destination: DeepLink) {
        // Replace rather than stack, so following a second invitation link does
        // not bury the first one behind a back button.
        path = [destination]
        persist(destination)
    }

    func reset() {
        path = []
        UserDefaults.standard.removeObject(forKey: Self.restorationKey)
    }

    /// Restores the last destination so relaunching does not always land on a
    /// blank create-event form.
    func restore() {
        guard path.isEmpty,
              let raw = UserDefaults.standard.string(forKey: Self.restorationKey),
              let url = URL(string: raw),
              let destination = DeepLink.parse(url) else { return }
        path = [destination]
    }

    private func persist(_ destination: DeepLink) {
        UserDefaults.standard.set(
            destination.webURL.absoluteString,
            forKey: Self.restorationKey
        )
    }
}
