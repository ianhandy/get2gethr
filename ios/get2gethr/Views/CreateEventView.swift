import SwiftUI

struct CreateEventView: View {
    @State private var title = ""
    @State private var description = ""
    @State private var initiatorName = ""
    @State private var initiatorEmail = ""
    @State private var dateRangeStart = Date()
    @State private var dateRangeEnd = Calendar.current.date(byAdding: .weekOfYear, value: 1, to: Date()) ?? Date()
    @State private var durationMinutes = 30
    @State private var workingHoursStart = "09:00"
    @State private var workingHoursEnd = "17:00"
    @State private var excludeWeekends = true
    @State private var participantEmails: [String] = []
    @State private var isSubmitting = false
    @State private var createdEventId: String?
    @State private var errorMessage: String?

    private let durationOptions = [15, 30, 45, 60, 90, 120]

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 4) {
                    Text("get2gethr")
                        .font(.system(size: 36, weight: .bold, design: .serif))
                        .foregroundStyle(Theme.primary)
                    Text("Find the perfect time to meet")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .padding(.top, 8)

                // Event Details Card
                cardSection("Event Details") {
                    VStack(spacing: 16) {
                        field("Title") {
                            TextField("Team Sync", text: $title)
                                .textFieldStyle(.plain)
                        }
                        field("Description (optional)") {
                            TextField("What's this meeting about?", text: $description, axis: .vertical)
                                .textFieldStyle(.plain)
                                .lineLimit(2...4)
                        }
                    }
                }

                // Availability Window Card
                cardSection("Availability Window") {
                    VStack(spacing: 16) {
                        HStack(spacing: 12) {
                            field("From") {
                                DatePicker("", selection: $dateRangeStart, displayedComponents: .date)
                                    .labelsHidden()
                            }
                            field("To") {
                                DatePicker("", selection: $dateRangeEnd, displayedComponents: .date)
                                    .labelsHidden()
                            }
                        }

                        field("Duration") {
                            Picker("Duration", selection: $durationMinutes) {
                                ForEach(durationOptions, id: \.self) { mins in
                                    Text(formatDuration(mins)).tag(mins)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        HStack(spacing: 12) {
                            field("Work Start") {
                                Picker("", selection: $workingHoursStart) {
                                    ForEach(hourOptions(), id: \.self) { h in Text(h).tag(h) }
                                }
                                .labelsHidden()
                            }
                            field("Work End") {
                                Picker("", selection: $workingHoursEnd) {
                                    ForEach(hourOptions(), id: \.self) { h in Text(h).tag(h) }
                                }
                                .labelsHidden()
                            }
                        }

                        Toggle("Exclude weekends", isOn: $excludeWeekends)
                            .tint(Theme.accentC)
                            .font(.subheadline)
                    }
                }

                // Your Info Card
                cardSection("Your Info") {
                    VStack(spacing: 16) {
                        field("Name") {
                            TextField("Your name", text: $initiatorName)
                                .textContentType(.name)
                                .textFieldStyle(.plain)
                        }
                        field("Email") {
                            TextField("you@example.com", text: $initiatorEmail)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .autocapitalization(.none)
                                .textFieldStyle(.plain)
                        }
                    }
                }

                // Participants Card
                cardSection("Participants") {
                    ParticipantChipField(emails: $participantEmails)
                }

                // Error
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                // Submit
                Button {
                    Task { await submit() }
                } label: {
                    Group {
                        if isSubmitting {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Text("Send Invites")
                                .fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(isValid ? Theme.accentA : Theme.muted)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(!isValid || isSubmitting)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationDestination(item: $createdEventId) { eventId in
            EventDashboardView(eventId: eventId)
        }
    }

    // MARK: - Helpers

    private var isValid: Bool {
        !title.isEmpty && !initiatorName.isEmpty &&
        initiatorEmail.contains("@") && !participantEmails.isEmpty
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        do {
            let request = CreateEventRequest(
                title: title,
                description: description.isEmpty ? nil : description,
                initiatorEmail: initiatorEmail.lowercased().trimmingCharacters(in: .whitespaces),
                initiatorName: initiatorName,
                dateRangeStart: Int(dateRangeStart.timeIntervalSince1970),
                dateRangeEnd: Int(dateRangeEnd.timeIntervalSince1970),
                durationMinutes: durationMinutes,
                workingHoursStart: workingHoursStart,
                workingHoursEnd: workingHoursEnd,
                timezone: TimeZone.current.identifier,
                excludeWeekends: excludeWeekends,
                participantEmails: participantEmails
            )
            let response = try await APIClient.shared.createEvent(request)
            createdEventId = response.eventId
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    private func formatDuration(_ mins: Int) -> String {
        mins < 60 ? "\(mins)m" : "\(mins / 60)h\(mins % 60 > 0 ? " \(mins % 60)m" : "")"
    }

    private func hourOptions() -> [String] {
        (0..<24).map { String(format: "%02d:00", $0) }
    }

    // MARK: - Card Components

    @ViewBuilder
    private func cardSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.primary)
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 2)
    }

    @ViewBuilder
    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.muted)
            content()
        }
    }
}
