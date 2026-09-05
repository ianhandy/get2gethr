import Foundation
import UIKit
import Vision
#if canImport(FoundationModels)
import FoundationModels
#endif

enum ScheduleImageReaderError: LocalizedError {
    case unreadableImage
    case noText

    var errorDescription: String? {
        switch self {
        case .unreadableImage:
            return "That image couldn't be read. Try a clearer photo or screenshot."
        case .noText:
            return "No schedule text was found. Try a clearer image or enter times yourself."
        }
    }
}

struct ParsedScheduleBlock: Sendable {
    let date: String
    let startTime: String
    let endTime: String
}

struct ScheduleInterpretation: Sendable {
    let blocks: [ParsedScheduleBlock]
    let usedAppleIntelligence: Bool
}

/// Reads visible text and approximate geometry without retaining or uploading the image.
enum ScheduleImageReader {
    static func recognizeText(in image: UIImage) async throws -> String {
        guard let cgImage = image.cgImage else {
            throw ScheduleImageReaderError.unreadableImage
        }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let request = VNRecognizeTextRequest { request, error in
                    if let error {
                        continuation.resume(throwing: error)
                        return
                    }
                    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
                    let lines = observations.compactMap { observation -> (CGRect, String)? in
                        guard let text = observation.topCandidates(1).first?.string else {
                            return nil
                        }
                        return (observation.boundingBox, text)
                    }
                    .sorted { lhs, rhs in
                        if abs(lhs.0.midY - rhs.0.midY) > 0.025 {
                            return lhs.0.midY > rhs.0.midY
                        }
                        return lhs.0.minX < rhs.0.minX
                    }
                    .map { box, text in
                        String(
                            format: "x=%.3f y=%.3f w=%.3f h=%.3f | %@",
                            box.minX,
                            box.minY,
                            box.width,
                            box.height,
                            text
                        )
                    }

                    guard !lines.isEmpty else {
                        continuation.resume(throwing: ScheduleImageReaderError.noText)
                        return
                    }
                    // Foundation Models has a bounded context. Geometry plus the first
                    // 12k characters preserves useful grid structure without overrunning it.
                    continuation.resume(returning: String(lines.joined(separator: "\n").prefix(12_000)))
                }
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                request.automaticallyDetectsLanguage = true

                do {
                    try VNImageRequestHandler(
                        cgImage: cgImage,
                        orientation: orientation
                    ).perform([request])
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    static func interpret(
        recognizedText: String,
        event: EventSummary
    ) async -> ScheduleInterpretation {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *),
           case .available = SystemLanguageModel.default.availability {
            do {
                let blocks = try await AppleScheduleInterpreter.interpret(
                    recognizedText: recognizedText,
                    event: event
                )
                return ScheduleInterpretation(
                    blocks: blocks.map {
                        ParsedScheduleBlock(
                            date: $0.date,
                            startTime: $0.startTime,
                            endTime: $0.endTime
                        )
                    },
                    usedAppleIntelligence: true
                )
            } catch {
                // OCR still succeeded. The editable review screen is the local,
                // deterministic fallback and never sends text anywhere else.
            }
        }
        #endif
        return ScheduleInterpretation(blocks: [], usedAppleIntelligence: false)
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable(description: "Busy blocks found in a photographed or screenshot schedule")
private struct GeneratedSchedule {
    @Guide(description: "Every confidently identified busy block in the requested date window")
    var blocks: [GeneratedScheduleBlock]
}

@available(iOS 26.0, *)
@Generable(description: "One busy block")
private struct GeneratedScheduleBlock {
    @Guide(description: "Calendar date in YYYY-MM-DD format")
    var date: String

    @Guide(description: "Start time in 24-hour HH:mm format")
    var startTime: String

    @Guide(description: "End time in 24-hour HH:mm format")
    var endTime: String
}

@available(iOS 26.0, *)
private enum AppleScheduleInterpreter {
    static func interpret(
        recognizedText: String,
        event: EventSummary
    ) async throws -> [GeneratedScheduleBlock] {
        let session = LanguageModelSession(instructions: """
            You extract busy time from OCR of personal schedules entirely on device.
            Treat classes, work shifts, appointments, practices, and other occupied blocks as busy.
            Use the OCR x/y coordinates to infer columns and rows in weekly grids.
            Expand recurring weekday entries to each matching date in the requested date window.
            Never invent a date or time. Omit anything ambiguous so the person can add it manually.
            Return only blocks whose date is inside the requested window and whose end is after its start.
            """)
        let prompt = """
            Date window: \(event.startDate) through \(event.endDate), inclusive.
            Timezone: \(event.timezone).

            OCR lines use normalized image coordinates with y increasing from bottom to top:
            \(recognizedText)
            """
        let response = try await session.respond(
            to: prompt,
            generating: GeneratedSchedule.self
        )
        return response.content.blocks
    }
}
#endif

private extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
