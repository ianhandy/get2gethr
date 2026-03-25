import Foundation

// MARK: - API Request Types

struct CreateEventRequest: Codable {
    let title: String
    let description: String?
    let initiatorEmail: String
    let initiatorName: String
    let dateRangeStart: Int
    let dateRangeEnd: Int
    let durationMinutes: Int
    let workingHoursStart: String
    let workingHoursEnd: String
    let timezone: String
    let excludeWeekends: Bool
    let participantEmails: [String]
}

struct ConfirmRequest: Codable {
    let response: String  // "confirmed" or "declined"
}

// MARK: - API Response Types

struct CreateEventResponse: Codable {
    let eventId: String
}

struct EventDetailResponse: Codable {
    let event: EventData
    let participants: [ParticipantData]
    let currentSlot: SlotData?
}

struct InviteResponse: Codable {
    let participant: ParticipantInfo
    let event: EventSummary
}

struct SuccessResponse: Codable {
    let success: Bool
}

// MARK: - Data Models

struct EventData: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let initiatorEmail: String
    let initiatorName: String
    let dateRangeStart: Int
    let dateRangeEnd: Int
    let durationMinutes: Int
    let timezone: String
    let status: EventStatus
    let createdAt: Int
}

enum EventStatus: String, Codable {
    case gathering
    case proposing
    case confirmed
    case failed
}

struct ParticipantData: Codable, Identifiable {
    let id: String
    let email: String
    let name: String?
    let status: ParticipantStatus
    let joinedAt: Int?
}

enum ParticipantStatus: String, Codable {
    case pending
    case joined
    case declined
}

struct SlotData: Codable, Identifiable {
    let id: String
    let startTime: Int
    let endTime: Int
    let slotIndex: Int
}

struct ParticipantInfo: Codable {
    let id: String
    let email: String
    let name: String?
    let status: ParticipantStatus
}

struct EventSummary: Codable {
    let id: String
    let title: String
    let description: String?
    let initiatorName: String
    let initiatorEmail: String
    let dateRangeStart: Int
    let dateRangeEnd: Int
    let durationMinutes: Int
    let timezone: String
    let status: EventStatus
}

// MARK: - Helpers

extension EventData {
    var dateRangeStartDate: Date { Date(timeIntervalSince1970: TimeInterval(dateRangeStart)) }
    var dateRangeEndDate: Date { Date(timeIntervalSince1970: TimeInterval(dateRangeEnd)) }
    var createdAtDate: Date { Date(timeIntervalSince1970: TimeInterval(createdAt)) }
}

extension SlotData {
    var startDate: Date { Date(timeIntervalSince1970: TimeInterval(startTime)) }
    var endDate: Date { Date(timeIntervalSince1970: TimeInterval(endTime)) }
}

extension EventSummary {
    var dateRangeStartDate: Date { Date(timeIntervalSince1970: TimeInterval(dateRangeStart)) }
    var dateRangeEndDate: Date { Date(timeIntervalSince1970: TimeInterval(dateRangeEnd)) }
}
