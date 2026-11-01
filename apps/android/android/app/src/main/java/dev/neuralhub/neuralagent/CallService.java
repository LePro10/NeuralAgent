package dev.neuralhub.neuralagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Runs while a call with Neural is on: a foreground service of type microphone, so the call keeps
 * listening when the screen locks or another app comes up. The page does the audio; this only
 * keeps it allowed and shows the ongoing call with a "Hang up" button.
 */
public class CallService extends Service {
    private static final String CHANNEL = "call";
    private static final int ID = 7;
    /** In the foreground: ending it ends the call audio too. */
    private boolean running;
    /**
     * Started with startForegroundService but onStartCommand has not run yet. Stopping the service
     * in that window (hang up a few ms after the microphone opened) would crash the app: Android
     * demands startForeground first. So a stop then only marks `stopWanted`, and onStartCommand
     * goes to the foreground and straight out again.
     */
    private static boolean starting;
    private static boolean stopWanted;

    static synchronized void start(Context c) {
        Intent i = new Intent(c, CallService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                c.startForegroundService(i);
                starting = true;
            } else c.startService(i);
            stopWanted = false;
        } catch (RuntimeException e) {
            // Android 12+: not allowed from the background. The call still runs while the app shows.
            android.util.Log.w("NeuralAgent", "call service not started: " + e);
        }
    }

    static synchronized void stop(Context c) {
        if (starting) {
            stopWanted = true;
            return;
        }
        c.stopService(new Intent(c, CallService.class));
    }

    /** onStartCommand ran: whether the call ended meanwhile. */
    private static synchronized boolean started() {
        starting = false;
        boolean stop = stopWanted;
        stopWanted = false;
        return stop;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean endedMeanwhile = started();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Calls", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("The ongoing call with Neural");
            nm.createNotificationChannel(ch);
        }
        PendingIntent hangUp = PendingIntent.getActivity(this, 8, MainActivity.callIntent(this, false),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle("Call with Neural")
                .setContentText(Status.computer(this))
                .setContentIntent(Status.openApp(this, null, null, 9))
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(0, "Hang up", hangUp)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID, n);
        } catch (RuntimeException e) {
            // Android 14: a microphone service needs the permission and the app in front. Without
            // it the call keeps going while the app shows; never crash the app over it.
            android.util.Log.w("NeuralAgent", "call service refused: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (endedMeanwhile) {
            // Hung up before the service was up: foreground was required once, now leave again.
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        CallAudio.start(this, CallAudio.saved(this));
        return START_NOT_STICKY;
    }

    /** Swiped away from recents: the page that ran the call is gone with its task. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        CallAudio.stop(this);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (running) CallAudio.stop(this);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
