import Foundation
import AuthenticationServices

actor APIClient {
    static let shared = APIClient()

    // Change this to your deployed URL in production
    #if DEBUG
    private let baseURL = "http://localhost:3000"
    #else
    private let baseURL = "https://get2gethr.vercel.app"
    #endif

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    // MARK: - Events

    func createEvent(_ request: CreateEventRequest) async throws -> CreateEventResponse {
        try await post("/api/events", body: request)
    }

    func getEvent(id: String) async throws -> EventDetailResponse {
        try await get("/api/events/\(id)")
    }

    // MARK: - Invites

    func getInvite(token: String) async throws -> InviteResponse {
        try await get("/api/invite/\(token)")
    }

    func declineInvite(token: String) async throws -> SuccessResponse {
        try await post("/api/invite/\(token)/decline", body: EmptyBody())
    }

    func confirmSlot(token: String, response: String) async throws -> SuccessResponse {
        try await post("/api/invite/\(token)/confirm", body: ConfirmRequest(response: response))
    }

    // MARK: - Google OAuth

    func googleAuthURL(token: String) -> URL {
        URL(string: "\(baseURL)/api/auth/google?token=\(token)")!
    }

    // MARK: - Networking

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error ?? "Unknown error"
            throw APIError.server(statusCode: http.statusCode, message: message)
        }
    }
}

private struct EmptyBody: Encodable {}

private struct ErrorResponse: Decodable {
    let error: String
}

enum APIError: LocalizedError {
    case invalidResponse
    case server(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid server response"
        case .server(_, let message): return message
        }
    }
}
