package dev.neuralhub.neuralagent;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;
import java.util.List;

/**
 * Where a call with Neural is heard. Like a phone call: quiet at the ear (earpiece) by default,
 * loudspeaker on request. A Bluetooth or wired headset always wins. While the sound is at the ear
 * the proximity sensor turns the screen off. The page does the audio; this only picks the route.
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

    static synchronized String start(Context c, String wanted) {
        am = c.getApplicationContext().getSystemService(AudioManager.class);
        if (!on) {
            oldMode = am.getMode();
            oldSpeaker = am.isSpeakerphoneOn();
            on = true;
        }
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        return route(c, wanted);
    }

    /** Picks `earpiece` or `speaker` and returns where the sound goes now: earpiece, speaker or headset. */
    static synchronized String route(Context c, String wanted) {
        if (!on || am == null) return wanted;
        route = SPEAKER.equals(wanted) ? SPEAKER : EARPIECE;
        String now = apply();
        holdProximity(c, EARPIECE.equals(now));
        return now;
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
    }
}
