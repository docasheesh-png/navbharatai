import crypto from 'crypto';
import axios from 'axios';
import type { Express, Request, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. The server writes payment_transactions
// / user_token_wallets which navbharat-prod's rules mark `allow write: if false` (server-only); the old
// unauthenticated CLIENT SDK was rejected with PERMISSION_DENIED. Same modular API, admin-backed.
import { doc, getDoc, setDoc, updateDoc, runTransaction, collection, query, where, limit, getDocs, getServerDb as getDb } from '../lib/serverDb';
import { ordersToReconcile, reconcileMessage, type PendingOrderRecord } from '../lib/pendingOrders';
import { getSecretValue } from '../lib/secrets';
import { sendSafeError } from '../lib/httpError';
import { verifyPaymentInternal, computeCreditedWallet } from '../lib/payments';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import {
  storeBillingEnabled, storePlatformConfigured, storePacks, packForProduct, storeTransactionDocId,
  storeFeePct, netAfterStoreFee,
} from '../lib/storeBilling';
import { verifyStorePurchase } from '../lib/storeVerify';
import {
  isAcceptablePassPayment, professionalPassPriceInr, professionalPassDays,
} from '../professionals/professionalPaid';

/**
 * Verify a Cashfree webhook signature. CRITICAL: the HMAC MUST be computed over the EXACT raw bytes
 * Cashfree signed — never over `JSON.stringify(req.body)`, because re-serializing the parsed body
 * (whitespace, key order, escaping) yields different bytes and a different HMAC, so every legitimate
 * webhook would be rejected and the server-side payment-fulfillment safety net would silently die
 * (a paid user who closes the tab before the client poll finishes is charged but never credited).
 *
 * Accepts Cashfree's v2 (base64 of `timestamp + rawBody`) and legacy v1 (base64/hex of `rawBody`)
 * formats. Pure + fully unit-testable. This does NOT weaken security — forging any of these still
 * requires the shared secret.
 */
export function isValidCashfreeSignature(opts: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
}): boolean {
  const { rawBody, timestamp, signature, secret } = opts;
  if (!signature || !secret) return false;
  const v2 = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  const v1Base64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const v1Hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return signature === v2 || signature === v1Base64 || signature === v1Hex;
}

/**
 * Payment routes (Cashfree order creation, verification, webhook, coupon redeem)
 * extracted from the server.ts monolith (Phase 1). Behavior unchanged. The
 * payment rate limiter is injected so its config stays owned by the bootstrap.
 */
