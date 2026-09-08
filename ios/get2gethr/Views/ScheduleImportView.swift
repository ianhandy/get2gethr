import PhotosUI
import SwiftUI
import UIKit

struct ScheduleImportView: View {
    let event: EventSummary
    let token: String
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var isProcessing = false
    @State private var isSaving = false
    @State private var hasReviewed = false
    @State private var blocks: [EditableBusyBlock] = []
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    init(
        event: EventSummary,
        token: String,
        initiallyReviewing: Bool = false,
        onSaved: @escaping () -> Void
    ) {
        self.event = event
        self.token = token
        self.onSaved = onSaved
        _hasReviewed = State(initialValue: initiallyReviewing)
        _blocks = State(
            initialValue: initiallyReviewing
                ? [EditableBusyBlock.defaultBlock(for: event)]
                : []
        )
        _statusMessage = State(
            initialValue: initiallyReviewing
                ? "1 busy time found. Check it and add anything missed."
                : nil
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if hasReviewed {
                        reviewContent
                    } else {
                        captureContent
                    }
                }
                .padding(20)
            }
            .background(Theme.bg.ignoresSafeArea())
            .environment(\.timeZone, event.resolvedTimeZone)
            .navigationTitle(hasReviewed ? "Review times" : "Scan a schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isProcessing || isSaving)
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    showCamera = false
                    if let image { process(image) }
                }
                .ignoresSafeArea()
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task { await loadPhoto(item) }
            }
        }
    }

    private var captureContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 38, weight: .medium))
                    .foregroundStyle(Theme.accentA)
                    .accessibilityHidden(true)
                Text("Point at a paper schedule, or choose a screenshot.")
                    .font(.system(.title2, design: .serif, weight: .bold))
                    .foregroundStyle(Theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Your iPhone reads it locally. You review every time before anything is shared.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)

            if let errorMessage {
                messageCard(errorMessage, danger: true)
            }

            if isProcessing {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Reading schedule on this iPhone…")
                        .font(.subheadline)
                        .foregroundStyle(Theme.primary)
                }
                .frame(maxWidth: .infinity, minHeight: 72)
                .cardStyle()
                .accessibilityElement(children: .combine)
            } else {
                VStack(spacing: 12) {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button {
                            showCamera = true
                        } label: {
                            actionLabel("Take a photo", systemImage: "camera.fill", filled: true)
                        }
                    }

                    PhotosPicker(selection: $photoItem, matching: .images) {
                        actionLabel(
                            "Choose a photo or screenshot",
                            systemImage: "photo.on.rectangle",
                            filled: !UIImagePickerController.isSourceTypeAvailable(.camera)
                        )
                    }

                    Button {
                        blocks = [EditableBusyBlock.defaultBlock(for: event)]
                        statusMessage = "Add the times you're busy during this invitation's date window."
                        showReview()
                    } label: {
                        Text("Enter busy times myself")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                    }
                    .foregroundStyle(Theme.accentA)
                }
            }

            Label("The photo and recognized text never leave this device.", systemImage: "lock.shield")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
        }
    }

    private var reviewContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let statusMessage {
                messageCard(statusMessage, danger: false)
            }
            if let errorMessage {
                messageCard(errorMessage, danger: true)
            }

            ForEach($blocks) { $block in
                BusyBlockEditor(
                    block: $block,
                    dateRange: event.localDateRange,
                    onDelete: { blocks.removeAll { $0.id == block.id } }
                )
            }

            Button {
                blocks.append(EditableBusyBlock.defaultBlock(for: event))
            } label: {
                Label("Add busy time", systemImage: "plus.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            }
            .foregroundStyle(Theme.accentA)

            Button {
                Task { await save() }
            } label: {
                Group {
                    if isSaving {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text(blocks.isEmpty ? "Confirm no busy time" : "Use these busy times")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
                .padding(.vertical, 6)
                .background(Theme.accentA)
                .foregroundStyle(Theme.onAccent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isSaving)

            Text("Only the dates and times you confirm are sent to finda.day. The image is discarded.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func actionLabel(
        _ title: String,
        systemImage: String,
        filled: Bool
    ) -> some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            .padding(.vertical, 6)
            .background(filled ? Theme.accentA : Theme.surface)
            .foregroundStyle(filled ? Theme.onAccent : Theme.primary)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(filled ? Color.clear : Theme.border, lineWidth: 1)
            )
    }

    private func messageCard(_ message: String, danger: Bool) -> some View {
        Text(message)
            .font(.callout)
            .foregroundStyle(danger ? Theme.danger : Theme.primary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(danger ? Theme.dangerSurface : Theme.successSurface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func loadPhoto(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data) else {
                throw ScheduleImageReaderError.unreadableImage
            }
            photoItem = nil
            process(image)
        } catch {
            photoItem = nil
            errorMessage = error.localizedDescription
        }
    }

    private func process(_ image: UIImage) {
        isProcessing = true
        errorMessage = nil
        Task {
            do {
                let text = try await ScheduleImageReader.recognizeText(in: image)
                let interpretation = await ScheduleImageReader.interpret(
                    recognizedText: text,
                    event: event
                )
                blocks = interpretation.blocks.compactMap {
                    EditableBusyBlock(parsed: $0, event: event)
                }
                if interpretation.usedAppleIntelligence {
                    statusMessage = blocks.isEmpty
                        ? "No busy times were found. Add anything missed, or confirm that you're free."
                        : "\(blocks.count) busy \(blocks.count == 1 ? "time" : "times") found. Check \(blocks.count == 1 ? "it" : "them") and add anything missed."
                } else {
                    statusMessage = "The text was read on this iPhone, but it couldn't be confidently turned into times. Add the busy times below."
                }
                showReview()
            } catch {
                errorMessage = error.localizedDescription
            }
            isProcessing = false
        }
    }

    private func showReview() {
        if reduceMotion {
            hasReviewed = true
        } else {
            withAnimation(.easeInOut(duration: 0.2)) { hasReviewed = true }
        }
    }

    private func save() async {
        errorMessage = nil
        let requests = blocks.map { $0.request(in: event.resolvedTimeZone) }
        if blocks.contains(where: { !$0.isValid }) {
            errorMessage = "Each busy time must end after it starts."
            return
        }

        isSaving = true
        defer { isSaving = false }
        do {
            _ = try await APIClient.shared.submitManualSchedule(
                token: token,
                blocks: requests
            )
            onSaved()
            dismiss()
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct BusyBlockEditor: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @Binding var block: EditableBusyBlock
    let dateRange: ClosedRange<Date>
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Busy time")
                    .font(.headline)
                    .foregroundStyle(Theme.primary)
                Spacer()
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                        .frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget)
                }
                .accessibilityLabel("Remove busy time")
            }
            if dynamicTypeSize >= .accessibility1 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Date").font(.caption).foregroundStyle(Theme.muted)
                    DatePicker(
                        "Date",
                        selection: $block.date,
                        in: dateRange,
                        displayedComponents: .date
                    )
                    .labelsHidden()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Starts").font(.caption).foregroundStyle(Theme.muted)
                    DatePicker(
                        "Starts",
                        selection: $block.startTime,
                        displayedComponents: .hourAndMinute
                    )
                    .labelsHidden()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ends").font(.caption).foregroundStyle(Theme.muted)
                    DatePicker(
                        "Ends",
                        selection: $block.endTime,
                        displayedComponents: .hourAndMinute
                    )
                    .labelsHidden()
                }
            } else {
                DatePicker(
                    "Date",
                    selection: $block.date,
                    in: dateRange,
                    displayedComponents: .date
                )
                DatePicker(
                    "Starts",
                    selection: $block.startTime,
                    displayedComponents: .hourAndMinute
                )
                DatePicker(
                    "Ends",
                    selection: $block.endTime,
                    displayedComponents: .hourAndMinute
                )
            }
        }
        .foregroundStyle(Theme.primary)
        .cardStyle()
    }
}

