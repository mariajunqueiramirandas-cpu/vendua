package br.com.vendua.painel;

import android.content.Context;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * What an alert's buttons do without opening the app (ADR 0044 §5): the same calls the website's
 * service worker makes, with the session token and the same idempotency keys.
 */
final class AlertActions {
    private AlertActions() {}

    /** "Aceitar": the order to confirmed. True when Core took it (or already had). */
    static boolean accept(Context c, String orderId) {
        int s = post(c, "/admin/v1/orders/" + enc(orderId) + "/transition", "{\"to\":\"confirmed\"}", "push-accept-" + orderId);
        return s >= 200 && s < 300;
    }

    /** "Assumir": the conversation leaves Duá for the person who tapped it. */
    static void take(Context c, String threadId) {
        post(c, "/admin/v1/vendedor/threads/" + enc(threadId) + "/take", "{}", "push-take-" + threadId + "-" + System.currentTimeMillis());
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private static int post(Context c, String path, String body, String key) {
        String token = SessionStore.token(c);
        if (token == null) return 401;
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(SessionStore.apiOrigin(c) + path).openConnection();
            h.setRequestMethod("POST");
            // a BroadcastReceiver has 10 s in all
            h.setConnectTimeout(4000);
            h.setReadTimeout(4000);
            h.setDoOutput(true);
            h.setRequestProperty("authorization", "Bearer " + token);
            h.setRequestProperty("content-type", "application/json");
            h.setRequestProperty("x-vendua-admin", "1");
            h.setRequestProperty("idempotency-key", key);
            h.setRequestProperty("x-vendua-client", "android/" + BuildConfig.VERSION_NAME + "/" + BuildConfig.VENDUA_NATIVE + "/alert");
            try (OutputStream o = h.getOutputStream()) {
                o.write(body.getBytes(StandardCharsets.UTF_8));
            }
            return h.getResponseCode();
        } catch (Exception e) {
            return 0;
        } finally {
            if (h != null) h.disconnect();
        }
    }
}
