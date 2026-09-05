import SwiftUI

struct SlotConfirmView: View {
    let token: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var view: EventView?
    @State private var errorMessage: String?
    @State private var isSubmitting = false
    @State private var answered: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let answered {
                    answeredCard(answered)
                } else if let view {
                    content(for: view)
                } else if let errorMessage {
                    errorCard(errorMessage)
                } else {
                    ProgressView("Loading…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Confirm a time")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func content(for view: EventView) -> some View {
        let event = view.event

        VStack(alignment: .leading, spacing: 6) {
            Text("Proposed meeting time")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
            Text(event.title)
                .font(.system(.title, design: .serif, weight: .bold))
                .foregroundStyle(Theme.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        if view.viewer.status != .joined {
            VStack(alignment: .leading, spacing: 8) {
                Text("Connect your calendar first")
                    .font(.headline)
                    .foregroundStyle(Theme.primary)
                Text("Go back to the invitation to connect, then come back here.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .cardStyle()
        } else if let slot = view.currentSlot {
            VStack(alignment: .leading, spacing: 10) {
                Text(event.formattedSlot(slot))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(event.timezone)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardStyle()
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                "Proposed time: \(event.formattedSlot(slot)), \(event.timezone)"
            )

            if let errorMessage {
                errorCard(errorMessage)
            }

            VStack(alignment: .leading, spacing: 12) {
                Text("Does this time work for you?")
                    .font(.headline)
                    .foregroundStyle(Theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)

                // Stacked, so neither label is ever squeezed or truncated.
                Button {
                    Task { await respond("confirmed", slotId: slot.id) }
                } label: {
                    Text("Works for me")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                        .padding(.vertical, 6)
                        .background(Theme.accentC)
                        .foregroundStyle(Theme.onAccent)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isSubmitting)

                Button {
                    Task { await respond("declined", slotId: slot.id) }
                } label: {
                    Text("Try another time")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                        .padding(.vertical, 6)
                        .foregroundStyle(Theme.accentA)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Theme.accentA, lineWidth: 1.5)
                        )
                }
                .disabled(isSubmitting)

                if isSubmitting {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("Sending your answer")
                }
            }
            .cardStyle()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("No time to confirm yet")
                    .font(.headline)
                    .foregroundStyle(Theme.primary)
                Text("We're still waiting on everyone. You'll get an email the moment there's a time to look at.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .cardStyle()
        }
    }

    @ViewBuilder
    private func answeredCard(_ answer: String) -> some View {
        let confirmed = answer == "confirmed"
        let written = view?.event.calendarWriteStatus == .written

        VStack(alignment: .leading, spacing: 10) {
            Text(confirmed ? "Thanks — that's a yes from you" : "Looking for another time")
                .font(.system(.title2, design: .serif, weight: .bold))
                .foregroundStyle(Theme.primary)
                .fixedSize(horizontal: false, vertical: true)

            // "Confirmed" means this person answered, not that a calendar entry
            // exists. The wording keeps that distinction.
            Text(
                confirmed
                    ? (written
                        ? "It's on the calendar. Check your email for the invitation."
                        : "We'll add it to the calendar once everyone has answered, and email you the invitation.")
                    : "No problem — we'll propose the next time that works and let everyone know."
            )
            .font(.subheadline)
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
        .transition(reduceMotion ? .identity : .opacity)
        .accessibilityElement(children: .combine)
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
        do {
            view = try await APIClient.shared.invite(token: token)
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
    }

    private func respond(_ answer: String, slotId: String) async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            _ = try await APIClient.shared.respondToSlot(
                token: token,
                response: answer,
                // Sending the slot id means an answer to a slot that has since
                // been replaced is rejected rather than silently recorded.
                slotId: slotId
            )
            answered = answer
            await load()
        } catch {
            errorMessage = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
            await load()
        }
    }
}
