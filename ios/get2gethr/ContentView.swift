import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var router: Router

    var body: some View {
        Group {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-schedule-import-preview") {
                ScheduleImportView(
                    event: .scheduleImportPreview,
                    token: "preview",
                    initiallyReviewing: ProcessInfo.processInfo.arguments.contains(
                        "-schedule-import-review"
                    ),
                    onSaved: {}
                )
            } else {
                appNavigation
            }
            #else
            appNavigation
            #endif
        }
    }

    private var appNavigation: some View {
        NavigationStack(path: $router.path) {
            CreateEventView()
                .navigationDestination(for: DeepLink.self) { destination in
                    switch destination {
                    case .invite(let token):
                        InviteView(token: token)
                    case .confirmSlot(let token):
                        SlotConfirmView(token: token)
                    case .event(let id, let organizerToken):
                        EventDashboardView(eventId: id, organizerToken: organizerToken)
                    }
                }
        }
        .tint(Theme.accentA)
        // A link we cannot route is offered to Safari rather than dropped.
        .alert(
            "Open in Safari?",
            isPresented: Binding(
                get: { router.unhandledLink != nil },
                set: { if !$0 { router.unhandledLink = nil } }
            ),
            presenting: router.unhandledLink
        ) { url in
            Button("Open") {
                UIApplication.shared.open(url)
                router.unhandledLink = nil
            }
            Button("Cancel", role: .cancel) { router.unhandledLink = nil }
        } message: { _ in
            Text("This link doesn't open a screen in the app.")
        }
    }
}

#if DEBUG
private extension EventSummary {
    static let scheduleImportPreview = EventSummary(
        id: "preview",
        title: "Dinner planning",
        description: nil,
        organizerName: "Ian",
        organizerEmail: nil,
        startDate: "2026-09-02",
        endDate: "2026-09-06",
        durationMinutes: 60,
        workingHoursStart: "09:00",
        workingHoursEnd: "17:00",
        timezone: "America/New_York",
        excludeWeekends: false,
        status: .gathering,
        calendarWriteStatus: .notAttempted,
        calendarWriteError: nil
    )
}
#endif
