import SwiftUI

struct SlotConfirmView: View {
    let token: String
    let slot: SlotData

    @State private var isConfirming = false
    @State private var isDeclining = false
    @State private var result: ConfirmResult?
    @State private var error: String?

    enum ConfirmResult {
        case confirmed, declined
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 4) {
                    Text("Proposed Time")
                        .font(.system(size: 28, weight: .bold, design: .serif))
                        .foregroundStyle(Theme.primary)
                    Text("Does this work for you?")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .padding(.top, 16)

                // Time Card
                VStack(spacing: 12) {
                    Text(slot.startDate, style: .date)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundStyle(Theme.primary)

                    HStack(spacing: 4) {
                        Text(slot.startDate, style: .time)
                        Text("—")
                        Text(slot.endDate, style: .time)
                    }
                    .font(.title3)
                    .foregroundStyle(Theme.accentA)
                }
                .frame(maxWidth: .infinity)
                .padding(24)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: .black.opacity(0.04), radius: 8, y: 2)

                // Result or Actions
                if let result {
                    resultView(result)
                } else {
                    actionButtons()
                }

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    @ViewBuilder
    private func actionButtons() -> some View {
        VStack(spacing: 12) {
            Button {
                Task { await respond("confirmed") }
            } label: {
                HStack(spacing: 8) {
                    if isConfirming {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "checkmark")
                    }
                    Text("Confirm")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accentC)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isConfirming || isDeclining)

            Button {
                Task { await respond("declined") }
            } label: {
                HStack(spacing: 8) {
                    if isDeclining {
                        ProgressView().tint(Theme.accentA)
                    } else {
                        Image(systemName: "xmark")
                    }
                    Text("Doesn't Work")
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accentA.opacity(0.1))
                .foregroundStyle(Theme.accentA)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isConfirming || isDeclining)
        }
    }

    @ViewBuilder
    private func resultView(_ result: ConfirmResult) -> some View {
        VStack(spacing: 8) {
            Image(systemName: result == .confirmed ? "checkmark.circle.fill" : "arrow.clockwise.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(result == .confirmed ? Theme.accentC : Theme.accentB)
            Text(result == .confirmed ? "Time Confirmed!" : "Looking for Another Time")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(Theme.primary)
            Text(result == .confirmed
                 ? "You'll receive a confirmation email shortly."
                 : "We'll propose another option soon.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 20)
    }

    private func respond(_ response: String) async {
        if response == "confirmed" { isConfirming = true } else { isDeclining = true }
        error = nil
        do {
            let _ = try await APIClient.shared.confirmSlot(token: token, response: response)
            result = response == "confirmed" ? .confirmed : .declined
        } catch {
            self.error = error.localizedDescription
        }
        isConfirming = false
        isDeclining = false
    }
}
