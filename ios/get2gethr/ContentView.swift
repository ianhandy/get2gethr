import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var router: Router

    var body: some View {
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
