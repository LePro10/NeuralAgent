package dev.neuralhub.neuralagent;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.service.quicksettings.TileService;
import org.json.JSONObject;

/**
 * What the app last knew about the agents, for the widget, the tile and notification titles.
 * The web remote writes it while it is open; a push only marks "needs you". Nothing here is
 * secret: counts, the computer's name and agent titles.
 */
final class Status {
    static final String EXTRA_HOST = "na_host";
    static final String EXTRA_SID = "na_sid";
    private static final String PREFS = "neuralagent";

    private Status() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context c, String computer, int running, int working, int waiting) {
        prefs(c).edit()
                .putString("computer", computer)
                .putInt("running", running)
                .putInt("working", working)
                .putInt("waiting", waiting)
                .putLong("at", System.currentTimeMillis())
                .putBoolean("attention", false)
                .apply();
        refresh(c);
    }

    static void attention(Context c) {
        prefs(c).edit().putBoolean("attention", true).apply();
        refresh(c);
    }

    /** The app was opened: whatever needed attention has been seen. */
    static void seen(Context c) {
        if (!prefs(c).getBoolean("attention", false)) return;
        prefs(c).edit().putBoolean("attention", false).apply();
        refresh(c);
    }

    static void names(Context c, String json) {
        prefs(c).edit().putString("names", json).apply();
    }

    static String name(Context c, String sid) {
        try {
            String n = new JSONObject(prefs(c).getString("names", "{}")).optString(sid, "");
            return n.isEmpty() ? "Agent" : n;
        } catch (Exception e) {
            return "Agent";
        }
    }

    /** "2 running · 1 waiting", or a hint when nothing is known yet. */
    static String summary(Context c) {
        SharedPreferences p = prefs(c);
        if (p.getLong("at", 0) == 0) return "Open the app to connect";
        int running = p.getInt("running", 0), waiting = p.getInt("waiting", 0);
        if (p.getBoolean("attention", false)) return "An agent needs you";
        if (running == 0) return "No agents running";
        return running + " running" + (waiting > 0 ? " · " + waiting + " waiting" : "");
    }

    static String computer(Context c) {
        return prefs(c).getString("computer", "NeuralAgent");
    }

    static PendingIntent openApp(Context c, String host, String sid, int code) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (sid != null) i.putExtra(EXTRA_HOST, host).putExtra(EXTRA_SID, sid);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, AgentWidget.class));
        if (ids.length > 0) AgentWidget.update(c, m, ids);
        TileService.requestListeningState(c, new ComponentName(c, AgentTile.class));
    }
}
