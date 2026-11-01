package dev.neuralhub.neuralagent;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
    private static Boolean pendingDial;

    @Override
    public void load() {
        instance = this;
        if (pending != null) {
            notifyListeners("open", pending, true);
            pending = null;
        }
        if (pendingDial != null) {
            dial(pendingDial);
            pendingDial = null;
        }
    }

    /** The "Call Neural" tile or the call notification: start or end a call in the page. */
    static void dial(boolean start) {
        if (instance == null) {
            pendingDial = start;
            return;
        }
        JSObject o = new JSObject();
        o.put("start", start);
        instance.notifyListeners("dial", o, true);
    }

    /**
     * The call lost the sound to another app (`held`: a phone call when `phone`, else an app that
     * keeps it) or got it back. Not kept for a later page: a stale hold must not pause a new call.
     */
    static void callHold(boolean held, boolean phone) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("held", held);
        o.put("phone", phone);
        instance.notifyListeners("callHold", o, false);
    }

    /** A tap on a held call: take the sound back. `resumed` false while another app still has it. */
    @PluginMethod
    public void callResume(PluginCall call) {
        JSObject r = new JSObject();
        r.put("resumed", CallAudio.resume());
        call.resolve(r);
    }

    /**
     * The page started or ended a call. Sent at the tap (call audio mode, other apps ducked, route)
     * and again once the microphone is open: only then may the microphone foreground service
     * start (Android 14 refuses it without the permission), which keeps the call listening with
     * the screen locked.
     */
    @PluginMethod
    public void callActive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        JSObject r = new JSObject();
        if (on) {
            if (call.getString("route") != null) CallAudio.save(getContext(), call.getString("route"));
            r.put("output", CallAudio.start(getContext(), CallAudio.saved(getContext())));
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                CallService.start(getContext());
            }
        } else {
            CallService.stop(getContext());
            CallAudio.stop(getContext());
        }
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).calling(on));
        call.resolve(r);
    }

    private static final int MAX_IMAGE = 12 * 1024 * 1024;

    /** An image behind a content URI (clipboard, keyboard insert) as base64, or null. */
    static JSObject imageOf(Context c, Uri uri, String hint) {
        try {
            if (!"content".equals(uri.getScheme())) return null; // never a file:// path into our own data
            String type = c.getContentResolver().getType(uri);
            if (type == null) type = hint;
            if (type == null || !type.startsWith("image/")) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getContentResolver().openInputStream(uri)) {
                if (in == null) return null;
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_IMAGE) return null;
                }
            }
            JSObject r = new JSObject();
            r.put("type", type);
            r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            return r;
        } catch (Exception e) {
            return null;
        }
    }

    /** The image on the system clipboard (WebViews cannot read it), or {} when there is none. */
    @PluginMethod
    public void readClipboardImage(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject r = null;
            try {
                ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = cm == null ? null : cm.getPrimaryClip();
                for (int i = 0; clip != null && r == null && i < clip.getItemCount(); i++) {
                    Uri uri = clip.getItemAt(i).getUri();
                    String hint = clip.getDescription().getMimeTypeCount() > 0 ? clip.getDescription().getMimeType(0) : null;
                    if (uri != null) r = imageOf(getContext(), uri, hint);
                }
            } catch (Exception ignored) {
            }
            call.resolve(r == null ? new JSObject() : r);
        });
    }

    /**
     * A file from the computer (Files, D67) handed to another app: written to the cache, offered as
     * "open with" (view) and "share" (send) in one chooser. Old copies go after an hour.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String data = call.getString("data");
        String type = call.getString("type", "application/octet-stream");
        String name = call.getString("name", "file");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            java.io.File dir = new java.io.File(getContext().getCacheDir(), "shared");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("no cache folder");
            java.io.File[] old = dir.listFiles();
            long now = System.currentTimeMillis();
            if (old != null) for (java.io.File f : old) if (now - f.lastModified() > 3_600_000L) f.delete();
            String safe = name.replace('/', '_').replace('\\', '_').replace('\0', '_');
            if (safe.isEmpty() || safe.startsWith(".")) safe = "file" + safe;
            java.io.File out = new java.io.File(dir, safe);
            try (java.io.FileOutputStream os = new java.io.FileOutputStream(out)) {
                os.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
            android.content.Intent view = new android.content.Intent(android.content.Intent.ACTION_VIEW)
                .setDataAndType(uri, type)
                .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            android.content.Intent send = new android.content.Intent(android.content.Intent.ACTION_SEND)
                .setType(type)
                .putExtra(android.content.Intent.EXTRA_STREAM, uri)
                .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(safe, uri));
            android.content.Intent chooser = android.content.Intent.createChooser(send, safe);
            chooser.putExtra(android.content.Intent.EXTRA_INITIAL_INTENTS, new android.content.Intent[] { view });
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not share the file" : e.getMessage());
        }
    }

    /** Text onto the system clipboard (the WebView may refuse navigator.clipboard.writeText). */
    @PluginMethod
    public void copyText(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("No text");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null) {
                    call.reject("No clipboard");
                    return;
                }
                cm.setPrimaryClip(ClipData.newPlainText("Terminal", text));
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    /** An image the keyboard inserted (Gboard clipboard chip, stickers, GIFs) into the page. */
    static void pasted(JSObject image) {
        if (instance != null && image != null) instance.notifyListeners("paste", image, true);
    }

    /** Earpiece (quiet, at the ear) or speaker; resolves with where the sound goes now. */
    @PluginMethod
    public void callRoute(PluginCall call) {
        CallAudio.save(getContext(), call.getString("route", CallAudio.EARPIECE));
        JSObject r = new JSObject();
        r.put("output", CallAudio.route(getContext(), CallAudio.saved(getContext())));
        call.resolve(r);
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

    /**
     * The app's appearance ("system", "light" or "dark"), so the next start's splash already has
     * the right colours (Android 13+ remembers it; older versions follow the phone's setting).
     */
    @PluginMethod
    public void launchTheme(PluginCall call) {
        String a = call.getString("appearance", "system");
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null) {
            int theme = "light".equals(a) ? R.style.AppTheme_Launch_Light : "dark".equals(a) ? R.style.AppTheme_Launch_Dark : R.style.AppTheme_NoActionBarLaunch;
            getActivity().getSplashScreen().setSplashScreenTheme(theme);
        }
        call.resolve();
    }
}
