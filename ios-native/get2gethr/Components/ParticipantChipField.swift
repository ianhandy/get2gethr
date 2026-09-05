import SwiftUI

struct ParticipantChipField: View {
    @Binding var emails: [String]
    @State private var currentInput = ""
    @State private var message: String?
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Type an email and press return to add it.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if !emails.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(emails, id: \.self) { email in
                        chip(for: email)
                    }
                }
                .accessibilityLabel("People invited")
            }

            HStack(spacing: 8) {
                TextField("alex@example.com", text: $currentInput)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($isFocused)
                    .onSubmit { addEmail() }
                    .onChange(of: currentInput) { _, newValue in
                        if newValue.last == "," || newValue.last == " " {
                            currentInput = String(newValue.dropLast())
                            addEmail()
                        }
                    }
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
                    .accessibilityLabel("Participant email address")

                if !currentInput.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button("Add") { addEmail() }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 14)
                        .frame(minHeight: Theme.minTapTarget)
                        .background(Theme.accentA)
                        .clipShape(Capsule())
                        .accessibilityLabel("Add this email address")
                }
            }

            // One live region announces the running count and any problem, so
            // adding an address gives feedback without moving focus.
            Text(statusText)
                .font(.caption)
                .foregroundStyle(message == nil ? Theme.muted : Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private var statusText: String {
        if let message { return message }
        if emails.isEmpty { return "No one added yet" }
        return "\(emails.count) \(emails.count == 1 ? "person" : "people") added"
    }

    @ViewBuilder
    private func chip(for email: String) -> some View {
        HStack(spacing: 2) {
            Text(email)
                .font(.subheadline)
                .foregroundStyle(Theme.primary)
                // Long addresses wrap rather than pushing the row off screen.
                .fixedSize(horizontal: false, vertical: true)

            Button {
                emails.removeAll { $0 == email }
                message = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.body)
                    .foregroundStyle(Theme.muted)
                    .minimumTapTarget()
            }
            // Naming the specific address is what makes a screen-reader list of
            // remove buttons usable.
            .accessibilityLabel("Remove \(email)")
        }
        .padding(.leading, 12)
        .padding(.vertical, 2)
        .background(Theme.accentB.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    private func addEmail() {
        let trimmed = currentInput
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !trimmed.isEmpty else { return }

        guard trimmed.contains("@"), trimmed.contains("."),
              !trimmed.hasPrefix("@"), !trimmed.hasSuffix("@") else {
            message = "\(trimmed) is not a valid email address"
            return
        }
        guard !emails.contains(trimmed) else {
            message = "\(trimmed) has already been added"
            currentInput = ""
            return
        }

        emails.append(trimmed)
        currentInput = ""
        message = nil
    }
}

/// Wraps chips onto as many lines as they need.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        layout(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(
                    x: bounds.minX + result.positions[index].x,
                    y: bounds.minY + result.positions[index].y
                ),
                proposal: ProposedViewSize(result.sizes[index])
            )
        }
    }

    private func layout(
        proposal: ProposedViewSize,
        subviews: Subviews
    ) -> (size: CGSize, positions: [CGPoint], sizes: [CGSize]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var sizes: [CGSize] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            // Constrain each chip to the available width so a long address
            // wraps inside the chip instead of overflowing the layout.
            var size = subview.sizeThatFits(
                ProposedViewSize(width: maxWidth, height: nil)
            )
            size.width = min(size.width, maxWidth)

            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            sizes.append(size)
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalHeight = y + rowHeight
        }

        return (
            CGSize(width: maxWidth == .infinity ? x : maxWidth, height: totalHeight),
            positions,
            sizes
        )
    }
}
