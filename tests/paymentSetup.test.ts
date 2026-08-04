import { describe, it, expect } from 'vitest';
import {
  generatePayment, paymentEnvKeys, isValidUpiId, PAY_METHODS, methodSpec,
  missingRequiredFields, candidatePages,
} from '../src/lib/paymentSetup';

// The Razorpay tests below encode a real, exploitable defect that shipped: the generated integration
// took its amount from `window.payAmount` and treated the browser's success callback as proof of
// payment, with no order_id and no signature check. A customer could set the price to 1 rupee, or
// call the handler and pay nothing. These tests exist so that can never come back.

describe('Razorpay — the flaw that made a shop defraudable', () => {
  const gen = generatePayment('razorpay', { keyId: 'rzp_live_abc123' });

  it('the amount is NEVER taken from a browser variable', () => {
    expect(gen.html).not.toContain('window.payAmount');
    expect(gen.html).not.toMatch(/amount\s*:/);
    // The price lives on the server instead.
    expect(gen.server).toContain('PRICES');
    expect(gen.server).toContain('Never take an amount from the browser');
  });

  it('the order is created on the SERVER and carries an order_id', () => {
    expect(gen.html).toContain('/api/create-order');
    expect(gen.html).toContain('order_id: order.id');
    expect(gen.server).toContain('razorpay.orders.create');
  });

  it('the signature is verified on the server with HMAC-SHA256 — the only real proof', () => {
    expect(gen.server).toContain("createHmac('sha256'");
    expect(gen.server).toContain('razorpay_order_id');
    expect(gen.server).toContain('razorpay_payment_id');
    expect(gen.server).toContain('RAZORPAY_KEY_SECRET');
  });

  it('the browser callback is explicitly NOT treated as proof', () => {
    expect(gen.html).toContain('/api/verify-payment');
    expect(gen.html).toMatch(/NOT proof of payment/i);
    // The old version simply alerted "Payment successful!" and believed it.
    expect(gen.html).not.toMatch(/alert\(["']Payment successful/);
  });

  it('compares the signature in constant time, so it cannot be guessed byte by byte', () => {
    expect(gen.server).toContain('timingSafeEqual');
  });

  it('the KEY SECRET never appears in anything sent to a browser', () => {
    const withSecret = generatePayment('razorpay', { keyId: 'rzp_live_abc', keySecret: 'super_secret_value' });
    expect(withSecret.html).not.toContain('super_secret_value');
    // The server file references it by environment variable, never by value.
    expect(withSecret.server).not.toContain('super_secret_value');
    expect(withSecret.server).toContain('process.env.RAZORPAY_KEY_SECRET');
  });

  it('the public Key Id IS in the page — that one is public by design', () => {
    expect(gen.html).toContain('rzp_live_abc123');
  });
});

describe('Cashfree follows the same shape', () => {
  const gen = generatePayment('cashfree', { appId: 'app_123' });

  it('creates the order server-side and never prices in the browser', () => {
    expect(gen.html).toContain('/api/create-order');
    expect(gen.html).not.toMatch(/order_amount\s*:/);
    expect(gen.server).toContain('PRICES');
  });

  it('confirms the payment with Cashfree rather than trusting the browser', () => {
    expect(gen.server).toContain('order-status');
    expect(gen.server).toMatch(/never trust what the browser reports/i);
  });

  it('keeps the secret key on the server', () => {
    const withSecret = generatePayment('cashfree', { appId: 'a', secretKey: 'cf_secret_xyz' });
    expect(withSecret.html).not.toContain('cf_secret_xyz');
    expect(withSecret.server).toContain('process.env.CASHFREE_SECRET_KEY');
  });
});

describe('Stripe replaces the old copy-paste block, and prices on the server too', () => {
  const gen = generatePayment('stripe', { publishableKey: 'pk_live_abc' });

  it('creates the Checkout Session server-side, never in the browser', () => {
    expect(gen.html).toContain('/api/create-order');
    expect(gen.html).not.toMatch(/unit_amount/);
    expect(gen.server).toContain('checkout.sessions.create');
    expect(gen.server).toContain('PRICES');
  });

  it('confirms payment by asking Stripe, because anyone can open the success URL', () => {
    expect(gen.server).toContain('payment_status');
    expect(gen.server).toMatch(/never trust what the browser reports/i);
  });

  it('keeps the secret key on the server and puts only the publishable key in the page', () => {
    const withSecret = generatePayment('stripe', { publishableKey: 'pk_live_abc', secretKey: 'sk_live_danger' });
    expect(withSecret.html).toContain('pk_live_abc');
    expect(withSecret.html).not.toContain('sk_live_danger');
    expect(withSecret.server).toContain('process.env.STRIPE_SECRET_KEY');
    expect(withSecret.server).not.toContain('sk_live_danger');
  });

  it('says plainly that Stripe cannot take Indian UPI', () => {
    expect(gen.nextSteps.join(' ')).toMatch(/UPI/);
    expect(methodSpec('stripe').summary).toMatch(/UPI/i);
  });
});

describe('UPI — the simple one, and honest about its limit', () => {
  it('builds a real UPI intent link', () => {
    const gen = generatePayment('upi', { upiId: 'ravi@okaxis', payeeName: 'Ravi Store' }, '499');
    expect(gen.html).toContain('upi://pay');
    expect(gen.html).toContain('pa=ravi%40okaxis');
    expect(gen.html).toContain('am=499');
    expect(gen.html).toContain('cu=INR');
  });

  it('needs no server at all — that is the whole point', () => {
    const gen = generatePayment('upi', { upiId: 'ravi@okaxis' });
    expect(gen.server).toBeUndefined();
    expect(methodSpec('upi').noServerNeeded).toBe(true);
    expect(methodSpec('upi').fields.filter((f) => !f.optional)).toHaveLength(1);
  });

  it('SAYS that UPI cannot confirm a payment automatically, instead of implying it can', () => {
    const gen = generatePayment('upi', { upiId: 'ravi@okaxis' });
    expect(gen.nextSteps.join(' ')).toMatch(/does not tell your website/i);
    expect(gen.nextSteps.join(' ')).toMatch(/check your bank/i);
  });

  it('escapes a payee name so it cannot break out of the link', () => {
    const gen = generatePayment('upi', { upiId: 'a@b', payeeName: 'Ravi" onclick="steal()' });
    expect(gen.html).not.toContain('onclick="steal()');
  });
});

describe('isValidUpiId — catching a typo before a customer hits it', () => {
  it('accepts real UPI ids', () => {
    for (const id of ['ravi@okaxis', 'ravi.kumar@ybl', 'shop-1@paytm', '9876543210@upi']) {
      expect(isValidUpiId(id), id).toBe(true);
    }
  });

  it('rejects what a user commonly mistypes', () => {
    for (const id of ['ravi', 'ravi@', '@okaxis', 'ravi@@okaxis', 'ravi@ok axis', '', 'ravi@123']) {
      expect(isValidUpiId(id), id).toBe(false);
    }
  });
});

describe('paymentEnvKeys — one vault, predictable names', () => {
  it('marks the browser-safe values with VITE_ and leaves secrets unprefixed', () => {
    const keys = paymentEnvKeys('razorpay', { keyId: 'rzp_live_x', keySecret: 's3cret' });
    // A Razorpay Key Id is public by design; the secret is not, and the naming has to say so.
    expect(keys.VITE_RAZORPAY_KEY_ID).toBe('rzp_live_x');
    expect(keys.RAZORPAY_KEY_SECRET).toBe('s3cret');
    expect(Object.keys(keys).some((k) => k.startsWith('VITE_') && /SECRET/i.test(k))).toBe(false);
  });

  it('never marks a secret as browser-safe, for any method', () => {
    const all = [
      paymentEnvKeys('upi', { upiId: 'a@b' }),
      paymentEnvKeys('razorpay', { keyId: 'k', keySecret: 's' }),
      paymentEnvKeys('cashfree', { appId: 'a', secretKey: 's' }),
      paymentEnvKeys('adsense', { publisherId: 'p', slotId: 's' }),
    ];
    for (const keys of all) {
      for (const name of Object.keys(keys)) {
        if (name.startsWith('VITE_')) expect(name, name).not.toMatch(/SECRET/i);
      }
    }
  });

  it('uses the same env-var style the Database screen already writes', () => {
    expect(paymentEnvKeys('upi', { upiId: 'a@b' }).VITE_UPI_ID).toBe('a@b');
    expect(paymentEnvKeys('adsense', { publisherId: 'ca-pub-1', slotId: '2' }).VITE_ADSENSE_PUBLISHER_ID).toBe('ca-pub-1');
  });
});

describe('the method list a user chooses from', () => {
  it('puts UPI first, because it is the one that needs nothing', () => {
    expect(PAY_METHODS[0].id).toBe('upi');
    expect(PAY_METHODS[0].cost).toMatch(/free/i);
  });

  it('every method says what it costs and whether a server is needed', () => {
    for (const m of PAY_METHODS) {
      expect(m.cost.length, m.id).toBeGreaterThan(5);
      expect(typeof m.noServerNeeded, m.id).toBe('boolean');
      expect(m.summary.length, m.id).toBeGreaterThan(20);
    }
  });

  it('tells the user where in the provider dashboard each value lives', () => {
    for (const m of PAY_METHODS) {
      for (const f of m.fields) {
        if (!f.optional) expect(f.where, `${m.id}.${f.key}`).toBeTruthy();
      }
    }
  });

  it('marks exactly the fields that must never reach a browser', () => {
    expect(methodSpec('razorpay').fields.find((f) => f.key === 'keySecret')?.secret).toBe(true);
    expect(methodSpec('razorpay').fields.find((f) => f.key === 'keyId')?.secret).toBeUndefined();
    expect(methodSpec('upi').fields.some((f) => f.secret)).toBe(false);
  });
});

describe('the gates the wizard puts in front of "Add it to my app"', () => {
  it('will not let an empty UPI ID through — that link opens a payment app with no payee', () => {
    expect(missingRequiredFields('upi', {})).toEqual(['Your UPI ID']);
    expect(missingRequiredFields('upi', { upiId: '  ' })).toHaveLength(1);
    expect(missingRequiredFields('upi', { upiId: 'ravi@okaxis' })).toHaveLength(0);
  });

  it('does not demand the optional fields', () => {
    // "Name to show" is optional, so a filled UPI ID alone is enough.
    expect(missingRequiredFields('upi', { upiId: 'a@b' })).toHaveLength(0);
  });

  it('names every missing field, so the user is not told one at a time', () => {
    expect(missingRequiredFields('razorpay', {})).toEqual(['Key ID', 'Key Secret']);
    expect(missingRequiredFields('razorpay', { keyId: 'k' })).toEqual(['Key Secret']);
  });
});

describe('candidatePages — where a payment button belongs', () => {
  it('offers the home page first, not whatever sorts first', () => {
    expect(candidatePages(['about.html', 'index.html', 'contact.html'])[0]).toBe('index.html');
    expect(candidatePages(['pages/a.html', 'public/index.htm'])[0]).toBe('public/index.htm');
  });

  it('keeps every other page as a choice', () => {
    expect(candidatePages(['about.html', 'index.html'])).toEqual(['index.html', 'about.html']);
  });

  it('leaves out files a button cannot go on', () => {
    expect(candidatePages(['app.js', 'style.css', 'logo.png', 'index.html'])).toEqual(['index.html']);
    expect(candidatePages(['app.js'])).toEqual([]);
  });
});

describe('AdSense', () => {
  it('produces a real ad unit and is honest that approval takes days', () => {
    const gen = generatePayment('adsense', { publisherId: 'ca-pub-123', slotId: '456' });
    expect(gen.html).toContain('adsbygoogle');
    expect(gen.html).toContain('ca-pub-123');
    expect(gen.nextSteps.join(' ')).toMatch(/approved/i);
    expect(gen.server).toBeUndefined();
  });
});
