package dev.neuralhub.neuralagent;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_CALL = "na_call";

    /** Opens the app to start (true) or end (false) a call with Neural. */
    static Intent callIntent(Context c, boolean start) {
        return new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_CALL, start ? "start" : "end");
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlugin.class);
        super.onCreate(savedInstanceState);
        handle(getIntent());
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
