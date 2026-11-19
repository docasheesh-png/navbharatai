package com.navbharatai.app;

import android.os.Bundle;
import android.os.StrictMode;
import android.os.Trace;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Debug diagnostics only. Never kill the process or change release collection policy.
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder()
                    .detectAll().penaltyLog().build());
            StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder()
                    .detectAll().penaltyLog().build());
        }
        // Registered BEFORE super.onCreate(), which is when the bridge is built — a plugin registered
        // afterwards is not visible to the web layer.
        registerPlugin(MetaConsentPlugin.class);
        registerPlugin(PlayBillingPlugin.class);
        registerPlugin(DeviceIntegrityPlugin.class);
        if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.onCreate");
        try {
            super.onCreate(savedInstanceState);
        } finally {
            if (BuildConfig.DEBUG) Trace.endSection();
        }
    }

    @Override
    public void onStart() {
        if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.onStart");
        try {
            super.onStart();
        } finally {
            if (BuildConfig.DEBUG) Trace.endSection();
        }
    }

    @Override
    public void onResume() {
        if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.onResume");
        try {
            super.onResume();
        } finally {
            if (BuildConfig.DEBUG) Trace.endSection();
        }
    }

    @Override
    public void onPause() {
        if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.onPause");
        try {
            super.onPause();
        } finally {
            if (BuildConfig.DEBUG) Trace.endSection();
        }
    }

    @Override
    public void onStop() {
        if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.onStop");
        try {
            super.onStop();
        } finally {
            if (BuildConfig.DEBUG) Trace.endSection();
        }
    }

    @Override
    public void onDestroy() {
        if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.onDestroy");
        try {
            super.onDestroy();
        } finally {
            if (BuildConfig.DEBUG) Trace.endSection();
        }
    }
}
