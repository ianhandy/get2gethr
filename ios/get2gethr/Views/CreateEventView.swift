import SwiftUI

struct CreateEventView: View {
    @EnvironmentObject private var router: Router
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var title = ""
    @State private var eventDescription = ""
    @State private var organizerName = ""
    @State private var organizerEmail = ""
    @State private var startDate = Date()
    @State private var endDate = Calendar.current.date(
        byAdding: .day, value: 4, to: Date()
    ) ?? Date()
    @State private var durationMinutes = 30
    @State private var workingStart = Self.defaultTime(hour: 9)
    @State private var workingEnd = Self.defaultTime(hour: 17)
    @State private var excludeWeekends = true
    @State private var participantEmails: [String] = []

    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var fieldErrors: [String: String] = [:]
    /// Stable across retries so a resubmission cannot create a second event.
    @State private var idempotencyKey = UUID().uuidString

    private let durationOptions = [15, 30, 45, 60, 90, 120]

    /// Stacks side-by-side pairs once text is large enough that a row would clip.
    private var shouldStackPairs: Bool { dynamicTypeSize >= .accessibility1 }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header
                eventDetailsCard
                availabilityCard
                organizerCard
                participantsCard

                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Theme.dangerSurface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .accessibilityAddTraits(.isStaticText)
                }

                submitButton

                Text("You'll connect your own calendar next. Invitations go out after that.")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: Sections

    private var header: some View {
        VStack(spacing: 4) {
            Text("get2gethr")
                .font(.system(.largeTitle, design: .serif, weight: .bold))
                // Allows the wordmark to shrink a little rather than clip, but
                // never below a readable size.
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .foregroundStyle(Theme.primary)
            Text("Find the perfect time to meet")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var eventDetailsCard: some View {
        card("Event details") {
            VStack(alignment: .leading, spacing: 16) {
                field("Meeting title", error: fieldErrors["title"]) {
                    TextField("Weekly sync", text: $title)
                        .textInputAutocapitalization(.sentences)
                        .inputFieldStyle()
                }
                field("Description", error: nil) {
                    TextField("What is this about?", text: $eventDescription, axis: .vertical)
                        .lineLimit(2...5)
                        .inputFieldStyle()
                }
                field("Length", error: fieldErrors["durationMinutes"]) {
                    // A Picker menu can express every option at any text size;
                    // the segmented control truncated "90 minutes" even at the
                    // default size on a small phone.
                    Picker("Length", selection: $durationMinutes) {
                        ForEach(durationOptions, id: \.self) { minutes in
                            Text(Self.durationLabel(minutes)).tag(minutes)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 12)
                    .background(Theme.surfaceSunken)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .minimumTapTarget()
                }
            }
        }
    }

    private var availabilityCard: some View {
        card("Availability window") {
            VStack(alignment: .leading, spacing: 16) {
                Text("Both dates are included. Times are in \(TimeZone.current.identifier).")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                adaptivePair(
                    first: field("Earliest date", error: fieldErrors["startDate"]) {
                        DatePicker(
                            "Earliest date",
                            selection: $startDate,
                            displayedComponents: .date
                        )
                        .labelsHidden()
                        .minimumTapTarget()
                    },
                    second: field("Latest date", error: fieldErrors["endDate"]) {
                        DatePicker(
                            "Latest date",
                            selection: $endDate,
                            in: startDate...,
                            displayedComponents: .date
                        )
                        .labelsHidden()
                        .minimumTapTarget()
                    }
                )

                adaptivePair(
                    first: field("Work day starts", error: nil) {
                        DatePicker(
                            "Work day starts",
                            selection: $workingStart,
                            displayedComponents: .hourAndMinute
                        )
                        .labelsHidden()
                        .minimumTapTarget()
                    },
                    second: field("Work day ends", error: fieldErrors["workingHoursEnd"]) {
                        DatePicker(
                            "Work day ends",
                            selection: $workingEnd,
                            displayedComponents: .hourAndMinute
                        )
                        .labelsHidden()
                        .minimumTapTarget()
                    }
                )

                // At accessibility sizes a trailing switch squeezes the label
                // into a narrow column, where SwiftUI hyphenates it
                // ("Skip week-ends"). Giving the label its own full-width line
                // avoids the break entirely.
                if shouldStackPairs {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Skip weekends")
                            .font(.body)
                            .foregroundStyle(Theme.primary)
                            .fixedSize(horizontal: false, vertical: true)
                        Toggle("Skip weekends", isOn: $excludeWeekends)
                            .labelsHidden()
                            .tint(Theme.accentC)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                } else {
                    Toggle("Skip weekends", isOn: $excludeWeekends)
                        .tint(Theme.accentC)
                        .font(.body)
                        .foregroundStyle(Theme.primary)
                        .frame(minHeight: Theme.minTapTarget)
                }
            }
        }
    }

    private var organizerCard: some View {
        card("Your information") {
            VStack(alignment: .leading, spacing: 16) {
                field("Your name", error: fieldErrors["organizerName"]) {
                    TextField("Jane Smith", text: $organizerName)
                        .textContentType(.name)
                        .inputFieldStyle()
                }
                field("Your email", error: fieldErrors["organizerEmail"]) {
                    TextField("jane@example.com", text: $organizerEmail)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .inputFieldStyle()
                }
            }
        }
    }

    private var participantsCard: some View {
        card("Who's coming") {
            VStack(alignment: .leading, spacing: 8) {
                ParticipantChipField(emails: $participantEmails)
                if let message = fieldErrors["participantEmails"] {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            Group {
                if isSubmitting {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Text("Create event").fontWeight(.semibold)
                }
            }
            .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            .padding(.vertical, 8)
            .background(isValid ? Theme.accentA : Theme.muted)
            .foregroundStyle(Theme.onAccent)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(!isValid || isSubmitting)
        .accessibilityLabel(isSubmitting ? "Creating event" : "Create event")
        .accessibilityHint(
            isValid
                ? "Creates the event, then asks you to connect your calendar"
                : "Fill in the title, your name and email, and at least one participant first"
        )
    }

    // MARK: Layout helpers

    /// Two controls side by side, stacked once text grows.
    @ViewBuilder
    private func adaptivePair<A: View, B: View>(first: A, second: B) -> some View {
        if shouldStackPairs {
            VStack(alignment: .leading, spacing: 16) {
                first
                second
            }
        } else {
            HStack(alignment: .top, spacing: 12) {
                first.frame(maxWidth: .infinity, alignment: .leading)
                second.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func card<Content: View>(
        _ heading: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(heading)
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .cardStyle()
    }

    @ViewBuilder
    private func field<Content: View>(
        _ label: String,
        error: String?,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.muted)
                // Wraps instead of truncating at large text sizes.
                .fixedSize(horizontal: false, vertical: true)
            content()
                .accessibilityLabel(label)
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Behaviour

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
            && !organizerName.trimmingCharacters(in: .whitespaces).isEmpty
            && organizerEmail.contains("@")
            && !participantEmails.isEmpty
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        fieldErrors = [:]

        let request = CreateEventRequest(
            title: title.trimmingCharacters(in: .whitespaces),
            description: eventDescription.isEmpty ? nil : eventDescription,
            organizerEmail: organizerEmail.lowercased().trimmingCharacters(in: .whitespaces),
            organizerName: organizerName.trimmingCharacters(in: .whitespaces),
            startDate: Self.localDateString(startDate),
            endDate: Self.localDateString(endDate),
            durationMinutes: durationMinutes,
            workingHoursStart: Self.timeString(workingStart),
            workingHoursEnd: Self.timeString(workingEnd),
            timezone: TimeZone.current.identifier,
            excludeWeekends: excludeWeekends,
            participantEmails: participantEmails
        )

        do {
            let response = try await APIClient.shared.createEvent(
                request,
                idempotencyKey: idempotencyKey
            )
            // The organizer's own invitation token is a capability that no read
            // endpoint returns, so it is kept on the device to drive the
            // calendar connection step.
            OrganizerSession.shared.remember(
                eventId: response.eventId,
                inviteToken: response.organizerInviteToken
            )
            router.navigate(
                to: .event(id: response.eventId, organizerToken: response.organizerToken)
            )
        } catch let error as APIError {
            errorMessage = error.errorDescription
            // Per-field detail, so the message lands next to the offending input.
            fieldErrors = Dictionary(
                error.fieldErrors.map { ($0.field, $0.message) },
                uniquingKeysWith: { first, _ in first }
            )
        } catch {
            errorMessage = error.localizedDescription
        }

        isSubmitting = false
    }

    // MARK: Formatting

    private static func durationLabel(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) minutes" }
        if minutes == 60 { return "1 hour" }
        let hours = Double(minutes) / 60
        return hours.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(hours)) hours"
            : String(format: "%.1f hours", hours)
    }

    /// The picked day as a calendar date, with no time component.
    ///
    /// The picker carries the current time of day; sending that as an instant
    /// is what let a window shift onto the wrong day.
    private static func localDateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func timeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private static func defaultTime(hour: Int) -> Date {
        Calendar.current.date(
            bySettingHour: hour, minute: 0, second: 0, of: Date()
        ) ?? Date()
    }
}

private extension View {
    /// Shared text-field chrome, sized so the tap target is never under 44pt.
    func inputFieldStyle() -> some View {
        self
            .textFieldStyle(.plain)
            .foregroundStyle(Theme.primary)
            .padding(.vertical, 12)
            .padding(.horizontal, 12)
            .frame(minHeight: Theme.minTapTarget)
            .background(Theme.surfaceSunken)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}