export function registerPaymentRoutes(app: Express, paymentLimiter: RateLimitRequestHandler): void {
  app.post('/api/payment/create-order', paymentLimiter, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { amount, userEmail, userName, userPhone, isVishwakarmaOrder, buyPass, tokenAmount, productType, passPlan, passDays } = req.body;

    // SECURITY (money, 2026-07-27 — going to real production): the order's owner is the VERIFIED token
    // identity, never the body's `userId`. This route used to take the uid straight from the request, so
    // anyone could mint payment_transactions rows against any account, and every entitlement downstream
    // was keyed on a value the caller chose. All three real callers (wallet recharge, Vishwakarma,
    // Professional Pass) are signed-in flows, so requiring the token costs a legitimate user nothing.
    // (VITEST accepts a body userId so the route stays unit-testable without a live token — the same
    // convention /api/payment/redeem-coupon already uses for its H1 identity fix.)
    const userId = process.env.VITEST
      ? (typeof req.body?.userId === 'string' ? req.body.userId : null)
      : await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Please sign in to make a payment.' });
    // Product routed on fulfilment: 'professional_pass' grants a time-based Professional Pass (no wallet
    // tokens); anything else is the existing wallet recharge. Untrusted, but harmless — the fulfilment
    // path re-derives days/plan from the server config, and the amount is reconciled against Cashfree.
    const isProfessionalPass = String(productType || '') === 'professional_pass';
    const orderAmount = parseFloat(amount);
    if (isNaN(orderAmount) || orderAmount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    // A Professional Pass order must cover at least one full period at the SERVER's price. Without
    // this, a client could order the pass for ₹1: the fulfilment path now derives the entitlement from
    // the paid amount and would grant nothing, so the customer would have paid for nothing and needed a
    // refund. Refusing here means that situation never arises, and the real price is stated up front.
    if (isProfessionalPass && !isAcceptablePassPayment(orderAmount)) {
      return res.status(400).json({
        error: `The Professional Pass costs ₹${professionalPassPriceInr()}. Please start the purchase again from the Professionals screen.`,
        code: 'pass_amount_too_low',
        passPriceInr: professionalPassPriceInr(),
        passDays: professionalPassDays(),
      });
    }

    // Cryptographically-random suffix avoids the collision/predictability of Math.random()*1000.
    const orderId = `ord_nb_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    try {
      // Save pending transaction to payment_transactions collection
      const txRef = doc(db, 'payment_transactions', orderId);
      await setDoc(txRef, {
        transactionId: orderId,
        userId,
        amountPaid: orderAmount,
        balanceAdded: orderAmount, // ₹1 = ₹1 balance added to wallet
        isVishwakarmaOrder: !!isVishwakarmaOrder,
        buyPass: !!buyPass,
        tokenAmount: tokenAmount ? parseFloat(tokenAmount) : 0,
        // Professional Pass product (fulfilment grants a pass instead of crediting wallet tokens).
        productType: isProfessionalPass ? 'professional_pass' : 'wallet',
        ...(isProfessionalPass ? { passPlan: String(passPlan || 'monthly'), passDays: Number(passDays) || 0 } : {}),
        paymentProvider: 'CASHFREE',
        paymentStatus: 'PENDING',
        paymentReference: '',
        createdAt: new Date().toISOString()
      });

      // Dynamic key resolution from database fallback
      const dbClientId = await getSecretValue(userId, 'CASHFREE_CLIENT_ID') || await getSecretValue(userId, 'CASHFREE_APP_ID');
      const dbClientSecret = await getSecretValue(userId, 'CASHFREE_CLIENT_SECRET') || await getSecretValue(userId, 'CASHFREE_SECRET_KEY');

      const clientId = (dbClientId || process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID)?.trim();
      const clientSecret = (dbClientSecret || process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY)?.trim();

      // Robust detection: default to production unless the secret explicitly indicates 'test' or 'sandbox'
      const isTestSecret = clientSecret && (
        clientSecret.toLowerCase().includes('test') ||
        clientSecret.toLowerCase().includes('sandbox') ||
        clientSecret.toLowerCase().includes('sim_') ||
        clientSecret.toUpperCase().startsWith('TEST')
      );
      const isTestClient = clientId && (
        clientId.toLowerCase().includes('test') ||
        clientId.toLowerCase().includes('sandbox') ||
        clientId.toUpperCase().startsWith('TEST')
      );

      const env = process.env.CASHFREE_ENV || (isTestSecret || isTestClient ? 'sandbox' : 'production');

      // Detect if credentials are empty or standard placeholder values
      const isPlaceholder = !clientId || !clientSecret ||
        clientId.toLowerCase().includes('placeholder') ||
        clientSecret.toLowerCase().includes('placeholder') ||
        clientId.trim() === '' ||
        clientSecret.trim() === '';

      console.log(`[CASHFREE] Creating order ${orderId} | Env: ${env} | Client: ${clientId?.substring(0, 8)}... | IsPlaceholder: ${isPlaceholder}`);

      if (isPlaceholder) {
        // Return simulator session if keys are not configured or are placeholder keys, providing seamless dev preview
        console.log(`[CASHFREE] Missing/placeholder credentials. Returning Sandbox Simulator session for Order: ${orderId}`);
        return res.json({
          orderId,
          paymentSessionId: `sim_session_${orderId}_${amount}`,
          isSimulator: true,
          orderAmount
        });
      }

      // Real Cashfree API order creation
      const cfUrl = env === 'production'
        ? 'https://api.cashfree.com/pg/orders'
        : 'https://sandbox.cashfree.com/pg/orders';

      // Round amount to maximum 2 decimal places which Cashfree expects
      const finalAmount = Math.round(orderAmount * 100) / 100;

      // Class-A sanitization of Customer Email
      let customerEmailClean = String(userEmail || 'client@navbharat.ai').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmailClean) || customerEmailClean.length > 100) {
        customerEmailClean = 'client@navbharat.ai';
      }

      // Class-A sanitization of Customer ID: strictly alphanumeric, hyphens, and underscores only (NO '@' or '.' dot which can trigger invalid_request_errors)
      let customerIdClean = String(userId || 'nb_cust_dummy').replace(/[^a-zA-Z0-9\-_]/g, '');
      if (customerIdClean.length < 3) {
        customerIdClean = 'nb_cust_' + customerIdClean;
      }
      if (customerIdClean.length > 50) {
        customerIdClean = customerIdClean.substring(0, 50);
      }

      // Class-A sanitization of Customer Phone: must be exactly 10 digits without any prefix codes (starts with 6,7,8,9)
      let customerPhoneClean = String(userPhone || '9876543210').replace(/\D/g, ''); // keep only numbers
      if (customerPhoneClean.startsWith('91') && customerPhoneClean.length > 10) {
        customerPhoneClean = customerPhoneClean.substring(2);
      } else if (customerPhoneClean.startsWith('0') && customerPhoneClean.length > 10) {
        customerPhoneClean = customerPhoneClean.substring(1);
      }
      if (customerPhoneClean.length !== 10 || !/^[6-9]/.test(customerPhoneClean)) {
        customerPhoneClean = '9876543210'; // Secure dummy Indian mobile number
      }

      // Class-A sanitization of Customer Name: ONLY alphabets, spaces, dots, and hyphens (Numbers are NOT allowed by Cashfree name validation)
      let customerNameClean = String(userName || 'NavBharat Client')
        .replace(/[^a-zA-Z\s.-]/g, '') // strictly exclude numbers and odd special characters
        .replace(/\s+/g, ' ') // collapse multi spaces
        .trim();
      if (customerNameClean.length < 3) {
        customerNameClean = 'NavBharat Client';
      }
      if (customerNameClean.length > 40) {
        customerNameClean = customerNameClean.substring(0, 40);
      }

      // Secure return_url generation with SSL enforcement for cloud preview environment
      const host = req.get('host') || 'localhost:3000';
      const protocol = (host.includes('localhost') || host.includes('127.0.0.1')) ? 'http' : 'https';
      const secureReturnUrl = `${protocol}://${host}/api/payment/verify-redirect?order_id={order_id}`;

      console.log(`[CASHFREE] Payload inputs - Name: ${customerNameClean}, Email: ${customerEmailClean}, Phone: ${customerPhoneClean}, ID: ${customerIdClean}, Amount: ${finalAmount}, ReturnURL: ${secureReturnUrl}`);

      const cfResponse = await axios.post(cfUrl, {
        order_id: orderId,
        order_amount: finalAmount,
        order_currency: 'INR',
        customer_details: {
          customer_id: customerIdClean,
          customer_name: customerNameClean,
          customer_email: customerEmailClean,
          customer_phone: customerPhoneClean
        },
        order_meta: {
          return_url: secureReturnUrl
        }
      }, {
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json'
        }
      });

      const data = cfResponse.data;
      if (data.payment_session_id) {
        return res.json({
          orderId,
          paymentSessionId: data.payment_session_id,
          isSimulator: false,
          orderAmount: finalAmount,
          environment: env
        });
      } else {
        throw new Error(data.message || 'Payment Session ID not generated');
      }
    } catch (error: any) {
      const detailedError = error.response?.data || {};
      const errorMessage = detailedError.message || error.message;
      console.error(`[CASHFREE] Order creation failed. Full detailed payload:`, JSON.stringify(detailedError, null, 2));
      return res.status(500).json({
        error: `Cashfree integration error: ${errorMessage}`,
        details: detailedError
      });
    }
  });

  app.post('/api/payment/verify-payment', paymentLimiter, async (req: Request, res: Response) => {
    const { orderId } = req.body;
    // Validate TYPE, not just truthiness — a non-string orderId must never reach the Firestore
    // doc path / verify routine. Also bound the length to a sane order-id size.
    if (!orderId || typeof orderId !== 'string' || orderId.length > 128) {
      return res.status(400).json({ error: 'A valid Order ID is required' });
    }

    const result = await verifyPaymentInternal(orderId);
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(400).json({ error: result.error });
    }
  });

  /**
   * THE THIRD PATH TO A USER'S MONEY (admin 2026-08-01).
   *
   * A Cashfree payment reached the wallet by exactly two routes before this, and both can miss. The
   * webhook is REJECTED outright unless CASHFREE_WEBHOOK_SECRET is configured — without it the
   * signature cannot be verified, and accepting an unverified webhook would let anyone credit their
   * own wallet — so with the secret unset that route delivers nothing at all. The other route is the
   * client redirect, which only fires if the user returns to the app carrying `?payment=success`.
   *
   * So a user who pays by UPI and closes the app — the normal thing to do on a phone, because the UPI
   * app is a DIFFERENT app — had genuinely paid and was never credited. Their order sat at PENDING
   * forever; nothing in the codebase ever revisited one.
   *
   * This asks Cashfree about that user's OWN unfinished orders and credits the ones really paid. It
   * needs no webhook secret, so the money no longer depends on a piece of configuration. Safe by
   * construction: the order list is filtered by the VERIFIED uid (a caller cannot sweep someone
   * else's orders), each order is settled by the same verifyPaymentInternal the redirect uses — which
   * asks Cashfree for the true status and refuses to credit anything Cashfree does not call paid —
   * and it is idempotent, short-circuiting an order already marked SUCCESS.
   *
   * Setting CASHFREE_WEBHOOK_SECRET is still worth doing: it credits the user in seconds rather than
   * on their next visit. This makes it an optimisation instead of the difference between a user
   * getting their money and losing it.
   */
  app.post('/api/payment/reconcile', paymentLimiter, async (req: Request, res: Response) => {
    const db = getDb() as any;
    if (!db) return res.status(503).json({ error: 'Payments are temporarily unavailable. Please try again shortly.' });

    // Identity from the VERIFIED token — never a client-claimed field, or one user could sweep (and
    // read the amounts of) another's orders. Same VITEST convention as create-order.
    const userId = process.env.VITEST
      ? (typeof req.body?.userId === 'string' ? req.body.userId : null)
      : await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Please sign in first.' });

    try {
      const txRef = collection(db, 'payment_transactions');
      const q = query(txRef, where('userId', '==', userId), where('paymentStatus', '==', 'PENDING'), limit(50));
      const snap = await getDocs(q);
      const records = snap.docs.map((d: any) => d.data() as PendingOrderRecord);
      const orderIds = ordersToReconcile(records, Date.now());

      let creditedInr = 0;
      let creditedOrders = 0;
      for (const orderId of orderIds) {
        // One slow or failing order must not cost the user the others.
        const result = await verifyPaymentInternal(orderId).catch(() => ({ success: false } as any));
        if (result?.success && !result.data?.alreadyProcessed) {
          const added = Number(result.data?.balanceAdded);
          if (Number.isFinite(added) && added > 0) creditedInr += added;
          creditedOrders += 1;
        }
      }

      // `checked` is honest telemetry for the admin; the user only ever sees a message when money
      // actually arrived (reconcileMessage returns null otherwise), so simply opening the app never
      // produces a payment notice.
      return res.json({
        checked: orderIds.length,
        creditedOrders,
        creditedInr: Math.round(creditedInr * 100) / 100,
        message: reconcileMessage(creditedInr, creditedOrders),
      });
    } catch (err: any) {
      return sendSafeError(res, 500, 'Unable to check your recent payments right now. Please try again.', err, 'payment reconcile');
    }
  });

  app.post('/api/payment/webhook', async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      // Verify the HMAC over the EXACT bytes received (captured by the express.json `verify` hook
      // in server.ts as req.rawBody), NOT a re-serialized JSON.stringify(req.body) — the latter
      // changes the bytes and makes every legitimate webhook fail signature validation. Fall back
      // to re-serialization only if the raw bytes are somehow unavailable (no worse than before).
      const rawBody: string = (req as any).rawBody
        ? (req as any).rawBody.toString('utf8')
        : JSON.stringify(req.body);

      // Cashfree Webhook Data structure
      const orderId = req.body.data?.order?.order_id;
      if (!orderId) {
        console.warn('[CASHFREE WEBHOOK] Missing order_id in webhook body:', req.body);
        return res.status(400).json({ error: 'Order ID missing in webhook payload' });
      }

      console.log(`[CASHFREE WEBHOOK] Received webhook event for order: ${orderId}`);

      // Resolve the secret dynamically
      let secret = process.env.CASHFREE_WEBHOOK_SECRET;

      if (db) {
        try {
          const txRef = doc(db, 'payment_transactions', orderId);
          const txSnap = await getDoc(txRef);
          if (txSnap.exists()) {
            const txData = txSnap.data();
            const dbSecret = await getSecretValue(txData.userId, 'CASHFREE_WEBHOOK_SECRET');
            if (dbSecret) {
              secret = dbSecret;
              console.log(`[CASHFREE WEBHOOK] Loaded db-saved webhook secret for user: ${txData.userId}`);
            }
          }
        } catch (err: any) {
          console.error('[CASHFREE WEBHOOK] Error looking up transaction user secret:', err.message);
        }
      }

      if (!secret) {
        console.error('[CASHFREE WEBHOOK] Webhook signature verification rejected: CASHFREE_WEBHOOK_SECRET is not configured globally or in the user database.');
        return res.status(400).json({ error: 'Webhook secret not configured. Please enter it in the Secret Management panel first.' });
      }

      const signature = (req.headers['x-cf-signature'] || req.headers['cf-signature'] || '') as string;
      const ts = (req.headers['x-cf-signature-timestamp'] || '') as string;

      // Accepts Cashfree's v2 (timestamp+rawBody) and legacy v1 (rawBody) formats — all over raw bytes.
      const isSignatureValid = isValidCashfreeSignature({ rawBody, timestamp: ts, signature, secret });

      if (!isSignatureValid) {
        // Never log the expected HMACs — they are secret-derived and would let a reader forge signatures.
        console.error(`[CASHFREE WEBHOOK] Webhook signature mismatch for order ${orderId} — rejecting.`);
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }

      console.log(`[CASHFREE WEBHOOK] Signature verified successfully. Initiating payment fulfillment...`);
      const result = await verifyPaymentInternal(orderId);
      if (result.success) {
        console.log(`[CASHFREE WEBHOOK] Fulfilled order ${orderId} successfully!`);
        return res.status(200).json({ status: 'OK' });
      } else {
        console.error(`[CASHFREE WEBHOOK] Fulfillment failed for order ${orderId}: ${result.error}`);
        return res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[CASHFREE WEBHOOK] Error handling webhook exception:', error);
      return sendSafeError(res, 500, 'Payment webhook processing failed.', error, 'cashfree webhook');
    }
  });

  app.get('/api/payment/verify-redirect', (req: Request, res: Response) => {
    const order_id = req.query.order_id as string;
    res.redirect(`/?payment=check&order_id=${order_id}`);
  });

  app.post('/api/payment/redeem-coupon', paymentLimiter, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { couponCode, userEmail, userName } = req.body;
    // SECURITY (H1): identity from the VERIFIED token, never the body userId — otherwise anyone could
    // redeem real spendable balance onto (or for) any account. VITEST skips (route not token-authed in
    // tests); a genuine missing/invalid token → 401.
    const verifiedUid = process.env.VITEST
      ? (typeof req.body?.userId === 'string' ? req.body.userId : null)
      : await verifyFirebaseToken(req);
    if (!verifiedUid) return res.status(401).json({ error: 'Please sign in again to redeem a coupon.' });
    const userId = verifiedUid;
    if (!couponCode || typeof couponCode !== 'string') {
      return res.status(400).json({ error: 'Promo coupon code is required' });
    }

    const code = couponCode.trim().toUpperCase();
    const couponValues: Record<string, number> = {
      'NAVBHARAT50': 50,
      'WELCOME100': 100,
      'FESTIVE2026': 200,
      'SAKUNI25': 25,
      'FREE100': 100
    };

    if (!(code in couponValues)) {
      return res.status(400).json({ error: 'Invalid or expired promoter voucher card.' });
    }

    const value = couponValues[code];
    const redemptionId = `coupon_${code}_${userId}`;

    try {
      // SECURITY (H1): ATOMICALLY claim this one-time redemption. The old getDoc→setDoc check was a
      // TOCTOU — concurrent requests for the same code could both pass the "already redeemed?" check
      // and each credit `value`. The transaction creates the redemption doc only if it doesn't exist;
      // if it already exists, exactly one caller loses and we reject. Only the winner credits below.
      const txRef = doc(db, 'payment_transactions', redemptionId);
      const claimed = await runTransaction(db, async (tx: any) => {
        const snap = await tx.get(txRef);
        if (snap.exists()) return false;
        tx.set(txRef, {
          transactionId: redemptionId,
          userId,
          amountPaid: 0,
          balanceAdded: value,
          paymentProvider: 'COUPON_REDEEM',
          paymentStatus: 'SUCCESS',
          paymentReference: `REDEMPTION_${code}`,
          createdAt: new Date().toISOString(),
        });
        return true;
      });
      if (!claimed) {
        return res.status(400).json({ error: 'You have already redeemed this promo coupon code!' });
      }

      // Update user wallet
      const walletRef = doc(db, 'user_token_wallets', userId);
      const walletSnap = await getDoc(walletRef);
      let newBalance = value;

      if (walletSnap.exists()) {
        const walletData = walletSnap.data();
        newBalance = (walletData.remaining_balance || 0) + value;
        await updateDoc(walletRef, {
          remaining_balance: newBalance,
          total_balance: (walletData.total_balance || 0) + value,
          updatedAt: new Date().toISOString()
        });
      } else {
        await setDoc(walletRef, {
          userId,
          userEmail: userEmail || '',
          userName: userName || '',
          total_balance: value,
          remaining_balance: value,
          total_output_tokens_used: 0,
          total_money_spent: 0,
          updatedAt: new Date().toISOString()
        });
      }

      return res.json({ success: true, balanceAdded: value, currentBalance: newBalance });
    } catch (err: any) {
      console.error('[COUPON] Redemption failed:', err.message);
      return sendSafeError(res, 500, 'Coupon redemption failed. Please try again.', err, 'coupon redeem');
    }
  });

  /**
   * STORE BILLING — Apple / Google in-app purchases (admin 2026-08-09: "app direct apple ya google
   * se payment le sake"). The NATIVE funding rail for the same one wallet Cashfree funds on web.
   *
   * The device sends only an opaque handle. This route asks the STORE whether that purchase is real
   * (verifyStorePurchase), takes the product id from the STORE'S answer, prices it from OUR
   * catalogue, and credits through the SAME `computeCreditedWallet` every other purchase uses. A
   * client cannot choose its own price, cannot replay a purchase (the store transaction id IS the
   * `payment_transactions` doc id), and cannot credit a refunded or pending purchase — the verifier
   * refuses those before this route ever sees money.
   */
  app.get('/api/payment/store/packs', async (_req: Request, res: Response) => {
    // The app asks what to show; honest about whether buying can work at all on this server.
    res.json({
      enabled: storeBillingEnabled(),
      apple: storePlatformConfigured('apple'),
      google: storePlatformConfigured('google'),
      packs: storePacks(),
    });
  });

  app.post('/api/payment/store/verify', paymentLimiter, async (req: Request, res: Response) => {
    const db = getDb() as any;
    if (!db) return res.status(503).json({ error: 'Payments are temporarily unavailable. Please try again.' });
    if (!storeBillingEnabled()) return res.status(503).json({ error: 'In-app purchases are not enabled yet.' });

    // A purchase belongs to a REAL account — the wallet it credits is identified by the verified
    // token, never by anything in the body (the same rule create-order follows).
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Please sign in before buying.' });

    const platform = req.body?.platform === 'apple' ? 'apple' : req.body?.platform === 'google' ? 'google' : null;
    if (!platform) return res.status(400).json({ error: 'A valid platform is required.' });
    const str = (v: unknown, max = 4096) => (typeof v === 'string' && v.length <= max ? v.trim() : '');
    const input = {
      transactionId: str(req.body?.transactionId, 256),
      productId: str(req.body?.productId, 256),
      purchaseToken: str(req.body?.purchaseToken),
    };

    try {
      const verified = await verifyStorePurchase(platform, input);
      if (!verified.ok) {
        // The store's reason is for OUR log; the user gets a plain sentence. A failed verification
        // is never a credit, and never an ambiguous "maybe" the client could retry into money.
        console.error(`[STORE ${platform}] verification refused: ${verified.reason}`);
        return res.status(402).json({ error: 'That purchase could not be verified with the store. If money was taken, it will be refunded automatically by the store.' });
      }

      const pack = packForProduct(verified.productId);
      if (!pack) {
        console.error(`[STORE ${platform}] verified purchase of UNKNOWN product ${verified.productId}`);
        return res.status(400).json({ error: 'That product is no longer available. Please contact support.' });
      }

      const docId = storeTransactionDocId(platform, verified.transactionId);
      const txRef = doc(db, 'payment_transactions', docId);
      const existing = await getDoc(txRef);
      if (existing.exists() && existing.data()?.paymentStatus === 'SUCCESS') {
        // Idempotent: the store re-delivers purchases on relaunch, and the app retries on flaky
        // networks. Both must be safe.
        return res.json({ alreadyProcessed: true, balanceAdded: existing.data()?.balanceAdded ?? pack.creditInr });
      }

      const nowIso = new Date().toISOString();
      // TWO AMOUNTS, both recorded honestly (admin 2026-08-09: "hamare ₹ kam nahi hone chahiye").
      // The store charged `priceInr` (marked up to absorb its commission); the wallet is credited
      // `creditInr` — the SAME value this pack gives on the web, so a user is never short-changed
      // for buying on a phone. `storePriceInr`/`storeFeePct` ride along on the transaction so the
      // admin's own reporting can reconcile a payout without re-deriving the markup.
      const txData = {
        transactionId: docId,
        userId,
        amountPaid: pack.creditInr,
        balanceAdded: pack.creditInr,
        storePriceInr: pack.priceInr,
        storeFeePct: storeFeePct(),
        storeNetInr: netAfterStoreFee(pack.priceInr),
        isVishwakarmaOrder: true,   // the wallet-credit shape every top-up uses
        buyPass: false,
        paymentProvider: platform === 'apple' ? 'APPLE_IAP' : 'GOOGLE_PLAY',
        paymentStatus: 'SUCCESS',
        paymentReference: verified.transactionId,
        productId: verified.productId,
        createdAt: nowIso,
      };

      const wallet = await runTransaction(db, async (tx: any) => {
        const walletRef = doc(db, 'user_token_wallets', userId);
        const walletSnap = await tx.get(walletRef);
        const walletData = walletSnap.exists() ? walletSnap.data() : { userId, tokenBalance: 0, totalTokensPurchased: 0, totalTokensUsed: 0, totalMoneySpent: 0, walletLedger: [], remaining_balance: 0, total_balance: 0 };
        const { wallet: credited } = computeCreditedWallet(walletData, txData as any, null, nowIso);
        tx.set(walletRef, credited);
        tx.set(txRef, txData);
        return credited;
      });

      return res.json({
        ok: true,
        balanceAdded: pack.creditInr,
        tokenBalance: wallet.tokenBalance,
        currentBalance: wallet.remaining_balance,
      });
    } catch (err: any) {
      return sendSafeError(res, 500, 'We could not finish that purchase. If money was taken, the store will refund it automatically.', err, 'store purchase verify');
    }
  });
}
