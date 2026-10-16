package br.com.vendua.painel;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Core sends data-only FCM messages (packages/core/src/admin/nativepush.ts), so this draws every
 * alert itself, app open or not: the "Pedidos novos" channel's chime and "Aceitar".
 */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if (message.getData().isEmpty()) return;
        OrderAlerts.show(this, message.getData());
    }

    // a rotated token is sent to Core by the app on its next start (platform/native/push.ts)
    @Override
    public void onNewToken(@NonNull String token) {}
}
