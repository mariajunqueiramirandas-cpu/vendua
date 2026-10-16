package br.com.vendua.painel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The app's alerts, drawn on the phone (ADR 0044 §5): a new order rings the kitchen chime on the
 * "Pedidos novos" channel with the PWA's [180, 90, 180] vibration, and "Aceitar" confirms it
 * from the lock screen. One notification per tag, so a newer alert for the same order or
 * conversation replaces the older one; opening the board clears them (clearAlerts).
 */
final class OrderAlerts {
    static final String ORDERS = "pedidos";
    static final String WAITING = "conversas";
    static final String NOTICES = "avisos";
    static final int ID = 1;
    static final String EXTRA_URL = "vendua_url";
    static final String EXTRA_TAKE = "vendua_take";

    private OrderAlerts() {}

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel orders = new NotificationChannel(ORDERS, "Pedidos novos", NotificationManager.IMPORTANCE_HIGH);
        orders.setDescription("Toca o som de pedido novo, como o painel aberto na cozinha.");
        orders.setSound(chime(c), new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        orders.enableVibration(true);
        orders.setVibrationPattern(new long[] { 0, 180, 90, 180 });
        NotificationChannel waiting = new NotificationChannel(WAITING, "Clientes esperando", NotificationManager.IMPORTANCE_HIGH);
        waiting.setDescription("Quando um cliente no WhatsApp precisa de alguém da loja.");
        waiting.enableVibration(true);
        waiting.setVibrationPattern(new long[] { 0, 180, 90, 180 });
        NotificationChannel notices = new NotificationChannel(NOTICES, "Avisos da loja", NotificationManager.IMPORTANCE_DEFAULT);
        notices.setDescription("Pagamentos, lembretes e o resto do dia a dia.");
        nm.createNotificationChannel(orders);
        nm.createNotificationChannel(waiting);
        nm.createNotificationChannel(notices);
    }

    private static Uri chime(Context c) {
        return Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.pedido_novo);
    }

    static void show(Context c, Map<String, String> data) {
        channels(c);
        String tag = data.containsKey("tag") ? data.get("tag") : "vendua";
        String title = data.containsKey("title") ? data.get("title") : "Venduá";
        String body = data.containsKey("body") ? data.get("body") : "";
        String url = data.containsKey("url") ? data.get("url") : "/admin/pedidos";
        String orderId = data.get("orderId");
        String threadId = data.get("threadId");
        boolean order = tag.startsWith("order-");
        String channel = order ? ORDERS : threadId != null ? WAITING : NOTICES;

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_vendua)
            .setColor(ContextCompat.getColor(c, R.color.colorPrimary))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setCategory(order || threadId != null ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_STATUS)
            .setPriority(channel.equals(NOTICES) ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openApp(c, url, tag, null));
        // before Android 8 the sound and vibration belong to each notification, not a channel
        if (Build.VERSION.SDK_INT < 26 && !channel.equals(NOTICES)) {
            if (order) b.setSound(chime(c));
            b.setVibrate(new long[] { 0, 180, 90, 180 });
        }

        boolean accept = false;
        boolean open = false;
        for (JSONObject a : actions(data.get("actions"))) {
            String action = a.optString("action");
            String label = a.optString("title", action);
            if (action.equals("accept") && orderId != null) {
                b.addAction(0, cap(label), acceptIntent(c, orderId, tag, url));
                accept = true;
            } else if (action.equals("take") && threadId != null) {
                // Android 12+ lets no receiver open an activity: the app opens and takes it there
                b.addAction(0, cap(label), openApp(c, url, "take" + tag, threadId));
            } else if (action.equals("open")) {
                b.addAction(0, cap(label), openApp(c, url, tag, null));
                open = true;
            }
        }
        // the website's alert says "Aceitar" for any order alert with an id
        // a waiting shopper: "abrir" beside "assumir", as on the website
        if (threadId != null && !open) b.addAction(0, "Abrir", openApp(c, url, tag, null));
        if (order && orderId != null && !accept && data.get("actions") == null) b.addAction(0, "Aceitar", acceptIntent(c, orderId, tag, url));
        notify(c, tag, b.build());
    }

    /** While "Aceitar" is on its way: the buttons go, so a second tap can't send it twice. */
    static void accepting(Context c, String tag) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, NOTICES)
            .setSmallIcon(R.drawable.ic_stat_vendua)
            .setColor(ContextCompat.getColor(c, R.color.colorPrimary))
            .setContentTitle("Aceitando o pedido…")
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(0, 0, true);
        notify(c, tag, b.build());
    }

    static void accepted(Context c, String tag, boolean ok, String url) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, NOTICES)
            .setSmallIcon(R.drawable.ic_stat_vendua)
            .setColor(ContextCompat.getColor(c, R.color.colorPrimary))
            .setAutoCancel(true)
            .setSilent(ok)
            .setContentIntent(openApp(c, url != null ? url : "/admin/pedidos", tag, null));
        if (ok) b.setContentTitle("Pedido aceito").setContentText("Já está em \"aceitos\". Bom trabalho!").setTimeoutAfter(10 * 60_000);
        else b.setContentTitle("Não deu para aceitar daqui").setContentText("Toque para abrir o pedido no app.");
        notify(c, tag, b.build());
    }

    /** Drops this app's alerts whose tag starts with `prefix` (seeing the board clears orders). */
    static void clear(Context c, String prefix) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        for (StatusBarNotification n : nm.getActiveNotifications()) {
            String tag = n.getTag();
            if (tag != null && tag.startsWith(prefix)) nm.cancel(tag, n.getId());
        }
    }

    private static void notify(Context c, String tag, Notification n) {
        try {
            NotificationManagerCompat.from(c).notify(tag, ID, n);
        } catch (SecurityException e) {
            // notifications were turned off for the app: nothing to draw
        }
    }

    private static PendingIntent acceptIntent(Context c, String orderId, String tag, String url) {
        Intent i = new Intent(c, AlertActionReceiver.class)
            .setAction(AlertActionReceiver.ACCEPT)
            .putExtra("orderId", orderId)
            .putExtra("tag", tag)
            .putExtra("url", url);
        return PendingIntent.getBroadcast(c, ("accept" + tag).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openApp(Context c, String url, String key, String take) {
        Intent i = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_URL, url);
        if (take != null) i.putExtra(EXTRA_TAKE, take);
        return PendingIntent.getActivity(c, key.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String cap(String s) {
        return s.isEmpty() ? s : s.substring(0, 1).toUpperCase(Locale.ROOT) + s.substring(1);
    }

    private static java.util.List<JSONObject> actions(String json) {
        java.util.List<JSONObject> out = new java.util.ArrayList<>();
        if (json == null) return out;
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length() && i < 3; i++) out.add(a.getJSONObject(i));
        } catch (Exception e) {
            // a malformed list: the alert still shows, without buttons
        }
        return out;
    }
}
