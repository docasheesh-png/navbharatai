import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { Cashfree } from 'cashfree-pg';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. Writes payment_transactions (server-only).
import { doc, setDoc, getServerDb as getDb } from '../lib/serverDb';

/**
 * Legacy `/api/create-order` endpoint (direct Cashfree PGCreateOrder) extracted
 * from the server.ts monolith (Phase 1). Behavior unchanged. The primary payment
 * flow lives in routes/payment.ts; this is the older standalone order creator.
 */
export function registerCreateOrderRoute(app: Express): void {
  app.post('/api/create-order', async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { orderAmount, orderCurrency, customerId, customerPhone, customerEmail, customerName, userId } = req.body;
      const finalAmount = Number(orderAmount);
      const orderId = `order_${crypto.randomBytes(8).toString('hex')}`;

      // Ensure alphanumeric customer_id (Cashfree requirement)
      const sanitizedCustomerId = (customerId || 'customer123').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

      const request = {
        order_id: orderId,
        order_amount: parseFloat(finalAmount.toFixed(2)),
        order_currency: orderCurrency || "INR",
        customer_details: {
          customer_id: sanitizedCustomerId,
          customer_name: (customerName || "Customer").substring(0, 50),
          customer_phone: (customerPhone || "9999999999").substring(0, 15),
          customer_email: (customerEmail || "test@test.com")
        },
      };

      const response = await (Cashfree as any).PGCreateOrder("2023-08-01", request);

      await setDoc(doc(db, 'payment_transactions', orderId), {
          userId,
          amountPaid: parseFloat(finalAmount.toFixed(2)),
          createdAt: new Date().toISOString(),
          paymentStatus: 'PENDING'
      });

      res.json(response.data);
    } catch (error: any) {
      console.error('[CASHFREE] Order creation failed:', JSON.stringify(error.response?.data || error.message, null, 2));
      res.status(500).json({
        error: "Failed to create order",
        details: error.response?.data || error.message
      });
    }
  });
}
