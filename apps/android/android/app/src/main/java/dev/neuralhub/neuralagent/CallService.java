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

    static void start(Context c) {
        Intent i = new Intent(c, CallService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, CallService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
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
        if (Build.VERSION.SDK_INT >= 30) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(ID, n);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
