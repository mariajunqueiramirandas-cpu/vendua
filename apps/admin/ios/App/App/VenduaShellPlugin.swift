import Capacitor
import UIKit
import UserNotifications
import WebKit

/// The app's own native side (src/platform/native/shell.ts has the contract).
@objc(VenduaShellPlugin)
public class VenduaShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VenduaShellPlugin"
    public let jsName = "VenduaShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sessionGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sessionSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushRegister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushUnregister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAlerts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    ]

    private var printing: (WKWebView, Printer)?

    override public func load() {
        OrderAlerts.shared.onOpen = { [weak self] url in
            self?.notifyListeners("alertOpened", data: ["url": url], retainUntilConsumed: true)
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        call.resolve(["version": Shell.version, "native": Shell.native])
    }

    @objc func sessionGet(_ call: CAPPluginCall) {
        if let token = SessionStore.token() {
            call.resolve(["token": token])
        } else {
            call.resolve(["token": NSNull()])
        }
    }

    @objc func sessionSet(_ call: CAPPluginCall) {
        let token = call.getString("token")
        SessionStore.set(token: token, apiOrigin: call.getString("apiOrigin"))
        if token == nil { OrderAlerts.shared.clear(prefix: "") }
        call.resolve()
    }

    @objc func pushPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: call.resolve(["state": "granted"])
            case .denied: call.resolve(["state": "denied"])
            default: call.resolve(["state": "prompt"])
            }
        }
    }

    @objc func pushRegister(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
            granted, _ in
            guard granted else { return call.reject("notifications denied", "denied") }
            PushRegistration.shared.register { token, error in
                if let token { call.resolve(["token": token]) } else {
                    call.reject(error ?? "no APNs token", "unavailable")
                }
            }
        }
    }

    @objc func pushUnregister(_ call: CAPPluginCall) {
        DispatchQueue.main.async { UIApplication.shared.unregisterForRemoteNotifications() }
        call.resolve()
    }

    @objc func clearAlerts(_ call: CAPPluginCall) {
        OrderAlerts.shared.clear(prefix: call.getString("prefix") ?? "")
        call.resolve()
    }

    @objc func setBadge(_ call: CAPPluginCall) {
        let n = max(0, call.getInt("count") ?? 0)
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(n)
        } else {
            DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = n }
        }
        call.resolve()
    }

    /// The system print dialog (AirPrint, or "Salvar em Arquivos" as PDF).
    @objc func print(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Venduá"
        let html = call.getString("html")
        DispatchQueue.main.async {
            if let html {
                let printer = Printer(title: title, call: call) { [weak self] in self?.printing = nil }
                let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 600, height: 800))
                web.navigationDelegate = printer
                // kept: a web view released before the print job reads it prints blank
                self.printing = (web, printer)
                web.loadHTMLString(html, baseURL: URL(string: SessionStore.apiOrigin))
            } else if let page = self.bridge?.webView {
                Printer.present(page.viewPrintFormatter(), title: title, call: call, then: {})
            } else {
                call.resolve(["done": false])
            }
        }
    }
}

final class Printer: NSObject, WKNavigationDelegate {
    let title: String
    let call: CAPPluginCall
    let then: () -> Void

    init(title: String, call: CAPPluginCall, then: @escaping () -> Void) {
        self.title = title
        self.call = call
        self.then = then
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Printer.present(webView.viewPrintFormatter(), title: title, call: call, then: then)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        call.resolve(["done": false])
        then()
    }

    static func present(
        _ formatter: UIPrintFormatter, title: String, call: CAPPluginCall, then: @escaping () -> Void
    ) {
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = title
        info.outputType = .general
        let pc = UIPrintInteractionController.shared
        pc.printInfo = info
        pc.printFormatter = formatter
        pc.present(animated: true) { _, completed, _ in
            call.resolve(["done": completed])
            then()
        }
    }
}

/// APNs registration: the token arrives in the AppDelegate, once per request.
final class PushRegistration {
    static let shared = PushRegistration()
    private var waiting: [(String?, String?) -> Void] = []

    func register(_ done: @escaping (String?, String?) -> Void) {
        DispatchQueue.main.async {
            self.waiting.append(done)
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func registered(_ token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        finish(hex, nil)
    }

    func failed(_ error: Error) {
        finish(nil, error.localizedDescription)
    }

    private func finish(_ token: String?, _ error: String?) {
        DispatchQueue.main.async {
            let list = self.waiting
            self.waiting = []
            list.forEach { $0(token, error) }
        }
    }
}
