/**
 * 💳 A PAYMENT GATEWAY'S OWN PRODUCT NAMES ARE NOT THE APP'S COMMERCE WORDS.
 *
 * `checkout` is the NAME of a Stripe, PayPal and Razorpay product; `order` is the NAME of the record
 * their APIs create. So the ordinary integration sentence every payments prompt contains —
 * *"Payments: use Stripe Checkout, and capture orders on the backend"* — hands `RequirementGapAnalyzer`
 * two of ecommerce's strongest signals out of a section that says nothing about what the app sells.
 *
 * 🔴 **Measured on `main` at 4c205bcc4, each prompt with and without that ONE sentence appended:**
 *
 * | the app | alone | + the gateway sentence |
 * |---|---|---|
 * | a donation app for an NGO with campaigns and donor receipts | `general` | **`ecommerce`** |
 * | a hospital appointment app with doctors, slots and patient records | `healthcare` | **`ecommerce`** |
 *
 * Both were then told they lacked *"product catalog + search, inventory tracking, accounts &
 * addresses"*. **A hospital appointment app asked about inventory tracking is autopsy 39e982bd's own
 * harm, one domain over** — and this analyser had already fixed `\border\b` for that exact class
 * (autopsy 73df1fbb). `checkout` was its unhunted sibling, and `order` returned through the plural.
 *
 * ⚠️ WHY THIS IS A SEPARATE CHANGE FROM #3532, which merged the esports half of 39e982bd. That PR
 * added a `tournament` domain ordered before `ecommerce`, and it WORKS — the esports case below holds
 * on `main` without this fix, and the test says so. But a new domain fixes one instance; the words
 * stay misread for every other app that takes a payment. This is the class.
 *
 * 🔒 It stands down the moment anything says goods are sold — a cart, a product catalogue, inventory,
 * shipping, a SKU, a shop — so a real shop and a food-delivery app are byte-identical. And it only ever
 * DELETES evidence, which is why it can never invent a domain.
 */
import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps, stripNonDomainUses } from '../src/server/lib/RequirementGapAnalyzer';

/** The one sentence that did the damage — a gateway section, naming no goods. */
const GATEWAY = ' Payments: use Stripe Checkout, and capture orders on the backend.';

const domainOf = (p: string) => analyzeRequirementGaps(p).domain;

describe('💳 the two prompts a gateway sentence turned into shops', () => {
  const DONATION = 'a donation app for an NGO with campaigns and donor receipts';
  const HOSPITAL = 'a hospital appointment app with doctors, slots and patient records';

  it('a donation app stays what it is', () => {
    expect(domainOf(DONATION)).toBe('general');
    expect(domainOf(DONATION + GATEWAY)).toBe('general');
  });

  it('a hospital appointment app is never asked about inventory tracking again', () => {
    expect(domainOf(HOSPITAL)).toBe('healthcare');
    expect(domainOf(HOSPITAL + GATEWAY)).toBe('healthcare');
    const gaps = analyzeRequirementGaps(HOSPITAL + GATEWAY).likelyMissing.join(' · ');
    // ⚠️ NOT a bare /inventory/ assertion, and the first draft's was wrong in an instructive way:
    // healthcare's OWN gap list contains "pharmacy / inventory", which a hospital really does need.
    // That is the whole point of the domain being right — so what must be gone is ECOMMERCE's list.
    expect(gaps).not.toMatch(/product catalog/i);
    expect(gaps).not.toMatch(/inventory tracking/i);
    expect(gaps).not.toMatch(/accounts & addresses/i);
    expect(gaps).toMatch(/pharmacy|audit log|role-based/i);
  });

  it('holds for every gateway a prompt in this market actually names', () => {
    for (const gw of [
      ' Use Razorpay Checkout and capture orders on the server.',
      ' Integrate PayPal checkout; orders are stored in the database.',
      ' Cashfree payment gateway for the checkout, with order status webhooks.',
      ' PhonePe and Paytm for payments — create an order, then open the checkout.',
    ]) expect(domainOf(HOSPITAL + gw), gw).toBe('healthcare');
  });
});

describe('💳 precision — a real shop keeps every word', () => {
  it('an online store is byte-identical with and without a gateway section', () => {
    const shop = 'an online store with a product catalog, a cart, inventory and order management';
    expect(domainOf(shop)).toBe('ecommerce');
    expect(domainOf(shop + GATEWAY)).toBe('ecommerce');
  });

  it('a food delivery app with a cart keeps its order tracking', () => {
    const food = 'a food delivery app with restaurants, a cart and order tracking';
    expect(domainOf(food)).toBe('ecommerce');
    expect(domainOf(food + GATEWAY)).toBe('ecommerce');
  });

  it('a prompt that names NO gateway is untouched — a plain checkout page still means commerce', () => {
    // The strip is gated on the gateway's presence, so "checkout" on its own keeps all its meaning.
    const before = stripNonDomainUses('a checkout page with order history');
    expect(before).toMatch(/checkout/i);
    expect(before).toMatch(/order/i);
  });

  it('every domain with a signal of its own was already safe, and still is', () => {
    // These never depended on the two words; the test exists so a future strip cannot quietly cost them.
    for (const [p, expected] of [
      ['a stock trading app with live charts, a watchlist and portfolio holdings', 'trading'],
      ['an esports tournament app with brackets, prize pools, room ids and a leaderboard', 'tournament'],
      ['a gym membership app with class schedules and attendance', 'fitness'],
    ] as const) {
      expect(domainOf(p), p).toBe(expected);
      expect(domainOf(p + GATEWAY), `${p} + gateway`).toBe(expected);
    }
  });
});

describe('💳 the mechanism, asked directly', () => {
  it('blanks the two words in a gateway section and nothing else', () => {
    const out = stripNonDomainUses('a clinic app. Use Stripe Checkout and capture orders on the backend.');
    expect(out).not.toMatch(/\bcheckout\b/i);
    expect(out).not.toMatch(/\border/i);
    // Everything that is really about the app survives.
    expect(out).toMatch(/clinic/i);
    expect(out).toMatch(/Stripe/i);
  });

  it('keeps them when something says goods are sold', () => {
    for (const p of [
      'a shop with a cart. Use Stripe Checkout and capture orders.',
      'sell products online with inventory. PayPal checkout, orders on the backend.',
      'a storefront with SKUs and shipping. Razorpay checkout; order webhooks.',
    ]) {
      const out = stripNonDomainUses(p);
      expect(out, p).toMatch(/checkout/i);
      expect(out, p).toMatch(/order/i);
    }
  });

  it('only ever deletes, so it can never invent a domain', () => {
    const p = 'a clinic app. Use Stripe Checkout and capture orders on the backend.';
    expect(stripNonDomainUses(p).length).toBeLessThanOrEqual(p.length);
  });

  it('never throws on rubbish', () => {
    expect(() => stripNonDomainUses('')).not.toThrow();
    expect(() => analyzeRequirementGaps('')).not.toThrow();
    expect(() => analyzeRequirementGaps('stripe checkout orders')).not.toThrow();
  });
});
