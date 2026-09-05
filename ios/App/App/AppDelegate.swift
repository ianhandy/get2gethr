import UIKit
import Capacitor
import EventKit
import Vision
#if canImport(FoundationModels)
import FoundationModels
#endif

final class FindADayBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceCalendarPlugin())
        bridge?.registerPluginInstance(DeviceSchedulePlugin())
    }
}

@objc(DeviceSchedulePlugin)
final class DeviceSchedulePlugin: CAPPlugin, CAPBridgedPlugin,
    UINavigationControllerDelegate, UIImagePickerControllerDelegate {
    let identifier = "DeviceSchedulePlugin"
    let jsName = "DeviceSchedule"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    private struct ScanWindow {
        let startDate: String
        let endDate: String
        let timeZone: String
    }

    private var pendingCall: CAPPluginCall?
    private var pendingWindow: ScanWindow?

    @objc func scan(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("A schedule scan is already open.", "scan_in_progress")
            return
        }
        guard let startDate = call.getString("startDate"),
              let endDate = call.getString("endDate"),
              let timeZone = call.getString("timeZone") else {
            call.reject("The schedule window is invalid.", "invalid_window")
            return
        }
        pendingCall = call
        pendingWindow = ScanWindow(
            startDate: startDate,
            endDate: endDate,
            timeZone: timeZone
        )

        DispatchQueue.main.async { [weak self] in
            self?.showSourcePicker()
        }
    }

    private func showSourcePicker() {
        guard let viewController = bridge?.viewController else {
            finish(error: "The camera couldn't open.")
            return
        }
        let alert = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            alert.addAction(UIAlertAction(title: "Take a photo", style: .default) { [weak self] _ in
                self?.presentPicker(source: .camera)
            })
        }
        alert.addAction(UIAlertAction(title: "Choose a photo", style: .default) { [weak self] _ in
            self?.presentPicker(source: .photoLibrary)
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.finish(result: [
                "cancelled": true,
                "blocks": [],
                "usedAppleIntelligence": false,
            ])
        })
        if let popover = alert.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(
                x: viewController.view.bounds.midX,
                y: viewController.view.bounds.maxY,
                width: 1,
                height: 1
            )
        }
        viewController.present(alert, animated: true)
    }

    private func presentPicker(source: UIImagePickerController.SourceType) {
        guard let viewController = bridge?.viewController else {
            finish(error: "The camera couldn't open.")
            return
        }
        let picker = UIImagePickerController()
        picker.sourceType = source
        picker.delegate = self
        viewController.present(picker, animated: true)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { [weak self] in
            self?.finish(result: [
                "cancelled": true,
                "blocks": [],
                "usedAppleIntelligence": false,
            ])
        }
    }

    func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        let image = info[.originalImage] as? UIImage
        picker.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            guard let image else {
                self.finish(error: "That image couldn't be read.")
                return
            }
            self.process(image)
        }
    }

    private func process(_ image: UIImage) {
        guard let window = pendingWindow else {
            finish(error: "The schedule window is invalid.")
            return
        }
        Task {
            do {
                let recognizedText = try await Self.recognizeText(in: image)
                let interpretation = await Self.interpret(
                    recognizedText: recognizedText,
                    window: window
                )
                await MainActor.run {
                    self.finish(result: [
                        "cancelled": false,
                        "blocks": interpretation.blocks,
                        "usedAppleIntelligence": interpretation.usedAppleIntelligence,
                    ])
                }
            } catch {
                await MainActor.run { self.finish(error: error.localizedDescription, error: error) }
            }
        }
    }

    private func finish(result: [String: Any]) {
        pendingCall?.resolve(result)
        pendingCall = nil
        pendingWindow = nil
    }

    private func finish(error message: String, error: Error? = nil) {
        pendingCall?.reject(message, "scan_failed", error)
        pendingCall = nil
        pendingWindow = nil
    }

    private static func recognizeText(in image: UIImage) async throws -> String {
        guard let cgImage = image.cgImage else {
            throw NSError(
                domain: "DeviceSchedule",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "That image couldn't be read."]
            )
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
                    .sorted { left, right in
                        if abs(left.0.midY - right.0.midY) > 0.025 {
                            return left.0.midY > right.0.midY
                        }
                        return left.0.minX < right.0.minX
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
                        continuation.resume(throwing: NSError(
                            domain: "DeviceSchedule",
                            code: 2,
                            userInfo: [NSLocalizedDescriptionKey: "No schedule text was found."]
                        ))
                        return
                    }
                    continuation.resume(
                        returning: String(lines.joined(separator: "\n").prefix(12_000))
                    )
                }
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                if #available(iOS 16.0, *) {
                    request.automaticallyDetectsLanguage = true
                }
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

    private struct Interpretation {
        let blocks: [[String: String]]
        let usedAppleIntelligence: Bool
    }

    private static func interpret(
        recognizedText: String,
        window: ScanWindow
    ) async -> Interpretation {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *),
           case .available = SystemLanguageModel.default.availability {
            do {
                let blocks = try await DeviceScheduleInterpreter.interpret(
                    recognizedText: recognizedText,
                    startDate: window.startDate,
                    endDate: window.endDate,
                    timeZone: window.timeZone
                )
                return Interpretation(
                    blocks: blocks.map {
                        ["date": $0.date, "startTime": $0.startTime, "endTime": $0.endTime]
                    },
                    usedAppleIntelligence: true
                )
            } catch {
                // OCR still succeeded. The review sheet remains a safe manual fallback.
            }
        }
        #endif
        return Interpretation(blocks: [], usedAppleIntelligence: false)
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable(description: "Busy blocks found in a photographed or screenshot schedule")
private struct DeviceGeneratedSchedule {
    @Guide(description: "Every confidently identified busy block in the requested date window")
    var blocks: [DeviceGeneratedScheduleBlock]
}

