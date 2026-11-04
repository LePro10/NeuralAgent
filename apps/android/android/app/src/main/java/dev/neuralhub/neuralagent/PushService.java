package dev.neuralhub.neuralagent;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Builds the notification from the relay's data message {t, kind, host, sid}; a tap opens that agent.
 *  Admin messages {t: admin, kind, title, body} open the admin area. */
public class PushService extends FirebaseMessagingService {
    static final String CHANNEL = "agents";
    static final String ADMIN_CHANNEL = "admin";
    static final String REPORT_CHANNEL = "reports";

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        if ("admin".equals(d.get("t"))) {
            admin(d);
            return;
        }
        if ("report".equals(d.get("t"))) {
            report(d);
            return;
        }
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

    /** The answer to the user's own problem report; a tap opens the app (Settings → Your reports). */
    private void report(Map<String, String> d) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(REPORT_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(REPORT_CHANNEL, "Report answers", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Answers to problem reports you sent");
            nm.createNotificationChannel(ch);
        }
        String id = d.get("id") != null ? d.get("id") : "";
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        NotificationCompat.Builder n = new NotificationCompat.Builder(this, REPORT_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_agent)
                .setContentTitle(d.get("title") != null ? d.get("title") : "Answer to your report")
                .setContentText(d.get("body") != null ? d.get("body") : "")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(d.get("body") != null ? d.get("body") : ""))
                .setAutoCancel(true);
        if (open != null)
            n.setContentIntent(PendingIntent.getActivity(this, ("report-" + id).hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        try {
            NotificationManagerCompat.from(this).notify(("report-" + id).hashCode(), n.build());
        } catch (SecurityException e) {
            // Notifications were turned off for the app.
        }
    }

    /** Admins only: an access request or a problem report; a tap opens the admin area in the browser. */
    private void admin(Map<String, String> d) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(ADMIN_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(ADMIN_CHANNEL, "Admin", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Access requests and problem reports (admins only)");
            nm.createNotificationChannel(ch);
        }
        String tab = "report".equals(d.get("kind")) ? "reports" : "requests";
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("https://agent.neuralhub.dev/admin/#" + tab));
        PendingIntent pi = PendingIntent.getActivity(this, tab.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder n = new NotificationCompat.Builder(this, ADMIN_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_agent)
                .setContentTitle(d.get("title") != null ? d.get("title") : "NeuralAgent admin")
                .setContentText(d.get("body") != null ? d.get("body") : "")
                .setAutoCancel(true)
                .setContentIntent(pi);
        try {
            NotificationManagerCompat.from(this).notify(("admin-" + tab).hashCode(), n.build());
        } catch (SecurityException e) {
            // Notifications were turned off for the app.
        }
    }

    @Override
    public void onNewToken(String token) {
        NativePlugin.tokenChanged(token);
    }
}
