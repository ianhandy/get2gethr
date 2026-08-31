import SwiftUI

@main
struct get2gethrApp: App {
    @StateObject private var router = Router()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(router)
                // Handles both universal links from Mail, Messages, and Safari
                // and the `get2gethr://` return from the authorization session.
                .onOpenURL { url in
                    router.open(url)
                }
                .task {
                    router.restore()
                }
        }
    }
}
