import SwiftUI

struct EventDashboardView: View {
    let eventId: String

    @State private var detail: EventDetailResponse?
    @State private var isLoading = true
    @State private var error: String?
    @State private var refreshTimer: Timer?

    var body: some View {
        Group {
            if isLoading && detail == nil {
                ProgressView("Loading event...")
            } else if let detail {
                content(detail)
            } else if let error {
                errorView(error)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onAppear { startPolling() }
        .onDisappear { refreshTimer?.invalidate() }
    }

    @ViewBuilder
    private func content(_ detail: EventDetailResponse) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                // Title
                VStack(spacing: 6) {
                    Text(detail.event.title)
                        .font(.system(size: 28, weight: .bold, design: .serif))
                        .foregroundStyle(Theme.primary)
                        .multilineTextAlignment(.center)

                    Text(dateRangeText(detail.event))
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .padding(.top, 8)

                // Status
                StatusBanner(status: detail.event.status)

                // Proposed time (if proposing/confirmed)
                if let slot = detail.currentSlot {
                    proposedTimeCard(slot, event: detail.event)
                }

                // Participants
                participantsCard(detail.participants)

                // Event info
                infoCard(detail.event)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
    }

    @ViewBuilder
    private func proposedTimeCard(_ slot: SlotData, event: EventData) -> some View {
        VStack(spacing: 8) {
            Text("Proposed Time")
                .font(.caption)
                .foregroundStyle(Theme.muted)
            Text(slot.startDate, style: .date)
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.primary)
            Text("\(slot.startDate, style: .time) - \(slot.endDate, style: .time)")
                .font(.headline)
                .foregroundStyle(Theme.accentA)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 2)
    }

    @ViewBuilder
    private func participantsCard(_ participants: [ParticipantData]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Participants")
                    .font(.headline)
                    .foregroundStyle(Theme.primary)
                Spacer()
                Text("\(participants.filter { $0.status == .joined }.count)/\(participants.count) joined")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }

            // Progress bar
            let joinedCount = Double(participants.filter { $0.status != .pending }.count)
            let total = Double(max(participants.count, 1))
            ProgressView(value: joinedCount, total: total)
                .tint(Theme.accentC)

            ForEach(participants) { p in
                HStack(spacing: 10) {
                    Circle()
                        .fill(statusColor(p.status))
                        .frame(width: 8, height: 8)
                    Text(p.email)
                        .font(.subheadline)
                        .foregroundStyle(Theme.primary)
                    Spacer()
                    Text(p.status.rawValue.capitalized)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 2)
    }

    @ViewBuilder
    private func infoCard(_ event: EventData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            infoRow("Duration", "\(event.durationMinutes) min")
            infoRow("Timezone", event.timezone)
            infoRow("Created by", event.initiatorName)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 2)
    }

    @ViewBuilder
    private func infoRow(_ label: String, _ value: String) -> some View {
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

    // MARK: - Data

    private func load() async {
        isLoading = true
        do {
            detail = try await APIClient.shared.getEvent(id: eventId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func startPolling() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            Task { await load() }
        }
    }

    private func dateRangeText(_ event: EventData) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        return "\(f.string(from: event.dateRangeStartDate)) — \(f.string(from: event.dateRangeEndDate))"
    }

    private func statusColor(_ status: ParticipantStatus) -> Color {
        switch status {
        case .pending: return Theme.accentB
        case .joined: return Theme.accentC
        case .declined: return Theme.accentA
        }
    }
}
