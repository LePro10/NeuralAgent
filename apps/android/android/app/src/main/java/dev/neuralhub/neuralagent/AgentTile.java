package dev.neuralhub.neuralagent;

import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick-settings tile: shows what the agents are doing; a tap opens the app. */
public class AgentTile extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        t.setLabel("Agents");
        if (Build.VERSION.SDK_INT >= 29) t.setSubtitle(Status.summary(this));
        t.setState(Status.prefs(this).getBoolean("attention", false) || Status.prefs(this).getInt("waiting", 0) > 0 ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.updateTile();
    }

    @Override
    public void onClick() {
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(Status.openApp(this, null, null, 1));
        else startActivityAndCollapse(new android.content.Intent(this, MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
