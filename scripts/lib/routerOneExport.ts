/** Offline observations only. This module cannot create accepted receipts or wallet decisions. */
export const ROUTER_ONE_EXPORT_HEADERS = [
  'Time (Asia/Kolkata)', 'Request ID', 'Model', 'API key', 'API key ID', 'Status code',
  'Input tokens', 'Output tokens', 'Cache read tokens', 'Cache write tokens', 'Total tokens',
  'Cost (USD)', 'TTFT (ms)', 'Latency (ms)', 'Error', 'Charge source', 'Wallet charged (USD)', 'Plan quota units',
] as const;

type Amount = { kind: 'unknown' } | { kind: 'reported'; microUsd: string } | { kind: 'invalid' };
export interface UnverifiedRouterOneExport {
  kind: 'unverified-export';
  billingAuthorized: false;
  errors: string[];
  observations: Array<{
    record: number;
    requestId: string;
    keyId: string;
    model: string;
    statusCode: string;
    chargeSource: string;
    wallet: Amount;
    state: 'unverified' | 'duplicate' | 'quarantined';
    reasons: string[];
  }>;
}

// Six decimal places are an explicit supported precision, never rounded silently.
function amount(value: string): Amount {
  if (value === '' || value === 'null') return { kind: 'unknown' };
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value)) return { kind: 'invalid' };
  const [whole, fraction = ''] = value.split('.');
  return { kind: 'reported', microUsd: (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString() };
}

/** Strict RFC-style quoting; malformed syntax rejects the entire file, without raw data in errors. */
function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const finish = () => { row.push(cell); cell = ''; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      finish();
      if (ch !== ',') {
        rows.push(row); row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (ch === '"' && cell === '' && !closed) quoted = true;
    else {
      if (ch === '"' || closed) throw new Error('invalid-csv');
      cell += ch;
    }
  }
  if (quoted) throw new Error('invalid-csv');
  if (cell || closed || row.length) { finish(); rows.push(row); }
  return rows;
}

export function validateRouterOneExport(text: string): UnverifiedRouterOneExport {
  const result: UnverifiedRouterOneExport = { kind: 'unverified-export', billingAuthorized: false, errors: [], observations: [] };
  if (text.length > 2_000_000) { result.errors.push('file-too-large'); return result; }
  let rows: string[][];
  try { rows = csv(text.replace(/^\uFEFF/, '')); }
  catch { result.errors.push('invalid-csv'); return result; }
  const headers = rows.shift() ?? [];
  if (headers.length !== ROUTER_ONE_EXPORT_HEADERS.length || new Set(headers).size !== headers.length ||
      ROUTER_ONE_EXPORT_HEADERS.some(h => !headers.includes(h))) {
    result.errors.push('unsupported-schema'); return result;
  }
  if (rows.length > 10_000) { result.errors.push('too-many-records'); return result; }
  const groups = new Map<string, { signature: string; indexes: number[]; conflict: boolean }>();
  rows.forEach((row, index) => {
    const get = (name: typeof ROUTER_ONE_EXPORT_HEADERS[number]) => row[headers.indexOf(name)] ?? '';
    const reasons: string[] = [];
    if (row.length !== headers.length) reasons.push('column-count');
    const requestId = get('Request ID'), keyId = get('API key ID'), model = get('Model');
    if (![requestId, keyId, model].every(v => /^[A-Za-z0-9_.:/-]{1,256}$/.test(v))) reasons.push('invalid-identity');
    if (!/^[1-5]\d\d$/.test(get('Status code'))) reasons.push('invalid-status');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(get('Time (Asia/Kolkata)'))) reasons.push('invalid-time');
    for (const name of ['Input tokens', 'Output tokens', 'Cache read tokens', 'Cache write tokens', 'Total tokens'] as const) {
      if (!/^(0|[1-9]\d{0,14})$/.test(get(name))) reasons.push('invalid-token-count');
    }
    if (!['Wallet', 'Plan'].includes(get('Charge source'))) reasons.push('unconfirmed-charge-source');
    const wallet = amount(get('Wallet charged (USD)'));
    if (wallet.kind === 'invalid') reasons.push('invalid-wallet-amount');
    if (wallet.kind === 'unknown') reasons.push('unknown-wallet-amount');
    if (get('Charge source') === 'Plan' && wallet.kind === 'reported' && wallet.microUsd !== '0') reasons.push('plan-wallet-conflict');
    const observation: UnverifiedRouterOneExport['observations'][number] = {
      record: index + 2, requestId, keyId, model, statusCode: get('Status code'), chargeSource: get('Charge source'), wallet,
      state: reasons.length ? 'quarantined' : 'unverified', reasons,
    };
    result.observations.push(observation);
    // File-local identity only: account identity and cross-import idempotency are NOT established.
    if (requestId && keyId) {
      const identity = JSON.stringify([keyId, requestId]);
      const signature = JSON.stringify(row); // Conservative: any differing evidence quarantines all versions.
      const previous = groups.get(identity);
      if (!previous) groups.set(identity, { signature, indexes: [index], conflict: false });
      else {
        previous.indexes.push(index);
        previous.conflict ||= previous.signature !== signature;
        if (previous.conflict) for (const n of previous.indexes) {
          const item = result.observations[n]; item.state = 'quarantined';
          if (!item.reasons.includes('conflicting-records')) item.reasons.push('conflicting-records');
        }
        else if (!reasons.length) observation.state = 'duplicate';
      }
    }
  });
  return result;
}
