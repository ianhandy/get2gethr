import Foundation

// MARK: - Requests

struct CreateEventRequest: Codable {
    let title: String
    let description: String?
    let organizerEmail: String
    let organizerName: String
    /// Inclusive local calendar dates, `YYYY-MM-DD`, in `timezone`.
    let startDate: String
    let endDate: String
    let durationMinutes: Int
    let workingHoursStart: String
    let workingHoursEnd: String
    let timezone: String
    let excludeWeekends: Bool
    let participantEmails: [String]
}

struct ConfirmRequest: Codable {
    let response: String  // "confirmed" or "declined"
    let slotId: String?
}

struct ManualScheduleRequest: Codable {
    let blocks: [ManualScheduleBlockRequest]
}

struct ManualScheduleBlockRequest: Codable, Equatable {
    let date: String
    let startTime: String
    let endTime: String
}

struct OrganizerActionRequest: Codable {
    let action: String
    let participantId: String?

    init(action: String, participantId: String? = nil) {
        self.action = action
        self.participantId = participantId
    }
}

// MARK: - Responses

struct CreateEventResponse: Codable {
    let eventId: String
    /// Capability for the organizer's management surface. Never emailed.
    let organizerToken: String
    /// The organizer's own invitation token, used to connect their calendar.
    let organizerInviteToken: String
}

/// Both the organizer and attendee views decode into this.
///
/// Fields the server withholds from attendees are optional, so one type serves
/// both audiences without pretending an attendee can see everything.
struct EventView: Codable {
    let event: EventSummary
    let viewer: Viewer
    let participants: [ParticipantData]?
    let others: OtherCounts?
    let currentSlot: SlotData?
    let confirmedSlot: SlotData?
    let providers: [String]?
}

struct Viewer: Codable {
    let role: String
    let id: String?
    let email: String?
    let name: String?
    let status: ParticipantStatus?
    let connection: ConnectionSummary?
    /// True when the person reviewed busy times extracted on their device.
    let manualSchedule: Bool?
}

struct OtherCounts: Codable {
    let total: Int
    let joined: Int
    let declined: Int
    let pending: Int
}

struct ConnectionSummary: Codable {
    let status: ConnectionStatus
    let provider: String
    let accountEmail: String?
    let sourceCalendarCount: Int
    let destinationCalendarId: String?
}

enum ConnectionStatus: String, Codable {
    case connected
    case relinkRequired = "relink_required"
    case revoked
}

struct EventSummary: Codable {
    let id: String
    let title: String
    let description: String?
    let organizerName: String
    let organizerEmail: String?
    let startDate: String
    let endDate: String
    let durationMinutes: Int
    let workingHoursStart: String?
    let workingHoursEnd: String?
    let timezone: String
    let excludeWeekends: Bool?
    let status: EventStatus
    let calendarWriteStatus: CalendarWriteStatus
    let calendarWriteError: String?
}

/// Mirrors the server lifecycle. `scheduling` is deliberately distinct from
/// `confirmed`: everyone agreed, but the meeting is not on a calendar yet.
enum EventStatus: String, Codable {
    case draft
    case gathering
    case proposing
    case scheduling
    case confirmed
    case actionRequired = "action_required"
    case failed
    case cancelled

    /// An unrecognised status from a newer server must not crash an older app.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = EventStatus(rawValue: raw) ?? .gathering
    }
}

enum CalendarWriteStatus: String, Codable {
    case notAttempted = "not_attempted"
    case pending
    case written
    case failed

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = CalendarWriteStatus(rawValue: raw) ?? .notAttempted
    }
}

struct ParticipantData: Codable, Identifiable {
    let id: String
    let email: String
    let name: String?
    let role: String
    let status: ParticipantStatus
    let joinedAt: Int?
    let connection: ConnectionSummary?
}

enum ParticipantStatus: String, Codable {
    case pending
    case joined
    case declined
    case removed

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ParticipantStatus(rawValue: raw) ?? .pending
    }
}

struct SlotData: Codable, Identifiable {
    let id: String
    let startTime: Int
    let endTime: Int
    let rank: Int?
    let status: String?
}

struct ActionResponse: Codable {
    let ok: Bool?
    let sent: Int?
    let error: String?
    let recorded: String?
    let slotStatus: String?
}

// MARK: - Helpers

extension SlotData {
    var startDate: Date { Date(timeIntervalSince1970: TimeInterval(startTime)) }
    var endDate: Date { Date(timeIntervalSince1970: TimeInterval(endTime)) }
}

extension EventSummary {
    /// Formats the inclusive date window in the event's own timezone.
    func formattedDateWindow() -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"

        let display = DateFormatter()
        display.timeZone = TimeZone(identifier: "UTC")
        display.dateStyle = .medium

        guard let start = parser.date(from: startDate),
              let end = parser.date(from: endDate) else {
            return "\(startDate) – \(endDate)"
        }
        if startDate == endDate { return display.string(from: start) }
        return "\(display.string(from: start)) – \(display.string(from: end))"
    }

    var resolvedTimeZone: TimeZone {
        TimeZone(identifier: timezone) ?? .current
    }

    func formattedSlot(_ slot: SlotData) -> String {
        let day = DateFormatter()
        day.timeZone = resolvedTimeZone
        day.dateFormat = "EEEE, MMMM d"

        let clock = DateFormatter()
        clock.timeZone = resolvedTimeZone
        clock.timeStyle = .short
        clock.dateStyle = .none

        return "\(day.string(from: slot.startDate)), "
            + "\(clock.string(from: slot.startDate))–\(clock.string(from: slot.endDate))"
    }
}
