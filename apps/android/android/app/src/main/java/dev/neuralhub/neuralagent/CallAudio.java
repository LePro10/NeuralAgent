package dev.neuralhub.neuralagent;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import java.util.List;

/**
 * The phone side of a call with Neural. Like a phone call: quiet at the ear (earpiece) by default,
 * loudspeaker on request; a Bluetooth or wired headset always wins. While the sound is at the ear
 * the proximity sensor turns the screen off. Other apps' audio (music, podcasts) is ducked to a
 * quiet background for the call through audio focus and comes back afterwards. The page does the
 * audio; this only picks the mode, the route and the focus.
 */
final class CallAudio {
    static final String EARPIECE = "earpiece";
    static final String SPEAKER = "speaker";

    private static AudioManager am;
    private static int oldMode = AudioManager.MODE_NORMAL;
    private static boolean oldSpeaker;
    private static boolean on;
    private static boolean scoStarted;
    private static PowerManager.WakeLock proximity;
    private static String route = EARPIECE;
    private static AudioFocusRequest focus;
    /** Another app took the sound (a phone call, another call app): the call is on hold. */
    private static boolean held;
    /**
     * A real phone call (or an alarm) takes the focus for a while: the call goes on hold (the page
     * stops listening and speaking and says so) and resumes when the focus comes back. Another app
     * taking it for good (a second call app, a video) also holds the call; a tap resumes it.
     * A short sound over ours (navigation) changes nothing.
     */
    private static final AudioManager.OnAudioFocusChangeListener FOCUS_CHANGED = change -> {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                hold(true, true);
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                hold(true, false);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hold(false, true);
                break;
            default:
        }
    };
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static Context app;
    /** A headset connected or removed during the call: route again (headsets win). */
    private static final AudioDeviceCallback DEVICES = new AudioDeviceCallback() {
        @Override
        public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
            reroute();
        }

        @Override
        public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            reroute();
        }
    };

    private CallAudio() {}

    private static android.content.SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("call", Context.MODE_PRIVATE);
    }

    /** The chosen route, kept here too so a call from the tile or lock screen starts the right way. */
    static String saved(Context c) {
        return prefs(c).getString("route", EARPIECE);
    }

    static void save(Context c, String route) {
        prefs(c).edit().putString("route", SPEAKER.equals(route) ? SPEAKER : EARPIECE).apply();
    }

    /** Idempotent: the page calls it at the tap and again once the microphone is open. */
    static synchronized String start(Context c, String wanted) {
        am = c.getApplicationContext().getSystemService(AudioManager.class);
        if (!on) {
            int mode = am.getMode();
            // The WebView may already have switched to communication mode for its microphone:
            // never "restore" that after the call (media would stay quiet and Bluetooth in call mode).
            oldMode = mode == AudioManager.MODE_IN_COMMUNICATION ? AudioManager.MODE_NORMAL : mode;
            oldSpeaker = am.isSpeakerphoneOn();
            on = true;
            held = false;
            app = c.getApplicationContext();
            requestFocus();
            am.registerAudioDeviceCallback(DEVICES, MAIN);
        }
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        return route(c, wanted);
    }

    /**
     * Transient focus that lets others duck: music keeps playing, quieter (the system lowers it;
     * apps that rather pause, like some podcast players, pause). Assistant usage, like a voice
     * assistant: a voice-communication focus can make the system mute media for a "call" instead.
     */
    @SuppressWarnings("deprecation")
    private static boolean requestFocus() {
        if (Build.VERSION.SDK_INT >= 26) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(attrs)
                    .setAcceptsDelayedFocusGain(false)
                    .setWillPauseWhenDucked(false)
                    .setOnAudioFocusChangeListener(FOCUS_CHANGED, MAIN)
                    .build();
            return am.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        return am.requestAudioFocus(FOCUS_CHANGED, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    /** The focus went (`held`) or came back. `phone`: taken for a while (it comes back by itself). */
    private static synchronized void hold(boolean hold, boolean phone) {
        if (!on || am == null || held == hold) return;
        held = hold;
        if (!hold) {
            // The phone call put its own mode and route in place: ours again.
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            reroute();
        }
        NativePlugin.callHold(hold, phone);
    }

    /** The user tapped "resume" on a held call: ask for the focus again. False while still taken. */
    static synchronized boolean resume() {
        if (!on || am == null) return false;
        if (!held) return true;
        if (!requestFocus()) return false;
        hold(false, true);
        return true;
    }

    @SuppressWarnings("deprecation")
    private static void abandonFocus() {
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus != null) am.abandonAudioFocusRequest(focus);
            focus = null;
        } else {
            am.abandonAudioFocus(FOCUS_CHANGED);
        }
    }

    /** Picks `earpiece` or `speaker` and returns where the sound goes now: earpiece, speaker or headset. */
    static synchronized String route(Context c, String wanted) {
        if (!on || am == null) return wanted;
        route = SPEAKER.equals(wanted) ? SPEAKER : EARPIECE;
        String now = apply();
        holdProximity(c, EARPIECE.equals(now));
        return now;
    }

    private static synchronized void reroute() {
        if (on && am != null && app != null) holdProximity(app, EARPIECE.equals(apply()));
    }

    private static String apply() {
        boolean speaker = SPEAKER.equals(route);
        if (Build.VERSION.SDK_INT >= 31) {
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            AudioDeviceInfo headset = null, earpiece = null, loud = null;
            for (AudioDeviceInfo d : devices) {
                switch (d.getType()) {
                    case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                    case AudioDeviceInfo.TYPE_BLE_HEADSET:
                    case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                    case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                    case AudioDeviceInfo.TYPE_USB_HEADSET:
                        if (headset == null) headset = d;
                        break;
                    case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                        earpiece = d;
                        break;
                    case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                        loud = d;
                        break;
                    default:
                }
            }
            AudioDeviceInfo pick = headset != null ? headset : speaker ? loud : earpiece != null ? earpiece : loud;
            if (pick == null) return route;
            am.setCommunicationDevice(pick);
            return headset != null ? "headset" : pick == earpiece ? EARPIECE : SPEAKER;
        }
        // Older Android: the speakerphone switch, and a Bluetooth headset through SCO.
        boolean wired = am.isWiredHeadsetOn();
        boolean bluetooth = am.isBluetoothScoAvailableOffCall() && hasBluetoothHeadset();
        if (bluetooth && !scoStarted) {
            am.startBluetoothSco();
            am.setBluetoothScoOn(true);
            scoStarted = true;
        }
        if (wired || bluetooth) {
            am.setSpeakerphoneOn(false);
            return "headset";
        }
        am.setSpeakerphoneOn(speaker);
        return speaker ? SPEAKER : EARPIECE;
    }

    @SuppressWarnings("deprecation")
    private static boolean hasBluetoothHeadset() {
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true;
        }
        return false;
    }

    private static void holdProximity(Context c, boolean atEar) {
        PowerManager pm = c.getApplicationContext().getSystemService(PowerManager.class);
        if (atEar && pm != null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            if (proximity == null) proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "neuralagent:call-ear");
            if (!proximity.isHeld()) proximity.acquire(4 * 60 * 60 * 1000L);
        } else if (proximity != null && proximity.isHeld()) {
            proximity.release();
        }
    }

    static synchronized void stop(Context c) {
        if (!on || am == null) return;
        on = false;
        held = false;
        am.unregisterAudioDeviceCallback(DEVICES);
        if (proximity != null && proximity.isHeld()) proximity.release();
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
        else {
            if (scoStarted) {
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                scoStarted = false;
            }
            am.setSpeakerphoneOn(oldSpeaker);
        }
        am.setMode(oldMode);
        abandonFocus();
        // The WebView releases its microphone a moment later and may put back the mode it saw
        // when it opened it (ours): set it right again once that has happened.
        final int mode = oldMode;
        final AudioManager m = am;
        MAIN.postDelayed(() -> {
            synchronized (CallAudio.class) {
                if (!on && m.getMode() == AudioManager.MODE_IN_COMMUNICATION) m.setMode(mode);
            }
        }, 1500);
    }
}
