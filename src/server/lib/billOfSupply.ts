/**
 * Go-live PR 15 — usage metering and the non-GST "Bill of Supply" receipt.
 *
 * O-9: NavBharatAI has no GST registration, so a receipt must NOT show GSTIN, tax lines, HSN/SAC or
 * the words "Tax Invoice". It is a "Bill of Supply" with the plain total. All maths in integer paise.
 * PURE: no DB, no clock (pass `issuedAt`), no env except the METERING_V1 gate helper. Not wired:
 * the purchase and monthly-usage paths call this once METERING_V1 is on (default OFF).
 */
import { envFlag } from './envFlag';
import { OVERAGE_PAISE_PER_GB, rupees, skuById } from '../../lib/catalogue';

export function meteringEnabled(): boolean {
  return envFlag('METERING_V1');
}

export interface UsageSample {
  appId: string;
  /** Bytes served in the sample window. */
  bytes: number;
}

export interface BillLine {
  description: string;
  quantity: number;
  unit: string;
  unitPaise: number;
  amountPaise: number;
}

const GB = 1024 ** 3;

/** Traffic above the plan's included GB, rounded UP to whole GB (a partial GB is a GB). */
export function meterTraffic(samples: readonly UsageSample[], includedGb: number): BillLine | null {
  const total = samples.reduce((s, x) => s + (Number.isFinite(x.bytes) && x.bytes > 0 ? x.bytes : 0), 0);
  const overGb = Math.max(0, Math.ceil(total / GB) - Math.max(0, Math.floor(includedGb)));
  if (overGb === 0) return null;
  return { description: 'Extra traffic', quantity: overGb, unit: 'GB', unitPaise: OVERAGE_PAISE_PER_GB, amountPaise: overGb * OVERAGE_PAISE_PER_GB };
}

export function skuLine(skuId: string, quantity = 1): BillLine {
  const sku = skuById(skuId);
  if (!sku) throw new Error(`unknown SKU ${skuId}`);
  const q = Math.max(1, Math.floor(quantity));
  return { description: sku.name, quantity: q, unit: sku.period === '30d' ? '30 days' : 'each', unitPaise: sku.pricePaise, amountPaise: q * sku.pricePaise };
}

export interface BillOfSupply {
  title: 'Bill of Supply';
  number: string;
  issuedAt: string;
  customer: { id: string; name: string | null; email: string | null };
  lines: BillLine[];
  totalPaise: number;
  note: string;
}

export function billNumber(issuedAt: Date, seq: number): string {
  const y = issuedAt.getUTCFullYear(), m = String(issuedAt.getUTCMonth() + 1).padStart(2, '0');
  return `NB-BOS-${y}${m}-${String(Math.max(0, Math.floor(seq))).padStart(6, '0')}`;
}

export function buildBillOfSupply(input: {
  seq: number; issuedAt: Date; customer: BillOfSupply['customer']; lines: BillLine[];
}): BillOfSupply {
  const lines = input.lines.filter((l) => l.amountPaise > 0 || l.unitPaise === 0);
  return {
    title: 'Bill of Supply',
    number: billNumber(input.issuedAt, input.seq),
    issuedAt: input.issuedAt.toISOString(),
    customer: input.customer,
    lines,
    totalPaise: lines.reduce((s, l) => s + l.amountPaise, 0),
    note: 'Supplier not registered under GST. No tax is charged.',
  };
}

export function renderBillText(b: BillOfSupply): string {
  const rows = b.lines.map((l) => `${l.description} — ${l.quantity} ${l.unit} × ${rupees(l.unitPaise)} = ${rupees(l.amountPaise)}`);
  return [b.title, `No. ${b.number}`, `Date ${b.issuedAt.slice(0, 10)}`, `To ${b.customer.name ?? b.customer.email ?? b.customer.id}`, '', ...rows, '', `Total ${rupees(b.totalPaise)}`, b.note].join('\n');
}
