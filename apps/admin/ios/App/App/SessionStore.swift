import Foundation
import Security

/// The admin session token in the Keychain (ADR 0044 §3): this device only, readable after the
/// first unlock, so "Aceitar" works from the lock screen. The API origin is no secret.
enum SessionStore {
    private static let service = "br.com.vendua.painel.session"
    private static let account = "token"
    private static let apiKey = "vendua.apiOrigin"

    static var apiOrigin: String {
        UserDefaults.standard.string(forKey: apiKey) ?? "https://painel.vendua.com.br"
    }

    static func set(token: String?, apiOrigin: String?) {
        if let apiOrigin { UserDefaults.standard.set(apiOrigin, forKey: apiKey) }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let token, let data = token.data(using: .utf8) else { return }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func token() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
            let data = out as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
