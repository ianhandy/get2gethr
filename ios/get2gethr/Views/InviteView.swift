import SwiftUI
import AuthenticationServices

struct InviteView: View {
    let token: String

    @State private var invite: InviteResponse?
    @State private var currentSlot: SlotData?
    @State private var isLoading = true
    @State private var error: String?
    @State private var isDeclining = false
    @State private var hasResponded = false

    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        Group {
            if isLoading && invite == nil {
                ProgressView("Loading invitation...")
            } else if let invite {
                content(invite)
            } else if let error {
                errorView(error)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ invite: InviteResponse) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 4) {
                    Text("You're Invited")
                        .font(.system(size: 32, weight: .bold, design: .serif))
                        .foregroundStyle(Theme.primary)
                    Text(invite.event.title)
                        .font(.title3)
                        .foregroundStyle(Theme.accentA)
                }
                .padding(.top, 16)

                // Event details card
                VStack(alignment: .leading, spacing: 12) {
                    detailRow("Organizer", invite.event.initiatorName)
                    detailRow("Date Range", dateRangeText(invite.event))
                    detailRow("Duration", "\(invite.event.durationMinutes) min")
                    detailRow("Timezone", invite.event.timezone)

                    if let desc = invite.event.description, !desc.isEmpty {
                        Divider()
                        Text(desc)
                            .font(.subheadline)
                            .foregroundStyle(Theme.primary)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: .black.opacity(0.04), radius: 8, y: 2)

                // Status / Actions
                if invite.participant.status == .joined, let slot = currentSlot {
                    SlotConfirmView(token: token, slot: slot)
                } else if invite.participant.status == .joined {
                    joinedState()
                } else if invite.participant.status == .declined || hasResponded {
                    declinedState()
                } else {
                    actionButtons()
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
    }

    @ViewBuilder
    private func actionButtons() -> some View {
        VStack(spacing: 12) {
            Text("Connect your Google Calendar so we can find a time that works for everyone.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)

            Button {
                Task { await connectCalendar() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.plus")
                    Text("Connect Google Calendar")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accentC)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            Button {
                Task { await decline() }
            } label: {
                Text(isDeclining ? "Declining..." : "Decline Invitation")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .disabled(isDeclining)
        }
    }

    @ViewBuilder
    private func joinedState() -> some View {
        VStack(spacing: 8) {
            Image(systemName: "clock.fill")
                .font(.system(size: 48))
                .foregroundStyle(Theme.accentB)
            Text("No Time Proposed Yet")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(Theme.primary)
            Text("Still waiting for everyone to respond. You'll receive an email when it's time to confirm.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 20)
    }

    @ViewBuilder
    private func declinedState() -> some View {
        VStack(spacing: 8) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(Theme.muted)
            Text("Declined")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(Theme.primary)
        }
        .padding(.vertical, 20)
    }

    @ViewBuilder
    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.muted)
            Spacer()
            Text(value)
                .font(.subheadline)
                .foregroundStyle(Theme.primary)
        }
    }

    @ViewBuilder
    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(Theme.accentA)
            Text(message)
                .foregroundStyle(Theme.primary)
            Button("Retry") { Task { await load() } }
                .foregroundStyle(Theme.accentA)
        }
    }

    // MARK: - Actions

    private func load() async {
        isLoading = true
        do {
            let inviteData = try await APIClient.shared.getInvite(token: token)
            invite = inviteData
            error = nil

            // If joined, check for a proposed slot to confirm
            if inviteData.participant.status == .joined {
                let eventDetail = try await APIClient.shared.getEvent(id: inviteData.event.id)
                currentSlot = eventDetail.currentSlot
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func connectCalendar() async {
        let authURL = await APIClient.shared.googleAuthURL(token: token)
        do {
            // Opens the Google OAuth flow in an in-app browser
            let _ = try await webAuthenticationSession.authenticate(
                using: authURL,
                callbackURLScheme: "get2gethr"
            )
            // After OAuth completes, reload to see updated status
            await load()
        } catch {
            // User cancelled — that's fine
        }
    }

    private func decline() async {
        isDeclining = true
        do {
            let _ = try await APIClient.shared.declineInvite(token: token)
            hasResponded = true
        } catch {
            self.error = error.localizedDescription
        }
        isDeclining = false
    }

    private func dateRangeText(_ event: EventSummary) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        return "\(f.string(from: event.dateRangeStartDate)) — \(f.string(from: event.dateRangeEndDate))"
    }
}
