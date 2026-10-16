package br.com.vendua.painel;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Aceitar" from the notification shade or the lock screen, without opening the app. */
public class AlertActionReceiver extends BroadcastReceiver {
    static final String ACCEPT = "br.com.vendua.painel.ACCEPT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACCEPT.equals(intent.getAction())) return;
        final String orderId = intent.getStringExtra("orderId");
        final String tag = intent.getStringExtra("tag");
        final String url = intent.getStringExtra("url");
        if (orderId == null || tag == null) return;
        final Context app = context.getApplicationContext();
        OrderAlerts.accepting(app, tag);
        final PendingResult done = goAsync();
        new Thread(() -> {
            try {
                OrderAlerts.accepted(app, tag, AlertActions.accept(app, orderId), url);
            } finally {
                done.finish();
            }
        }).start();
    }
}
