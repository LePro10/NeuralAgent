package dev.neuralhub.neuralagent;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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

    /** A notification, the widget or the tile asked for one agent. */
    private void handle(Intent intent) {
        if (intent == null) return;
        String sid = intent.getStringExtra(Status.EXTRA_SID);
        if (sid != null) NativePlugin.open(intent.getStringExtra(Status.EXTRA_HOST), sid);
    }
}
