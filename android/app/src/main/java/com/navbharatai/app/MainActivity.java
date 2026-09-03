package com.navbharatai.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered BEFORE super.onCreate(), which is when the bridge is built — a plugin registered
        // afterwards is not visible to the web layer.
        registerPlugin(MetaConsentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
