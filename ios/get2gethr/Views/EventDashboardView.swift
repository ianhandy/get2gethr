import SwiftUI
import AuthenticationServices

struct EventDashboardView: View {
    let eventId: String
    let organizerToken: String?

    @EnvironmentObject private var router: Router

    @State private var view: EventView?
    @State private var errorMessage: String?
    @State private var notice: String?
    @State private var busyAction: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if organizerToken == nil {
                    missingCredentialCard
                } else if let view {
                    content(for: view)
                } else if let errorMessage {
                    errorCard(errorMessage)
                } else {
                    ProgressView("Loading event…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Your event")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private var missingCredentialCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Organizer link needed")
                .font(.headline)
                .foregroundStyle(Theme.primary)
            Text("This view needs the organizer link created with the event. Open the link from the device that created it.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .cardStyle()
    }

    @ViewBuilder
    private func content(for view: EventView) -> some View {
        let event = view.event

        VStack(alignment: .leading, spacing: 6) {
            Text(event.title)
                .font(.system(.title, design: .serif, weight: .bold))
                .foregroundStyle(Theme.primary)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(event.formattedDateWindow()) · \(event.durationMinutes) min · \(event.timezone)")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        StatusBanner(
            status: event.status,
            calendarWriteStatus: event.calendarWriteStatus
        )

        if let message = event.calendarWriteError, event.calendarWriteStatus == .failed {
            VStack(alignment: .leading, spacing: 6) {
                Text("The meeting isn't on a calendar yet.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.danger)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Everyone has the time and a calendar attachment by email in the meantime.")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.dangerSurface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }

        if let slot = view.confirmedSlot ?? view.currentSlot {
            VStack(alignment: .leading, spacing: 4) {
                Text(view.confirmedSlot != nil ? "Agreed time" : "Proposed time")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                Text(event.formattedSlot(slot))
                    .font(.headline)
                    .foregroundStyle(Theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardStyle()
            .accessibilityElement(children: .combine)
        }

        // Connecting the organizer's calendar is what releases the invitations.
        if event.status == .draft || view.viewer.connection?.status != .connected,
           let inviteToken = organizerInviteToken(from: view) {
            connectOrganizerCard(inviteToken: inviteToken)
        }

        participantsCard(view)
        controlsCard(view)

        if let notice {
            Text(notice)
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    @ViewBuilder
    private func connectOrganizerCard(inviteToken: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Connect your calendar to send the invitations")
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text("Your own availability has to be part of the search, and the agreed meeting is written to your calendar. Nothing is sent until this is done.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                Task { await connectOrganizerCalendar(inviteToken: inviteToken) }
            } label: {
                Group {
                    if busyAction == "connect" {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Connect calendar").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                .padding(.vertical, 6)
                .background(Theme.accentA)
                .foregroundStyle(Theme.onAccent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(busyAction != nil)
        }
        .cardStyle()
    }

    @ViewBuilder
    private func participantsCard(_ view: EventView) -> some View {
        let people = (view.participants ?? []).filter { $0.status != .removed }

        VStack(alignment: .leading, spacing: 12) {
            Text("People (\(people.count))")
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .accessibilityAddTraits(.isHeader)

            ForEach(people) { person in
                // Stacks rather than clipping when an address or name is long.
                VStack(alignment: .leading, spacing: 4) {
                    Text(person.name ?? person.email)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(person.email)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(Self.statusLabel(person))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.primary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Self.statusBackground(person.status))
                        .clipShape(Capsule())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "\(person.name ?? person.email), \(person.email), \(Self.statusLabel(person))"
                )
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private func controlsCard(_ view: EventView) -> some View {
        let event = view.event

        VStack(alignment: .leading, spacing: 12) {
            Text("Controls")
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .accessibilityAddTraits(.isHeader)

            if event.status == .gathering {
                actionButton("Send reminders", action: "remind")
                actionButton("Resend invitations", action: "resend_invitations")
            }
            if event.status == .proposing {
                actionButton("Confirm this time anyway", action: "force_confirm")
            }
            if event.calendarWriteStatus == .failed {
                actionButton("Try adding to calendar again", action: "retry_calendar_write")
            }
            if event.status != .cancelled && event.status != .confirmed {
                actionButton("Cancel event", action: "cancel", destructive: true)
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private func actionButton(
        _ label: String,
        action: String,
        destructive: Bool = false
    ) -> some View {
        Button {
            Task { await perform(action) }
        } label: {
            Group {
                if busyAction == action {
                    ProgressView()
                } else {
                    Text(label).fontWeight(.medium)
                }
            }
            .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            .padding(.vertical, 6)
            .foregroundStyle(destructive ? Theme.danger : Theme.primary)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(destructive ? Theme.accentA : Theme.border, lineWidth: 1)
            )
        }
        .disabled(busyAction != nil)
    }

    @ViewBuilder
    private func errorCard(_ message: String) -> some View {
        Text(message)
            .font(.callout)
            .foregroundStyle(Theme.danger)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.dangerSurface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Behaviour

    private func load() async {
        guard let organizerToken else { return }
        do {
            view = try await APIClient.shared.event(id: eventId, organizerToken: organizerToken)
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
    }

    private func perform(_ action: String) async {
        guard let organizerToken else { return }
        busyAction = action
        notice = nil
        defer { busyAction = nil }

        do {
            let response = try await APIClient.shared.performOrganizerAction(
                eventId: eventId,
                organizerToken: organizerToken,
                action: action
            )
            if let error = response.error {
                notice = error
            } else if let sent = response.sent {
                notice = "Sent \(sent) message\(sent == 1 ? "" : "s")."
            } else {
                notice = "Done."
            }
            await load()
        } catch {
            notice = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func connectOrganizerCalendar(inviteToken: String) async {
        busyAction = "connect"
        notice = nil
        defer { busyAction = nil }

        do {
            let callback = try await WebAuthenticationSession.start(
                url: APIClient.shared.calendarConnectURL(inviteToken: inviteToken),
                callbackScheme: DeepLink.scheme
            )
            if let error = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "error" })?.value {
                notice = "Couldn't connect the calendar (\(error)). Please try again."
            }
            await load()
        } catch let error as ASWebAuthenticationSessionError
            where error.code == .canceledLogin {
            return
        } catch {
            notice = "We couldn't open the calendar connection. Please try again."
        }
    }

    /// The organizer's own invitation token, used to connect their calendar.
    private func organizerInviteToken(from view: EventView) -> String? {
        // The API deliberately never returns invite tokens, so this comes from
        // the create response held by the router's navigation state.
        OrganizerSession.shared.inviteToken(forEvent: eventId)
    }

    private static func statusLabel(_ person: ParticipantData) -> String {
        switch person.status {
        case .joined:
            if person.connection?.status == .relinkRequired { return "Needs reconnecting" }
            return "Connected"
        case .pending: return "Waiting"
        case .declined: return "Declined"
        case .removed: return "Removed"
        }
    }

    private static func statusBackground(_ status: ParticipantStatus) -> Color {
        switch status {
        case .joined: return Theme.successSurface
        case .pending: return Theme.warningSurface
        case .declined, .removed: return Theme.dangerSurface
        }
    }
}

/// Remembers the organizer's own invitation token for events created on this
/// device, so the dashboard can offer the calendar connection.
///
/// The token is a capability, so it stays on the device and is never returned
/// by a read endpoint.
@MainActor
final class OrganizerSession {
    static let shared = OrganizerSession()

    private let defaultsKey = "organizer.inviteTokens"

    func remember(eventId: String, inviteToken: String) {
        var map = stored()
        map[eventId] = inviteToken
        UserDefaults.standard.set(map, forKey: defaultsKey)
    }

    func inviteToken(forEvent eventId: String) -> String? {
        stored()[eventId]
    }

    func forget(eventId: String) {
        var map = stored()
        map.removeValue(forKey: eventId)
        UserDefaults.standard.set(map, forKey: defaultsKey)
    }

    private func stored() -> [String: String] {
        UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: String] ?? [:]
    }
}
