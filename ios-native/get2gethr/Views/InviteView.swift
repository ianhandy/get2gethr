import SwiftUI
import AuthenticationServices

struct InviteView: View {
    let token: String

    @EnvironmentObject private var router: Router
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var view: EventView?
    @State private var errorMessage: String?
    @State private var isWorking = false
    @State private var connectError: String?
    @State private var showScheduleImport = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let view {
                    content(for: view)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(14)
                        .background(Theme.dangerSurface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    ProgressView("Loading invitation…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Invitation")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(isPresented: $showScheduleImport) {
            if let event = view?.event {
                ScheduleImportView(event: event, token: token) {
                    Task { await load() }
                }
            }
        }
    }

    @ViewBuilder
    private func content(for view: EventView) -> some View {
        let event = view.event
        let connected = view.viewer.status == .joined && (
            view.viewer.connection?.status == .connected
                || view.viewer.manualSchedule == true
        )

        VStack(alignment: .leading, spacing: 6) {
            Text("Invitation from \(event.organizerName)")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
            Text(event.title)
                .font(.system(.title, design: .serif, weight: .bold))
                .foregroundStyle(Theme.primary)
                .fixedSize(horizontal: false, vertical: true)
            if let description = event.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        VStack(alignment: .leading, spacing: 12) {
            if let email = view.viewer.email {
                AdaptiveRow(label: "Invited as") {
                    Text(email)
                        .font(.subheadline)
                        .foregroundStyle(Theme.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            AdaptiveRow(label: "Date window") {
                Text(event.formattedDateWindow())
                    .font(.subheadline)
                    .foregroundStyle(Theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            AdaptiveRow(label: "Length") {
                Text("\(event.durationMinutes) minutes")
                    .font(.subheadline)
                    .foregroundStyle(Theme.primary)
            }
            AdaptiveRow(label: "Times shown in") {
                Text(event.timezone)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .cardStyle()

        if let connectError {
            Text(connectError)
                .font(.callout)
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.dangerSurface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }

        if view.viewer.status == .declined {
            declinedCard(event)
        } else if connected {
            connectedCard(view)
        } else {
            connectCard(view)
        }
    }

    @ViewBuilder
    private func connectCard(_ view: EventView) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Connect your calendar")
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .accessibilityAddTraits(.isHeader)

            Text("We read only when you're busy — never your event titles, guests, or notes.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if let providers = view.providers, providers.count > 1 {
                Text("Works with \(Self.providerList(providers)).")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Task { await connectCalendar() }
            } label: {
                Group {
                    if isWorking {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        // Provider-neutral wording: the hosted page offers the
                        // choice, so the app never has to say "Google".
                        Text("Connect calendar").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                .padding(.vertical, 6)
                .background(Theme.accentA)
                .foregroundStyle(Theme.onAccent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isWorking)

            if view.viewer.role == "attendee" {
                HStack(spacing: 12) {
                    Rectangle().fill(Theme.border).frame(height: 1)
                    Text("or")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                    Rectangle().fill(Theme.border).frame(height: 1)
                }
                .accessibilityHidden(true)

                Button {
                    showScheduleImport = true
                } label: {
                    Label("Scan a schedule", systemImage: "camera.viewfinder")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                        .padding(.vertical, 6)
                        .background(Theme.surfaceSunken)
                        .foregroundStyle(Theme.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isWorking)

                Text("The image is read on this iPhone and is never uploaded.")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if view.providers?.contains("apple") == true {
                Text("Apple iCloud needs an app-specific password, which you'll be asked for during setup.")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button("I can't make it — decline") {
                Task { await decline() }
            }
            .font(.subheadline)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            .disabled(isWorking)
        }
        .cardStyle()
    }

    @ViewBuilder
    private func connectedCard(_ view: EventView) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("You're all set")
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .accessibilityAddTraits(.isHeader)

            Text(view.viewer.manualSchedule == true && view.viewer.connection == nil
                 ? "Your reviewed busy times are included. We'll let you know as soon as there's a time to confirm."
                 : "Your calendar is connected. We'll let you know as soon as there's a time to confirm.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if let connection = view.viewer.connection {
                AdaptiveRow(label: "Account") {
                    Text(connection.accountEmail ?? view.viewer.email ?? "Connected")
                        .font(.subheadline)
                        .foregroundStyle(Theme.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                AdaptiveRow(label: "Calendars read") {
                    Text("\(connection.sourceCalendarCount)")
                        .font(.subheadline)
                        .foregroundStyle(Theme.primary)
                }
                if connection.status == .relinkRequired {
                    Button("Reconnect calendar") {
                        Task { await connectCalendar() }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accentA)
                    .frame(minHeight: Theme.minTapTarget)
                }
            }

            if view.viewer.manualSchedule == true && view.viewer.role == "attendee" {
                Button("Update scanned schedule") {
                    showScheduleImport = true
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.accentA)
                .frame(minHeight: Theme.minTapTarget)
            }

            if let others = view.others {
                Text("\(others.joined) of \(others.total + 1) people ready so far.")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if view.currentSlot != nil {
                Button("There's a time to confirm") {
                    router.navigate(to: .confirmSlot(token: token))
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                .background(Theme.accentC)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private func declinedCard(_ event: EventSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Invitation declined")
                .font(.headline)
                .foregroundStyle(Theme.primary)
            Text("You let \(event.organizerName) know you can't make it.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .cardStyle()
    }

    // MARK: Behaviour

    private func load() async {
        do {
            view = try await APIClient.shared.invite(token: token)
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
    }

    /// Opens the hosted, provider-neutral connection page.
    ///
    /// The same page serves the web, so there is one authorization surface. The
    /// session returns to `get2gethr://`, which is registered by the app, and
    /// the server rejects any account that is not the invited person.
    private func connectCalendar() async {
        isWorking = true
        connectError = nil
        defer { isWorking = false }

        let url = APIClient.shared.calendarConnectURL(inviteToken: token)

        do {
            let callback = try await WebAuthenticationSession.start(
                url: url,
                callbackScheme: DeepLink.scheme
            )
            if let error = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "error" })?.value {
                connectError = Self.message(forConnectError: error)
            }
            await load()
        } catch let error as ASWebAuthenticationSessionError
            where error.code == .canceledLogin {
            // Cancelling is an ordinary choice, not a failure to report.
            return
        } catch {
            connectError = "We couldn't open the calendar connection. Please try again."
        }
    }

    private func decline() async {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await APIClient.shared.declineInvite(token: token)
            await load()
        } catch {
            connectError = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
    }

    private static func providerList(_ providers: [String]) -> String {
        let names: [String: String] = [
            "google": "Google",
            "microsoft": "Microsoft 365",
            "apple": "Apple iCloud",
            "exchange": "Exchange",
        ]
        return providers
            .filter { $0 != "other" }
            .compactMap { names[$0] ?? $0.capitalized }
            .joined(separator: ", ")
    }

    private static func message(forConnectError code: String) -> String {
        switch code {
        case "denied":
            return "The connection was cancelled. Nothing was shared, and you can try again any time."
        case "account_mismatch":
            return "That calendar belongs to a different email address. Sign in with the account this invitation was sent to."
        case "expired_state", "replayed_state", "invalid_state":
            return "That request timed out for security reasons. Please try connecting again."
        default:
            return "Your calendar provider couldn't complete the connection. Please try again in a moment."
        }
    }
}

/// Async wrapper around `ASWebAuthenticationSession`.
enum WebAuthenticationSession {
    @MainActor
    static func start(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: APIError.invalidResponse)
                }
            }
            session.presentationContextProvider = PresentationAnchor.shared
            // A fresh session avoids silently reusing a signed-in account the
            // person did not intend to connect.
            session.prefersEphemeralWebBrowserSession = true
            session.start()
        }
    }
}

/// Supplies the window the authentication sheet is presented from.
final class PresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = PresentationAnchor()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
