package com.navbharatai.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CONSENT GATE for Meta app events inside the Android shell.
 *
 * WHY IT EXISTS: the Facebook SDK initialises itself from a ContentProvider at process start and, by
 * default, begins logging app events and reading the advertising ID before a single line of our code
 * runs — long before the user has seen the consent banner. The banner names Meta by name and promises
 * that this measurement happens "only if you accept". Without this gate that promise would be false
 * inside the app, and the Play Data safety declaration ("Users can choose whether this data is
 * collected") would be false with it.
 *
 * So the manifest ships the three SDK switches OFF and they are turned on here, exactly once the user
 * has granted consent — and turned back off if they withdraw it.
 *
 * WHY REFLECTION rather than a direct FacebookSdk import: `facebook-core` is a CONDITIONAL dependency
 * (build.gradle adds it only when both credentials are configured), so a compile-time reference would
 * break every build made without them — which is every local build and every CI run before the
 * secrets were set. Reflection keeps this file compiling in both worlds, and a missing SDK is reported
 * honestly as "sdk-absent" rather than silently succeeding.
 */
@CapacitorPlugin(name = "MetaConsent")
public class MetaConsentPlugin extends Plugin {

    /** The SDK is present and now matches the user's choice. */
    static final String OUTCOME_ENABLED = "enabled";
    static final String OUTCOME_DISABLED = "disabled";
    /** No Facebook SDK in this build (no credentials configured) — nothing was collecting anyway. */
    static final String OUTCOME_SDK_ABSENT = "sdk-absent";
    /** The SDK is present but refused the call. Reported, never swallowed as success. */
    static final String OUTCOME_FAILED = "failed";

    @PluginMethod
    public void setConsent(PluginCall call) {
        Boolean granted = call.getBoolean("granted", Boolean.FALSE);
        boolean allow = Boolean.TRUE.equals(granted);
        JSObject result = new JSObject();
        result.put("granted", allow);
        result.put("outcome", applyConsent(allow));
        call.resolve(result);
    }

    /**
     * Apply the choice to the Facebook SDK. Never throws: the caller is a privacy control, and a
     * measurement SDK must never be able to take the app down.
     */
    static String applyConsent(boolean granted) {
        try {
            Class<?> sdk = Class.forName("com.facebook.FacebookSdk");
            // Flags FIRST, initialise second. The reverse order would let the SDK come up under its
            // own defaults and fire one batch of events before the flags landed — a small window, but
            // a window in which we would have collected data the user had not agreed to.
            sdk.getMethod("setAutoLogAppEventsEnabled", boolean.class).invoke(null, granted);
            sdk.getMethod("setAdvertiserIDCollectionEnabled", boolean.class).invoke(null, granted);
            sdk.getMethod("setAutoInitEnabled", boolean.class).invoke(null, granted);
            if (granted) {
                sdk.getMethod("fullyInitialize").invoke(null);
            }
            return granted ? OUTCOME_ENABLED : OUTCOME_DISABLED;
        } catch (ClassNotFoundException absent) {
            return OUTCOME_SDK_ABSENT;
        } catch (Throwable failure) {
            return OUTCOME_FAILED;
        }
    }
}
