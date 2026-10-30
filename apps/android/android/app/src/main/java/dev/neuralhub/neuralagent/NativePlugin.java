package dev.neuralhub.neuralagent;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
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

/** The web remote's bridge to Android: FCM token, notification permission, status for widget and tile, taps. */
@CapacitorPlugin(name = "NeuralAgent", permissions = @Permission(alias = "notifications", strings = Manifest.permission.POST_NOTIFICATIONS))
public class NativePlugin extends Plugin {
    private static NativePlugin instance;
    private static JSObject pending;

    @Override
    public void load() {
        instance = this;
        if (pending != null) {
            notifyListeners("open", pending, true);
            pending = null;
        }
    }

    /** Open one agent; kept until the page listens when the app was cold-started by the tap. */
    static void open(String host, String sid) {
        JSObject o = new JSObject();
        o.put("host", host);
        o.put("sid", sid);
        if (instance != null) instance.notifyListeners("open", o, true);
        else pending = o;
    }

    static void tokenChanged(String token) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("token", token);
        instance.notifyListeners("token", o);
    }

    private boolean firebase() {
        return !FirebaseApp.getApps(getContext()).isEmpty();
    }

    private boolean allowed() {
        return Build.VERSION.SDK_INT < 33
                || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void pushState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", firebase());
        r.put("permission", allowed() ? "granted" : getPermissionState("notifications") == PermissionState.DENIED ? "denied" : "prompt");
        call.resolve(r);
    }

    /** Asks for the notification permission if needed, then returns this install's FCM token. */
    @PluginMethod
    public void pushToken(PluginCall call) {
        if (!firebase()) {
            call.reject("Push is not set up in this build.");
            return;
        }
        if (!allowed()) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        token(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (allowed()) token(call);
        else call.reject("Notifications are not allowed for NeuralAgent.");
    }

    private void token(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
            if (!t.isSuccessful() || t.getResult() == null) {
                call.reject("Could not register for push: " + (t.getException() != null ? t.getException().getMessage() : "no token"));
                return;
            }
            JSObject r = new JSObject();
            r.put("token", t.getResult());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void dropToken(PluginCall call) {
        if (firebase()) FirebaseMessaging.getInstance().deleteToken();
        call.resolve();
    }

    @PluginMethod
    public void setStatus(PluginCall call) {
        Status.save(getContext(), call.getString("computer", "NeuralAgent"), call.getInt("running", 0), call.getInt("working", 0), call.getInt("waiting", 0));
        call.resolve();
    }

    /** Asks the launcher to place the agents widget; false when it cannot. */
    @PluginMethod
    public void pinWidget(PluginCall call) {
        android.appwidget.AppWidgetManager m = android.appwidget.AppWidgetManager.getInstance(getContext());
        boolean ok = m.isRequestPinAppWidgetSupported()
                && m.requestPinAppWidget(new android.content.ComponentName(getContext(), AgentWidget.class), null, null);
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void setNames(PluginCall call) {
        Status.names(getContext(), call.getString("json", "{}"));
        call.resolve();
    }
}
