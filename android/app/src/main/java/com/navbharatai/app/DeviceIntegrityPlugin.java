package com.navbharatai.app;

import android.content.Context;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;

/**
 * THE DEVICE CHECK behind every rupee of the referral welcome gift.
 *
 * WHAT IT HANDS THE SERVER, and why it is two things rather than one:
 *
 *   • ANDROID_ID — WHICH device this is. Stable for our app on this handset across reinstalls and
 *     new accounts, scoped to our signing key so no other app shares it, and needing no permission
 *     and no prompt. It RESETS ON A FACTORY RESET, which is the honest limit of the whole design and
 *     is written down rather than wished away.
 *   • A PLAY INTEGRITY TOKEN — whether this is a genuine device running our genuine, Play-installed
 *     app. Signed by Google, decodable only by our server with our service account.
 *
 * 🔒 THE FIRST IS WORTHLESS WITHOUT THE SECOND, and that is the entire security argument. ANDROID_ID
 * is just a string this process can read and any other program could invent; it becomes evidence only
 * because it arrives beside a verdict Google signed for our package in the same moment. So this
 * plugin NEVER returns an id without a token — a partial success here would be a hole on the server,
 * which cannot tell "the device declined to attest" from "there was nothing to attest".
 *
 * 🔒 AND IT NEVER REPORTS SUCCESS IT DID NOT HAVE. Every failure — Play Services missing, the API not
 * enabled, no network, a cloud project mismatch — comes back as an explicit failure with Google's own
 * message attached. A caller cannot mistake any of them for a pass, and the server's answer to all of
 * them is the same: no verification, therefore no money.
 *
 * ⚠️ `PLAY_INTEGRITY_CLOUD_PROJECT` is injected at BUILD time (build.gradle), not typed here. Google
 * requires the Cloud project number that owns the Play Integrity API, and a wrong one fails at the
 * REQUEST with an error rather than at the verdict — so it is a build input like the Meta credentials
 * beside it, and a build made without it honestly reports that it is not configured.
 */
@CapacitorPlugin(name = "DeviceIntegrity")
public class DeviceIntegrityPlugin extends Plugin {

    /** Both halves are present: the server can verify this device. */
    static final String OUTCOME_OK = "ok";
    /** This build carries no cloud project number, so no token can be requested. */
    static final String OUTCOME_NOT_CONFIGURED = "not-configured";
    /** Google refused or could not answer. Its own message rides along for the server log. */
    static final String OUTCOME_FAILED = "failed";

    @PluginMethod
    public void getDeviceCheck(PluginCall call) {
        long cloudProject = cloudProjectNumber();
        if (cloudProject <= 0L) {
            resolveFailure(call, OUTCOME_NOT_CONFIGURED,
                    "This build has no Play Integrity cloud project configured.");
            return;
        }

        final String deviceId = androidId();
        if (deviceId == null || deviceId.isEmpty()) {
            // Genuinely possible on a device whose Settings provider refuses the read. Honest failure
            // rather than an invented id, which would be a fake device the server would then trust.
            resolveFailure(call, OUTCOME_FAILED, "This device did not provide an identifier.");
            return;
        }

        try {
            IntegrityManager manager = IntegrityManagerFactory.create(getContext());
            manager.requestIntegrityToken(
                    IntegrityTokenRequest.builder().setCloudProjectNumber(cloudProject).build()
            ).addOnSuccessListener(response -> {
                String token = response.token();
                if (token == null || token.isEmpty()) {
                    resolveFailure(call, OUTCOME_FAILED, "Play Integrity returned an empty token.");
                    return;
                }
                JSObject result = new JSObject();
                result.put("outcome", OUTCOME_OK);
                result.put("deviceId", deviceId);
                result.put("integrityToken", token);
                call.resolve(result);
            }).addOnFailureListener(e ->
                    // Google's own message names the real cause — API not enabled, Play Services too
                    // old, no network, wrong cloud project. Passing it through is what makes the first
                    // real failure diagnosable instead of a shrug.
                    resolveFailure(call, OUTCOME_FAILED, e.getMessage() == null ? "Play Integrity failed." : e.getMessage())
            );
        } catch (Throwable t) {
            // IntegrityManagerFactory throws on a device with no usable Play Services at all.
            resolveFailure(call, OUTCOME_FAILED, t.getMessage() == null ? "Play Integrity unavailable." : t.getMessage());
        }
    }

    /**
     * A failure RESOLVES rather than rejects, deliberately.
     *
     * A rejection reaches the web layer as a thrown error, and an unhandled one on a path that runs
     * at sign-in is how a launch screen breaks — the iOS PlayBilling defect this app already fixed
     * once. The caller gets a plain, inspectable outcome instead, and the absence of a token is
     * already unambiguous: no token, no money.
     */
    private void resolveFailure(PluginCall call, String outcome, String message) {
        JSObject result = new JSObject();
        result.put("outcome", outcome);
        result.put("message", message);
        call.resolve(result);
    }

    /** The per-app, per-device id. Null rather than a guess if the platform will not give one. */
    private String androidId() {
        try {
            Context ctx = getContext();
            if (ctx == null) return null;
            return Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Throwable t) {
            return null;
        }
    }

    /** Injected by build.gradle as a BuildConfig field; 0 when this build was made without it. */
    private long cloudProjectNumber() {
        try {
            return Long.parseLong(BuildConfig.PLAY_INTEGRITY_CLOUD_PROJECT);
        } catch (Throwable t) {
            return 0L;
        }
    }
}