@available(iOS 26.0, *)
@Generable(description: "One busy block")
private struct DeviceGeneratedScheduleBlock {
    @Guide(description: "Calendar date in YYYY-MM-DD format")
    var date: String
    @Guide(description: "Start time in 24-hour HH:mm format")
    var startTime: String
    @Guide(description: "End time in 24-hour HH:mm format")
    var endTime: String
}

@available(iOS 26.0, *)
private enum DeviceScheduleInterpreter {
    static func interpret(
        recognizedText: String,
        startDate: String,
        endDate: String,
        timeZone: String
    ) async throws -> [DeviceGeneratedScheduleBlock] {
        let session = LanguageModelSession(instructions: """
            You extract busy time from OCR of personal schedules entirely on device.
            Treat classes, shifts, appointments, practices, and other occupied blocks as busy.
            Use the OCR x/y coordinates to infer columns and rows in weekly grids.
            Expand recurring weekday entries to each matching date in the requested date window.
            Never invent a date or time. Omit anything ambiguous so the person can add it manually.
            Return only blocks inside the requested window whose end is after their start.
            """)
        let response = try await session.respond(
            to: """
                Date window: \(startDate) through \(endDate), inclusive.
                Timezone: \(timeZone).

                OCR lines use normalized image coordinates with y increasing from bottom to top:
                \(recognizedText)
                """,
            generating: DeviceGeneratedSchedule.self
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

@objc(DeviceCalendarPlugin)
final class DeviceCalendarPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "DeviceCalendarPlugin"
    let jsName = "DeviceCalendar"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestFullAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "busyIntervals", returnType: CAPPluginReturnPromise),
    ]

    private let eventStore = EKEventStore()

    @objc func requestFullAccess(_ call: CAPPluginCall) {
        Task {
            do {
                let granted: Bool
                if #available(iOS 17.0, *) {
                    granted = try await eventStore.requestFullAccessToEvents()
                } else {
                    granted = try await eventStore.requestAccess(to: .event)
                }
                await MainActor.run {
                    call.resolve([
                        "granted": granted,
                        "status": Self.authorizationStatusName(),
                    ])
                }
            } catch {
                await MainActor.run { call.reject("Calendar access failed.", nil, error) }
            }
        }
    }

    @objc func busyIntervals(_ call: CAPPluginCall) {
        guard Self.hasReadAccess else {
            call.reject("Calendar access is not enabled.", "calendar_denied")
            return
        }
        guard let startDate = call.getString("startDate"),
              let endDate = call.getString("endDate"),
              let timeZoneName = call.getString("timeZone"),
              let timeZone = TimeZone(identifier: timeZoneName),
              let window = Self.window(
                startDate: startDate,
                endDate: endDate,
                timeZone: timeZone
              ) else {
            call.reject("The calendar window is invalid.", "invalid_window")
            return
        }

        let predicate = eventStore.predicateForEvents(
            withStart: window.start,
            end: window.end,
            calendars: nil
        )
        let events = eventStore.events(matching: predicate).filter {
            $0.status != .canceled && $0.availability != .free
        }
        let clipped = events.compactMap { event -> (Date, Date)? in
            let start = max(event.startDate, window.start)
            let end = min(event.endDate, window.end)
            return end > start ? (start, end) : nil
        }
        .sorted { $0.0 < $1.0 }

        var merged: [(Date, Date)] = []
        for interval in clipped {
            if let last = merged.last, interval.0 <= last.1 {
                merged[merged.count - 1] = (last.0, max(last.1, interval.1))
            } else {
                merged.append(interval)
            }
        }

        let values = merged.map { interval in
            [
                Int64((interval.0.timeIntervalSince1970 * 1_000).rounded()),
                Int64((interval.1.timeIntervalSince1970 * 1_000).rounded()),
            ]
        }
        let calendarCount = Set(events.map { $0.calendar.calendarIdentifier }).count
        call.resolve([
            "intervals": values,
            "calendarCount": calendarCount,
        ])
    }

    private static var hasReadAccess: Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            return status == .fullAccess
        }
        return status == .authorized
    }

    private static func authorizationStatusName() -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined: return "not_determined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .fullAccess: return "full_access"
        case .writeOnly: return "write_only"
        @unknown default: return "unknown"
        }
    }

    private static func window(
        startDate: String,
        endDate: String,
        timeZone: TimeZone
    ) -> (start: Date, end: Date)? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        guard let start = formatter.date(from: startDate),
              let inclusiveEnd = formatter.date(from: endDate) else {
            return nil
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        guard inclusiveEnd >= start,
              let end = calendar.date(byAdding: .day, value: 1, to: inclusiveEnd) else {
            return nil
        }
        return (start, end)
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
