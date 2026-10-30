package dev.neuralhub.neuralagent;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Builds the notification from the relay's data message {t, kind, host, sid}; a tap opens that agent. */
public class PushService extends FirebaseMessagingService {
    static final String CHANNEL = "agents";

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        if (!"attention".equals(d.get("t"))) return;
        String kind = d.get("kind"), host = d.get("host"), sid = d.get("sid");
        if (sid == null) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Agents", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("An agent finished, failed or needs your input");
            nm.createNotificationChannel(ch);
        }
        String body = "waiting".equals(kind) ? "Needs your input" : "error".equals(kind) ? "Stopped with an error" : "Finished";
        NotificationCompat.Builder n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_agent)
                .setContentTitle(Status.name(this, sid))
                .setContentText(body)
                .setSubText(Status.computer(this))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory("waiting".equals(kind) ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_STATUS)
                .setAutoCancel(true)
                .setContentIntent(Status.openApp(this, host, sid, sid.hashCode()));
        if ("waiting".equals(kind) || "error".equals(kind)) Status.attention(this);
        try {
            NotificationManagerCompat.from(this).notify(sid.hashCode(), n.build());
        } catch (SecurityException e) {
            // Notifications were turned off for the app.
        }
    }

    @Override
    public void onNewToken(String token) {
        NativePlugin.tokenChanged(token);
    }
}
