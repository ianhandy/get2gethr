import Foundation

/// Base URL for the backend.
///
/// Reads `GET2GETHR_BASE_URL` from the bundle when present, so a TestFlight or
/// staging build does not need a code change.
enum AppEnvironment {
    static var baseURL: URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "GET2GETHR_BASE_URL") as? String,
           let url = URL(string: configured), !configured.isEmpty {
            return url
        }
        #if DEBUG
        return URL(string: "http://localhost:3100")!
        #else
        return URL(string: "https://finda.day")!
        #endif
    }

    /// Host used for universal links. Must match the Associated Domains entitlement.
    static var universalLinkHost: String { baseURL.host ?? "finda.day" }
}

struct FieldError: Decodable {
    let field: String
    let message: String
}

private struct ErrorBody: Decodable {
    let error: String?
    let fieldErrors: [FieldError]?
}

enum APIError: LocalizedError {
    case invalidResponse
    case offline
    /// Carries per-field detail so a form can point at the offending input.
    case server(statusCode: Int, message: String, fieldErrors: [FieldError])

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server sent something we couldn't read."
        case .offline:
            return "We couldn't reach the server. Check your connection and try again."
        case .server(_, let message, _):
            return message
        }
    }

    var fieldErrors: [FieldError] {
        if case .server(_, _, let errors) = self { return errors }
        return []
    }
}

actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession = .shared) {
        self.session = session
    }

    // MARK: Events

    func createEvent(
        _ request: CreateEventRequest,
        idempotencyKey: String
    ) async throws -> CreateEventResponse {
        try await send(
            "POST",
            path: "/api/events",
            body: request,
            headers: ["Idempotency-Key": idempotencyKey]
        )
    }

    func event(id: String, organizerToken: String) async throws -> EventView {
        try await send(
            "GET",
            path: "/api/events/\(id)",
            body: Optional<Never>.none,
            headers: ["X-Organizer-Token": organizerToken]
        )
    }

    func performOrganizerAction(
        eventId: String,
        organizerToken: String,
        action: String,
        participantId: String? = nil
    ) async throws -> ActionResponse {
        try await send(
            "POST",
            path: "/api/events/\(eventId)",
            body: OrganizerActionRequest(action: action, participantId: participantId),
            headers: ["X-Organizer-Token": organizerToken]
        )
    }

    // MARK: Invitations

    func invite(token: String) async throws -> EventView {
        try await send("GET", path: "/api/invite/\(token)", body: Optional<Never>.none)
    }

    func declineInvite(token: String) async throws -> ActionResponse {
        try await send("POST", path: "/api/invite/\(token)/decline", body: EmptyBody())
    }

    func submitManualSchedule(
        token: String,
        blocks: [ManualScheduleBlockRequest]
    ) async throws -> ActionResponse {
        try await send(
            "POST",
            path: "/api/invite/\(token)/manual-schedule",
            body: ManualScheduleRequest(blocks: blocks)
        )
    }

    func respondToSlot(
        token: String,
        response: String,
        slotId: String?
    ) async throws -> ActionResponse {
        try await send(
            "POST",
            path: "/api/invite/\(token)/confirm",
            body: ConfirmRequest(response: response, slotId: slotId)
        )
    }

    // MARK: Calendar connection

    /// The hosted, provider-neutral connection page.
    ///
    /// The same URL backs web and iOS, so there is one authorization surface to
    /// maintain and to reason about. The app opens it in an authentication
    /// session and waits for the return URL.
    nonisolated func calendarConnectURL(inviteToken: String) -> URL {
        var components = URLComponents(
            url: AppEnvironment.baseURL.appendingPathComponent("/api/calendar/connect"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "token", value: inviteToken),
            URLQueryItem(name: "client", value: "ios"),
            // Returning to the app's own scheme is what lets
            // ASWebAuthenticationSession detect completion and close itself.
            URLQueryItem(
                name: "returnTo",
                value: "\(DeepLink.scheme)://invite/\(inviteToken)"
            ),
        ]
        return components.url!
    }

    // MARK: Networking

    private struct EmptyBody: Encodable {}

    private func send<Response: Decodable, Body: Encodable>(
        _ method: String,
        path: String,
        body: Body?,
        headers: [String: String] = [:]
    ) async throws -> Response {
        var request = URLRequest(url: AppEnvironment.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.offline
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(http.statusCode) else {
            // The server always sends `{ error, fieldErrors? }`. Previously the
            // client expected a plain string and rendered "Unknown error"
            // whenever validation returned an array.
            let parsed = try? decoder.decode(ErrorBody.self, from: data)
            throw APIError.server(
                statusCode: http.statusCode,
                message: parsed?.error ?? Self.fallbackMessage(for: http.statusCode),
                fieldErrors: parsed?.fieldErrors ?? []
            )
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    private static func fallbackMessage(for status: Int) -> String {
        switch status {
        case 401, 403: return "You don't have access to that."
        case 404: return "We couldn't find that."
        case 409: return "That's already been done."
        case 429: return "Too many attempts. Please wait a moment and try again."
        case 500...599: return "The server had a problem. Please try again."
        default: return "That request didn't work."
        }
    }
}
