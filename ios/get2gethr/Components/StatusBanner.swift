import SwiftUI

struct StatusBanner: View {
    let status: EventStatus

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: iconName)
                .font(.subheadline)
            Text(message)
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .foregroundStyle(foregroundColor)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var iconName: String {
        switch status {
        case .gathering: return "person.2.circle"
        case .proposing: return "clock.circle"
        case .confirmed: return "checkmark.circle"
        case .failed: return "xmark.circle"
        }
    }

    private var message: String {
        switch status {
        case .gathering: return "Waiting for participants to connect calendars"
        case .proposing: return "A time has been proposed — waiting for confirmations"
        case .confirmed: return "Meeting time confirmed!"
        case .failed: return "Could not find a time that works for everyone"
        }
    }

    private var foregroundColor: Color {
        switch status {
        case .gathering: return Color(hex: "1E40AF")
        case .proposing: return Color(hex: "6B21A8")
        case .confirmed: return Color(hex: "166534")
        case .failed: return Color(hex: "991B1B")
        }
    }

    private var backgroundColor: Color {
        switch status {
        case .gathering: return Color(hex: "DBEAFE")
        case .proposing: return Color(hex: "F3E8FF")
        case .confirmed: return Color(hex: "DCFCE7")
        case .failed: return Color(hex: "FEE2E2")
        }
    }
}
