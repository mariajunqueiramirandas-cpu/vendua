package br.com.vendua.painel;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/** The app's own native side (src/platform/native/shell.ts has the contract). */
@CapacitorPlugin(
    name = "VenduaShell",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class VenduaShellPlugin extends Plugin {
    private WebView printing;

    @Override
    public void load() {
        OrderAlerts.channels(getContext());
        handle(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    /** A tapped alert: its route, kept until the app listens (a cold start). */
    private void handle(Intent intent) {
        if (intent == null) return;
        final String url = intent.getStringExtra(OrderAlerts.EXTRA_URL);
        if (url == null) return;
        final String take = intent.getStringExtra(OrderAlerts.EXTRA_TAKE);
        intent.removeExtra(OrderAlerts.EXTRA_URL);
        intent.removeExtra(OrderAlerts.EXTRA_TAKE);
        final JSObject d = new JSObject();
        d.put("url", url);
        if (take == null) {
            notifyListeners("alertOpened", d, true);
            return;
        }
        final Context app = getContext().getApplicationContext();
        new Thread(() -> {
            AlertActions.take(app, take);
            notifyListeners("alertOpened", d, true);
        }).start();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("version", BuildConfig.VERSION_NAME);
        r.put("native", BuildConfig.VENDUA_NATIVE);
        call.resolve(r);
    }

    @PluginMethod
    public void sessionGet(PluginCall call) {
        JSObject r = new JSObject();
        String t = SessionStore.token(getContext());
        r.put("token", t == null ? JSObject.NULL : t);
        call.resolve(r);
    }

    @PluginMethod
    public void sessionSet(PluginCall call) {
        String token = call.getString("token");
        SessionStore.set(getContext(), token, call.getString("apiOrigin"));
        if (token == null) OrderAlerts.clear(getContext(), "");
        call.resolve();
    }

    private boolean firebase() {
        return !FirebaseApp.getApps(getContext()).isEmpty();
    }

    @PluginMethod
    public void pushPermission(PluginCall call) {
        JSObject r = new JSObject();
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) r.put("state", "granted");
        else if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) r.put("state", "prompt");
        else r.put("state", "denied");
        call.resolve(r);
    }

    @PluginMethod
    public void pushRegister(PluginCall call) {
        if (!firebase()) {
            call.reject("this build has no Firebase project", "unsupported");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        register(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("notifications denied", "denied");
            return;
        }
        register(call);
    }

    private void register(PluginCall call) {
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.reject("notifications denied", "denied");
            return;
        }
        OrderAlerts.channels(getContext());
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener((task) -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                call.reject("no FCM token", "unavailable");
                return;
            }
            JSObject r = new JSObject();
            r.put("token", task.getResult());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void pushUnregister(PluginCall call) {
        if (firebase()) FirebaseMessaging.getInstance().deleteToken();
        call.resolve();
    }

    @PluginMethod
    public void clearAlerts(PluginCall call) {
        OrderAlerts.clear(getContext(), call.getString("prefix", ""));
        call.resolve();
    }

    // Android's launcher draws its own dot from the notifications shown
    @PluginMethod
    public void setBadge(PluginCall call) {
        call.resolve();
    }

    /** The system print dialog (any printer the phone knows, or "Salvar como PDF"). */
    @PluginMethod
    public void print(PluginCall call) {
        final String html = call.getString("html");
        final String title = call.getString("title", "Venduá");
        getActivity().runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (pm == null) {
                call.resolve(new JSObject().put("done", false));
                return;
            }
            if (html == null) {
                pm.print(title, getBridge().getWebView().createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
                call.resolve(new JSObject().put("done", true));
                return;
            }
            // kept in a field: a WebView collected before the print job reads it prints blank
            printing = new WebView(getActivity());
            printing.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    pm.print(title, view.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
                    call.resolve(new JSObject().put("done", true));
                }
            });
            printing.loadDataWithBaseURL(SessionStore.apiOrigin(getContext()), html, "text/html", "utf-8", null);
        });
    }
}
