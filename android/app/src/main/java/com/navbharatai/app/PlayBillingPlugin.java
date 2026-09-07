package com.navbharatai.app;

import android.app.Activity;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * GOOGLE PLAY BILLING — the Android half of the in-app token top-up.
 *
 * WHY IT EXISTS: Google Play's Payments policy requires digital goods consumed inside a Play-
 * distributed app to be sold through Play's own billing. NavBharatAI's wallet top-up is exactly
 * that, so the Android app needs this rail. The web keeps using the existing gateway.
 *
 * WHAT THIS PLUGIN DELIBERATELY DOES NOT DO: decide money. It never says how many tokens a purchase
 * is worth, never reads a price from the device, and never reports success on its own authority. It
 * hands the opaque purchase token to the web layer, which posts it to OUR server, which asks Google
 * directly and credits from the SERVER's catalogue (storeBilling.ts). A rooted device faking every
 * value in this file still cannot mint a rupee — the same rule the Cashfree rail follows.
 *
 * WHY A DIRECT DEPENDENCY AND NOT REFLECTION (unlike MetaConsentPlugin, which reflects): the Meta
 * SDK is a CONDITIONAL gradle dependency gated on credentials that may be absent, so a compile-time
 * reference there would break credential-less builds. Play Billing has no such gate — it is a plain
 * library with no secret — so it is always present and direct calls keep this file readable. The
 * FEATURE is gated at runtime by the server's STORE_BILLING flag instead, which is where a business
 * decision belongs.
 *
 * ONE-TIME PRODUCTS, CONSUMED: each pack is bought repeatedly, so every purchase is consumed after
 * delivery. The consume is driven from the WEB layer and only after the server credits — see
 * playBillingNative.ts for why that ordering is the entire safety property.
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {

    private BillingClient billingClient;

    /**
     * The in-flight purchase call. Google reports the result on a listener, not on the call that
     * started the flow, so the call is parked here and resolved when the listener fires.
     * Atomic because the listener runs on Google's callback thread, not the caller's.
     */
    private final AtomicReference<PluginCall> pendingPurchase = new AtomicReference<>(null);

    private final PurchasesUpdatedListener purchasesUpdatedListener = (billingResult, purchases) -> {
        PluginCall call = pendingPurchase.getAndSet(null);
        if (call == null) {
            // A purchase arrived with no call waiting — e.g. Play delivered one the user completed
            // outside this session. Nothing to resolve; queryPurchases() sweeps it up on next open,
            // which is exactly the safety net that exists for this case.
            return;
        }
        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.resolve(status("cancelled", null));
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            call.resolve(status("failed", billingResult.getDebugMessage()));
            return;
        }
        Purchase purchase = purchases.get(0);
        call.resolve(describePurchase(purchase));
    };

    // ─────────────────────────── connection ───────────────────────────

    /** Build the client lazily. Safe to call repeatedly; never throws. */
    private synchronized BillingClient client() {
        if (billingClient == null) {
            billingClient = BillingClient.newBuilder(getContext())
                    .setListener(purchasesUpdatedListener)
                    // v7 requires declaring which product types may be pending. India has real
                    // deferred payment methods, so a pending purchase is a state we must accept
                    // rather than treat as a failure the user paid for.
                    .enablePendingPurchases(
                            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .build();
        }
        return billingClient;
    }

    /** Connect if needed, then run `onReady`. `onFailed` gets an honest reason — never a silent stall. */
    private void withConnection(final Runnable onReady, final java.util.function.Consumer<String> onFailed) {
        BillingClient c;
        try {
            c = client();
        } catch (Throwable t) {
            onFailed.accept("billing client unavailable: " + t.getMessage());
            return;
        }
        if (c.isReady()) {
            onReady.run();
            return;
        }
        try {
            c.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(BillingResult billingResult) {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        onReady.run();
                    } else {
                        onFailed.accept("billing setup " + billingResult.getResponseCode()
                                + ": " + billingResult.getDebugMessage());
                    }
                }

                @Override
                public void onBillingServiceDisconnected() {
                    // Not an error by itself — the next call reconnects. Reported only if something
                    // was waiting, which startConnection's own failure path already covers.
                }
            });
        } catch (Throwable t) {
            onFailed.accept("billing connect threw: " + t.getMessage());
        }
    }

    // ─────────────────────────── methods ───────────────────────────

    /**
     * Can this device buy at all? False on a device with no Play Store, an out-of-date Play app, or
     * when billing refuses to connect — the web layer then simply keeps the existing rail.
     */
    @PluginMethod
    public void isAvailable(final PluginCall call) {
        withConnection(
                () -> {
                    JSObject out = new JSObject();
                    out.put("available", true);
                    call.resolve(out);
                },
                reason -> {
                    JSObject out = new JSObject();
                    out.put("available", false);
                    out.put("reason", reason);
                    call.resolve(out);
                });
    }

    /** Launch Google's purchase sheet for one product id. Result arrives on purchasesUpdatedListener. */
    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId", "");
        if (productId == null || productId.isEmpty()) {
            call.resolve(status("failed", "missing productId"));
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve(status("failed", "no activity"));
            return;
        }

        withConnection(() -> {
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                    .setProductList(Collections.singletonList(
                            QueryProductDetailsParams.Product.newBuilder()
                                    .setProductId(productId)
                                    .setProductType(BillingClient.ProductType.INAPP)
                                    .build()))
                    .build();

            client().queryProductDetailsAsync(params, (result, productDetailsList) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK
                        || productDetailsList == null || productDetailsList.isEmpty()) {
                    // The single most likely cause on a first run: the product id is not created (or
                    // not ACTIVE) in the Play Console. Say so rather than a bare "failed" — this is
                    // the message that saves an afternoon.
                    call.resolve(status("failed", "product '" + productId
                            + "' not found in Play (is it created and active in the Play Console?): "
                            + result.getDebugMessage()));
                    return;
                }
                ProductDetails details = productDetailsList.get(0);
                BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Collections.singletonList(
                                BillingFlowParams.ProductDetailsParams.newBuilder()
                                        .setProductDetails(details)
                                        .build()))
                        .build();

                // Park the call BEFORE launching: Google can report the result on a different thread
                // as soon as the sheet closes, and a listener that fires with nothing parked would
                // drop a purchase the user actually paid for.
                PluginCall displaced = pendingPurchase.getAndSet(call);
                if (displaced != null) {
                    displaced.resolve(status("cancelled", "superseded by a newer purchase"));
                }
                BillingResult launch = billingClient.launchBillingFlow(activity, flowParams);
                if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    PluginCall parked = pendingPurchase.getAndSet(null);
                    if (parked != null) {
                        parked.resolve(status("failed", launch.getDebugMessage()));
                    }
                }
            });
        }, reason -> call.resolve(status("unavailable", reason)));
    }

    /**
     * Purchases Google still considers undelivered — the crash/offline safety net. Returns only
     * PURCHASED ones: a PENDING purchase has no money behind it yet and must never be credited.
     */
    @PluginMethod
    public void queryPurchases(final PluginCall call) {
        withConnection(() -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build();
            client().queryPurchasesAsync(params, (result, purchases) -> {
                JSArray arr = new JSArray();
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                    for (Purchase p : purchases) {
                        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                        List<String> products = p.getProducts();
                        JSObject o = new JSObject();
                        o.put("purchaseToken", p.getPurchaseToken());
                        o.put("productId", products != null && !products.isEmpty() ? products.get(0) : "");
                        if (p.getOrderId() != null) o.put("orderId", p.getOrderId());
                        arr.put(o);
                    }
                }
                JSObject out = new JSObject();
                out.put("purchases", arr);
                call.resolve(out);
            });
        }, reason -> {
            JSObject out = new JSObject();
            out.put("purchases", new JSArray());
            out.put("reason", reason);
            call.resolve(out);
        });
    }

    /**
     * Mark a purchase delivered so the pack can be bought again.
     *
     * 🔒 Called ONLY after our server has credited the wallet (see playBillingNative.ts). Consuming
     * first would erase Google's record of a purchase the user paid for; consuming late merely
     * leaves it replayable, which the idempotent server route absorbs.
     */
    @PluginMethod
    public void consume(final PluginCall call) {
        final String token = call.getString("purchaseToken", "");
        if (token == null || token.isEmpty()) {
            JSObject out = new JSObject();
            out.put("consumed", false);
            call.resolve(out);
            return;
        }
        withConnection(() -> {
            ConsumeParams params = ConsumeParams.newBuilder().setPurchaseToken(token).build();
            client().consumeAsync(params, (result, outToken) -> {
                JSObject out = new JSObject();
                out.put("consumed", result.getResponseCode() == BillingClient.BillingResponseCode.OK);
                call.resolve(out);
            });
        }, reason -> {
            JSObject out = new JSObject();
            out.put("consumed", false);
            out.put("reason", reason);
            call.resolve(out);
        });
    }

    // ─────────────────────────── helpers ───────────────────────────

    private static JSObject status(String status, String message) {
        JSObject out = new JSObject();
        out.put("status", status);
        if (message != null) out.put("message", message);
        return out;
    }

    /**
     * Describe a purchase for the web layer. A PENDING purchase is reported as pending and carries
     * no token to credit against — Play's deferred payment methods (common in India) settle later,
     * and treating one as paid would credit a wallet for money that has not arrived.
     */
    private static JSObject describePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
            return status("pending", "awaiting payment confirmation from Google");
        }
        List<String> products = purchase.getProducts();
        JSObject out = status("purchased", null);
        out.put("purchaseToken", purchase.getPurchaseToken());
        out.put("productId", products != null && !products.isEmpty() ? products.get(0) : "");
        if (purchase.getOrderId() != null) out.put("orderId", purchase.getOrderId());
        return out;
    }
}
