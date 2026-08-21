import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Admin 2026-08-21: *"publish on navbharatai me se free tag hatao"* and *"connect your own domain me
 * bracket me charge likho."*
 *
 * The two are the same request from opposite ends: the card said FREE at the top while offering a PAID
 * custom domain inside it, so the badge read as a promise about the whole card and the one genuinely
 * priced action carried no price at all.
 */
const chooser = readFileSync(join(__dirname, '..', 'src/components/agentv3/HostingChooser.tsx'), 'utf8');
const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('the publish card no longer promises "Free"', () => {
  it('the badge is gone', () => {
    expect(chooser).not.toContain('rounded-full">Free</span>');
  });

  it('the card itself is untouched otherwise', () => {
    // Removing a label must not quietly remove the option.
    expect(chooser).toContain('Host on NavBharatAI');
    expect(chooser).toContain('Publish on NavBharatAI');
  });
});

describe('the domain button states its real price', () => {
  it('renders the price in brackets when there is one', () => {
    expect(chooser).toContain('Connect your own domain{typeof customDomainPriceInr === \'number\'');
    expect(chooser).toContain('(₹${customDomainPriceInr}/month)');
  });

  it('shows NOTHING when the user would not be charged', () => {
    // A free-list account is exempt, and quoting them ₹99 would be a small lie on a money surface.
    // The server sends null for them; the client must render an empty string, never a fallback price.
    expect(chooser).toContain("=== 'number' ? ` (₹${customDomainPriceInr}/month)` : ''");
  });

  it('the price is SERVER-supplied, never hardcoded in the UI', () => {
    // An env price change (HOSTING_PLAN_PRICE_INR) must not need a deploy, and the label must never
    // drift from what the connect route actually charges.
    expect(route).toContain('customDomainPriceInr: hostingPlansEnabled() && !isAgentV3FreeUser(userId, email)');
    expect(route).toContain('? hostingPlanPriceInr()');
    expect(chooser).not.toMatch(/₹\s*99/);
  });

  it('an older server that omits the field leaves the label off rather than inventing one', () => {
    expect(panel).toContain("typeof data.customDomainPriceInr === 'number' ? data.customDomainPriceInr : null");
  });

  it('the value is threaded all the way from the fetch to the button', () => {
    expect(panel).toContain('customDomainPriceInr={customDomainPriceInr}');
    expect(chooser).toContain('customDomainPriceInr?: number | null;');
  });
});
