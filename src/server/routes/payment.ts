import crypto from 'crypto';
import axios from 'axios';
import type { Express, Request, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { doc, getDoc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { getSecretValue } from '../lib/secrets';
import { verifyPaymentInternal } from '../lib/payments';
import { verifyFirebaseToken } from '../lib/authMiddleware';

/**
 * Payment routes (Cashfree order creation, verification, webhook, coupon redeem)
 * extracted from the server.ts monolith (Phase 1). Behavior unchanged. The
 * payment rate limiter is injected so its config stays owned by the bootstrap.
 */
export function registerPaymentRoutes(app: Express, paymentLimiter: RateLimitRequestHandler): void {
  app.post('/api/payment/create-order', paymentLimiter, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { amount, userId, userEmail, userName, userPhone, isVishwakarmaOrder, buyPass, tokenAmount } = req.body;
    if (!userId) return res.status(400).json({ error: 'User is not authenticated' });
    const orderAmount = parseFloat(amount);
    if (isNaN(orderAmount) || orderAmount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
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
    if (!orderId) return res.status(400).json({ error: 'Order ID is required' });

    const result = await verifyPaymentInternal(orderId);
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(400).json({ error: result.error });
    }
  });

  app.post('/api/payment/webhook', async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const body = JSON.stringify(req.body);

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

      // Compute multiple plausible formats to be extremely robust against API version variations
      const signatureDataWithTimestamp = ts + body;
      const expectedV2 = crypto.createHmac('sha256', secret).update(signatureDataWithTimestamp).digest('base64');
      const expectedV1Base64 = crypto.createHmac('sha256', secret).update(body).digest('base64');
      const expectedV1Hex = crypto.createHmac('sha256', secret).update(body).digest('hex');

      const isSignatureValid = (signature === expectedV2) || (signature === expectedV1Base64) || (signature === expectedV1Hex);

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
      return res.status(500).json({ error: error.message });
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
      return res.status(500).json({ error: err.message });
    }
  });
}
