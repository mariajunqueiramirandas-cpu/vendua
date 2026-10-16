import UIKit
import UserNotifications

/// The app's alerts (ADR 0044 §5). Core sends them through APNs with the kitchen chime
/// (pedido-novo.caf) and a category: ORDER gets "Aceitar", which confirms the order without
/// opening the app (the lock screen included); THREAD gets "Assumir", which takes the
/// conversation and opens it. A newer alert for the same order replaces the older one
/// (apns-collapse-id), and opening the board clears them (VenduaShell.clearAlerts).
final class OrderAlerts: NSObject, UNUserNotificationCenterDelegate {
    static let shared = OrderAlerts()

    /// A tapped alert's route; held until the web app listens (a cold start).
    var onOpen: ((String) -> Void)? {
        didSet {
            if let onOpen, let url = pending {
                pending = nil
                onOpen(url)
            }
        }
    }
    private var pending: String?

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let accept = UNNotificationAction(identifier: "accept", title: "Aceitar", options: [])
        let take = UNNotificationAction(identifier: "take", title: "Assumir", options: [.foreground])
        let open = UNNotificationAction(identifier: "open", title: "Abrir", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "ORDER", actions: [accept], intentIdentifiers: []),
            UNNotificationCategory(identifier: "THREAD", actions: [take, open], intentIdentifiers: []),
        ])
    }

    private func open(_ url: String) {
        DispatchQueue.main.async {
            if let onOpen = self.onOpen { onOpen(url) } else { self.pending = url }
        }
    }

    // The app is open: its live stream already rang and shows the order, so no banner over it
    // for orders and waiting shoppers; anything else shows as usual.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let tag = notification.request.content.userInfo["tag"] as? String ?? ""
        if tag.hasPrefix("order-") || tag.hasPrefix("vendedor-") {
            done([.list])
        } else {
            done([.banner, .list, .sound])
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler done: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        let url = info["url"] as? String ?? "/admin/pedidos"
        switch response.actionIdentifier {
        case "accept":
            guard let orderId = info["orderId"] as? String else { return done() }
            let id = response.notification.request.identifier
            // iOS gives a background action about 30 s: the request times out well before
            let task = UIApplication.shared.beginBackgroundTask(expirationHandler: nil)
            AlertActions.accept(orderId: orderId) { ok in
                self.replace(id: id, ok: ok, url: url) {
                    done()
                    UIApplication.shared.endBackgroundTask(task)
                }
            }
        case "take":
            guard let threadId = info["threadId"] as? String else {
                open(url)
                return done()
            }
            // taken or not, the conversation is where the reply happens
            AlertActions.take(threadId: threadId) { _ in
                self.open(url)
                done()
            }
        case UNNotificationDismissActionIdentifier:
            done()
        default:
            open(url)
            done()
        }
    }

    /// "Pedido aceito" in place of the alert, quiet; or, when Core said no, the way to the order.
    private func replace(id: String, ok: Bool, url: String, then: @escaping () -> Void) {
        let content = UNMutableNotificationContent()
        content.title = ok ? "Pedido aceito" : "Não deu para aceitar daqui"
        content.body = ok ? "Já está em \"aceitos\". Bom trabalho!" : "Toque para abrir o pedido no app."
        content.userInfo = ["url": url, "tag": id]
        content.threadIdentifier = id
        if #available(iOS 15.0, *) { content.interruptionLevel = .passive }
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [id])
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { _ in then() }
    }

    /// Drops delivered alerts whose tag starts with `prefix` ("" = all of them).
    func clear(prefix: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            let ids = list.map(\.request).filter {
                prefix.isEmpty || $0.identifier.hasPrefix(prefix)
                    || $0.content.threadIdentifier.hasPrefix(prefix)
            }.map(\.identifier)
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }
}

/// What an alert's buttons do without the web app: the same calls the website's service worker
/// makes, with the session token and the same idempotency keys.
enum AlertActions {
    static func accept(orderId: String, done: @escaping (Bool) -> Void) {
        post(
            "/admin/v1/orders/\(escape(orderId))/transition", body: ["to": "confirmed"],
            key: "push-accept-\(orderId)", done: done)
    }

    static func take(threadId: String, done: @escaping (Bool) -> Void) {
        post(
            "/admin/v1/vendedor/threads/\(escape(threadId))/take", body: [:],
            key: "push-take-\(threadId)-\(Int(Date().timeIntervalSince1970 * 1000))", done: done)
    }

    private static func escape(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }

    private static func post(
        _ path: String, body: [String: String], key: String, done: @escaping (Bool) -> Void
    ) {
        guard let token = SessionStore.token(), let url = URL(string: SessionStore.apiOrigin + path)
        else { return done(false) }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("1", forHTTPHeaderField: "x-vendua-admin")
        req.setValue(key, forHTTPHeaderField: "idempotency-key")
        req.setValue(
            "ios/\(Shell.version)/\(Shell.native)/alert", forHTTPHeaderField: "x-vendua-client")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { _, res, _ in
            let status = (res as? HTTPURLResponse)?.statusCode ?? 0
            done((200..<300).contains(status))
        }.resume()
    }
}

/// The store build's identity (app-version.json, synced by scripts/native-version.ts).
enum Shell {
    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
    static var native: Int {
        Bundle.main.object(forInfoDictionaryKey: "VenduaNative") as? Int ?? 0
    }
}
