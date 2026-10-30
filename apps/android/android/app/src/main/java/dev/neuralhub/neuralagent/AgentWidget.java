package dev.neuralhub.neuralagent;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.text.format.DateUtils;
import android.widget.RemoteViews;

/** Home-screen widget: the computer, what its agents were doing when last seen, tap to open. */
public class AgentWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        update(c, m, ids);
    }

    static void update(Context c, AppWidgetManager m, int[] ids) {
        long at = Status.prefs(c).getLong("at", 0);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_agents);
            v.setTextViewText(R.id.widget_computer, Status.computer(c));
            v.setTextViewText(R.id.widget_summary, Status.summary(c));
            v.setTextViewText(R.id.widget_seen, at == 0 ? "" : "Updated " + DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS));
            v.setOnClickPendingIntent(R.id.widget_root, Status.openApp(c, null, null, 2));
            m.updateAppWidget(id, v);
        }
    }
}
