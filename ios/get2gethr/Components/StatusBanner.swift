import SwiftUI

/// Plain-language state, including the distinction the audit called for:
/// "everyone agreed" is not the same as "it is on a calendar".
struct StatusBanner: View {
    let status: EventStatus
    let calendarWriteStatus: CalendarWriteStatus

    init(status: EventStatus, calendarWriteStatus: CalendarWriteStatus = .notAttempted) {
        self.status = status
        self.calendarWriteStatus = calendarWriteStatus
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: iconName)
                .font(.body)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(headline)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            }
            // Wraps at any text size rather than truncating.
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(headline). \(detail)")
    }

    private var iconName: String {
        switch status {
        case .draft: return "calendar.badge.plus"
        case .gathering: return "person.2"
        case .proposing: return "clock"
        case .scheduling: return "arrow.triangle.2.circlepath"
        case .confirmed: return "checkmark.circle"
        case .actionRequired: return "exclamationmark.triangle"
        case .failed: return "xmark.circle"
        case .cancelled: return "slash.circle"
        }
    }

    private var headline: String {
        switch status {
        case .draft: return "Connect your calendar"
        case .gathering: return "Waiting on responses"
        case .proposing: return "Waiting on a decision"
        case .scheduling: return "Adding to the calendar"
        case .confirmed: return "Confirmed"
        case .actionRequired: return "Needs your attention"
        case .failed: return "No time worked"
        case .cancelled: return "Cancelled"
        }
    }

    private var detail: String {
        switch status {
        case .draft:
            return "Invitations go out once your own availability is included."
        case .gathering:
            return "We'll propose a time once everyone has connected or declined."
        case .proposing:
            return "A time has been proposed and we're collecting answers."
        case .scheduling:
            return "Everyone agreed. We're writing the meeting now."
        case .confirmed:
            return "The meeting is on the calendar and invitations have been sent."
        case .actionRequired:
            return calendarWriteStatus == .failed
                ? "The time is agreed, but we couldn't add it to a calendar."
                : "Something needs a decision before this can finish."
        case .failed:
            return "We couldn't find a slot everyone was free for."
        case .cancelled:
            return "This event was called off."
        }
    }

    private var backgroundColor: Color {
        switch status {
        case .confirmed: return Theme.successSurface
        case .failed, .cancelled: return Theme.dangerSurface
        case .actionRequired: return Theme.warningSurface
        default: return Theme.surfaceSunken
        }
    }
}
