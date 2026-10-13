import { describe, it, expect } from 'vitest';
import { buildBillOfSupply, meterTraffic, renderBillText, skuLine, billNumber } from '../src/server/lib/billOfSupply';
import { OVERAGE_PAISE_PER_GB, SKUS } from '../src/lib/catalogue';

const GB = 1024 ** 3;
const at = new Date('2026-10-13T10:00:00Z');
const cust = { id: 'u1', name: 'Asha', email: null };

describe('metering + Bill of Supply (PR 15)', () => {
  it('traffic within the plan is not billed; a partial extra GB is one GB', () => {
    expect(meterTraffic([{ appId: 'a', bytes: 2 * GB }], 5)).toBeNull();
    const l = meterTraffic([{ appId: 'a', bytes: 5 * GB }, { appId: 'b', bytes: 1 }], 5)!;
    expect(l.quantity).toBe(1);
    expect(l.amountPaise).toBe(OVERAGE_PAISE_PER_GB);
  });
  it('bad samples count as zero', () => {
    expect(meterTraffic([{ appId: 'a', bytes: -9 }, { appId: 'b', bytes: NaN }], 0)).toBeNull();
  });
  it('the receipt never mentions GST tax lines or a Tax Invoice', () => {
    const plan = SKUS.find((s) => s.category === 'plan' && s.pricePaise > 0)!;
    const b = buildBillOfSupply({ seq: 42, issuedAt: at, customer: cust, lines: [skuLine(plan.id)] });
    const txt = renderBillText(b);
    expect(b.title).toBe('Bill of Supply');
    expect(txt).not.toMatch(/GSTIN|CGST|SGST|IGST|HSN|SAC|Tax Invoice|18%/i);
    expect(b.totalPaise).toBe(plan.pricePaise);
    expect(Number.isInteger(b.totalPaise)).toBe(true);
  });
  it('numbers are stable and sortable', () => {
    expect(billNumber(at, 42)).toBe('NB-BOS-202610-000042');
  });
  it('unknown SKU throws instead of billing ₹0', () => {
    expect(() => skuLine('nope')).toThrow();
  });
});