private struct EditableBusyBlock: Identifiable {
    let id = UUID()
    var date: Date
    var startTime: Date
    var endTime: Date

    var isValid: Bool { endTime > startTime }

    static func defaultBlock(for event: EventSummary) -> Self {
        let day = event.localDateRange.lowerBound
        let calendar = event.calendar
        let start = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
        let end = calendar.date(byAdding: .hour, value: 1, to: start) ?? start
        return Self(date: day, startTime: start, endTime: end)
    }

    init?(parsed: ParsedScheduleBlock, event: EventSummary) {
        let calendar = event.calendar
        guard let date = event.date(fromLocalDate: parsed.date),
              event.localDateRange.contains(date),
              let start = Self.time(parsed.startTime, on: date, calendar: calendar),
              let end = Self.time(parsed.endTime, on: date, calendar: calendar),
              end > start else {
            return nil
        }
        self.date = date
        self.startTime = start
        self.endTime = end
    }

    private init(date: Date, startTime: Date, endTime: Date) {
        self.date = date
        self.startTime = startTime
        self.endTime = endTime
    }

    func request(in timezone: TimeZone) -> ManualScheduleBlockRequest {
        let dateFormatter = DateFormatter()
        dateFormatter.calendar = Calendar(identifier: .gregorian)
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = timezone
        dateFormatter.dateFormat = "yyyy-MM-dd"

        let timeFormatter = DateFormatter()
        timeFormatter.calendar = Calendar(identifier: .gregorian)
        timeFormatter.locale = Locale(identifier: "en_US_POSIX")
        timeFormatter.timeZone = timezone
        timeFormatter.dateFormat = "HH:mm"

        return ManualScheduleBlockRequest(
            date: dateFormatter.string(from: date),
            startTime: timeFormatter.string(from: startTime),
            endTime: timeFormatter.string(from: endTime)
        )
    }

    private static func time(
        _ value: String,
        on date: Date,
        calendar: Calendar
    ) -> Date? {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2,
              (0...23).contains(parts[0]),
              (0...59).contains(parts[1]) else {
            return nil
        }
        return calendar.date(
            bySettingHour: parts[0],
            minute: parts[1],
            second: 0,
            of: date
        )
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    let completion: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let completion: (UIImage?) -> Void

        init(completion: @escaping (UIImage?) -> Void) {
            self.completion = completion
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            completion(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            completion(nil)
        }
    }
}

private extension EventSummary {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = resolvedTimeZone
        return calendar
    }

    var localDateRange: ClosedRange<Date> {
        let start = date(fromLocalDate: startDate) ?? Date()
        let end = date(fromLocalDate: endDate) ?? start
        return start...max(start, end)
    }

    func date(fromLocalDate value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2])
        )
    }
}
