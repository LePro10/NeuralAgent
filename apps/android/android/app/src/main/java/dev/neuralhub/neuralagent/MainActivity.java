package dev.neuralhub.neuralagent;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ContentInfoCompat;
import androidx.core.view.ViewCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_CALL = "na_call";

    /** Opens the app to start (true) or end (false) a call with Neural. */
    static Intent callIntent(Context c, boolean start) {
        return new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_CALL, start ? "start" : "end");
    }

    /** Longest the splash waits for the page (a slow network); then the page's own colour shows. */
    private static final long SPLASH_MAX_MS = 6000;
    /** The page has painted its launch frame (the same picture as the splash). */
    private volatile boolean painted = false;
    private boolean handedOff = false;
    /** The splash is still on screen (it covers the page until its exit listener has run). */
    private boolean splashUp = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Launch (docs/notes/launch.md): the splash shows the web launch screen's first frame and
        // stays until the page has painted that same frame, then fades out; the page then plays the
        // motion. No blank WebView, no flash between the two.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        long start = SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> !painted && SystemClock.uptimeMillis() - start < SPLASH_MAX_MS);
        splash.setOnExitAnimationListener(view -> {
            splashUp = false;
            handOff();
            view.getView().animate().alpha(0f).setDuration(150).withEndAction(view::remove).start();
        });
        registerPlugin(NativePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            // Until the page paints, the WebView shows the launch colour, not white.
            getBridge().getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.na_launch_bg));
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageStarted(WebView view) {
                    handedOff = false;
                }

                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    painted = true;
                    // The keep condition is only checked when the content draws: make it draw now,
                    // so the splash leaves right away and its exit listener starts the motion.
                    view.postInvalidateOnAnimation();
                    // No splash left (a warm start): let the page start its motion by itself. Never
                    // while the splash is still up, or the motion would play hidden behind it.
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (!splashUp) handOff();
                    }, 400);
                }
            });
        }
        handle(getIntent());
        // Images the keyboard or a long-press Paste inserts: hand them to the page, keep the rest default.
        if (getBridge() != null && getBridge().getWebView() != null) {
            ViewCompat.setOnReceiveContentListener(getBridge().getWebView(), new String[] {"image/*"}, (view, payload) -> {
                android.util.Pair<ContentInfoCompat, ContentInfoCompat> parts =
                        payload.partition(item -> item.getUri() != null);
                ContentInfoCompat uris = parts.first;
                if (uris != null) {
                    for (int i = 0; i < uris.getClip().getItemCount(); i++) {
                        android.net.Uri u = uris.getClip().getItemAt(i).getUri();
                        NativePlugin.pasted(NativePlugin.imageOf(this, u, null));
                    }
                }
                return parts.second;
            });
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        Status.seen(this);
    }

    /** Tells the page that the splash is gone, so its launch motion can start (lib/launch.ts). */
    private void handOff() {
        if (handedOff || getBridge() == null) return;
        handedOff = true;
        getBridge().eval("window.__naSplashGone=true;window.dispatchEvent(new Event('na-splash-gone'))", null);
    }

    /**
     * During a call the app shows over the lock screen and keeps the screen on, like the phone's own
     * call screen; the page keeps listening (see CallService).
     */
    void calling(boolean on) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // After a call from the lock screen the rest of the app stays behind the lock.
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (!on && km != null && km.isKeyguardLocked()) moveTaskToBack(true);
    }

    /** A notification, the widget or a tile asked for one agent, or for a call. */
    private void handle(Intent intent) {
        if (intent == null) return;
        String call = intent.getStringExtra(EXTRA_CALL);
        if (call != null) {
            intent.removeExtra(EXTRA_CALL);
            // Show over the lock screen right away, before the page has started the call.
            if (call.equals("start")) calling(true);
            else {
                CallService.stop(this);
                calling(false);
            }
            NativePlugin.dial(call.equals("start"));
            return;
        }
        String sid = intent.getStringExtra(Status.EXTRA_SID);
        if (sid != null) NativePlugin.open(intent.getStringExtra(Status.EXTRA_HOST), sid);
    }
}
