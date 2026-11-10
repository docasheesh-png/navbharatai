import { createHash } from 'node:crypto';
import { qubaxPriceFeedRequest } from './qubaxPriceFeedNetwork';

/** Public observations only. This module cannot write reviewed dispatch authority. */
export const QUBAX_PRICE_FEED_TTL_MS = 300_000;
export const QUBAX_PRICE_FEED_INTERVAL_MS = 240_000;
export const QUBAX_PRICE_FEED_FETCH_MS = 10_000;
export const QUBAX_PRICE_FEED_MAX_BYTES = 2_000_000;
export const QUBAX_PRICE_FEED_MAX_SNAPSHOT_BYTES = 750_000;
export const QUBAX_PRICE_SOURCES = Object.freeze({
  qubax: 'https://api.qubax.ai/v1/market/models',
});
/** Kept only so an old page can still be inspected. Collection never fetches these, so a stale page cannot block a Qubax publish. */
const DEMOTED_PRICE_PAGES = Object.freeze({
  openai: 'https://developers.openai.com/api/docs/pricing.md',
  zai: 'https://docs.z.ai/guides/overview/pricing.md',
});
export type QubaxPriceSource = keyof typeof QUBAX_PRICE_SOURCES | keyof typeof DEMOTED_PRICE_PAGES;
const SOURCE_IDS = Object.keys(QUBAX_PRICE_SOURCES) as Array<keyof typeof QUBAX_PRICE_SOURCES>;
const KIND = 'qubax-public-price-observations-v1' as const;
const PARSER = 'qubax-public-price-parser-v1';
const MAX_ROWS = 2_000;
const fail = (): never => { throw new Error('QUBAX_PRICE_FEED_UNAVAILABLE'); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f]/.test(v);
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');

export interface QubaxObservedPrice {
  /** Original source label, NOT a reviewed alias or a dispatch identifier. */
  sourceModelLabel: string;
  modality: 'text' | 'multimodal';
  contextTokens: number | null;
  contextBand: 'short' | 'long' | 'unspecified';
  serviceTier: 'standard' | 'unspecified';
  currency: 'USD';
  billingBasis: 'per-million-tokens';
  inputNanoUsd: number | null;
  outputNanoUsd: number | null;
  cacheReadNanoUsd: number | null;
  cacheWrite30mNanoUsd: number | null;
  cacheWrite12hNanoUsd: number | null;
  cacheStorage: 'unknown' | 'limited-time-free';
  /** Hundredths of a percent from Qubax discount_pct. 9000 means 90.00%. Null means the field was absent or unreadable. */
  discountHundredths: number | null;
  requests24h: number | null;
  /** Null in this observation contract ALWAYS means unknown, never zero/unavailable. */
  revision: null;
  tokenizer: null;
  sku: null;
  region: null;
  allFeesIncluded: null;
}
export interface QubaxPriceSourceSnapshot {
  source: QubaxPriceSource;
  url: string;
  parser: typeof PARSER;
  bodySha256: string;
  startedAtMs: number;
  observedAtMs: number;
  httpDateMs: number;
  httpAgeSeconds: number | null;
  sourceUpdatedAtMs: number | null;
  expiresAtMs: number;
  coverage: 'market-text-token-rows' | 'flagship-standard-only' | 'latest-and-current-text-only';
  rows: QubaxObservedPrice[];
}
export interface QubaxPriceSnapshot {
  kind: typeof KIND;
  version: string;
  startedAtMs: number;
  observedAtMs: number;
  expiresAtMs: number;
  canDispatch: false;
  proofStatus: 'unreviewed';
  sources: QubaxPriceSourceSnapshot[];
}
const emptyPrice = (label: string): QubaxObservedPrice => ({ sourceModelLabel: label, modality: 'text', contextTokens: null,
  contextBand: 'unspecified', serviceTier: 'unspecified', currency: 'USD', billingBasis: 'per-million-tokens',
  inputNanoUsd: null, outputNanoUsd: null, cacheReadNanoUsd: null, cacheWrite30mNanoUsd: null, cacheWrite12hNanoUsd: null,
  cacheStorage: 'unknown', discountHundredths: null, requests24h: null, revision: null, tokenizer: null, sku: null, region: null, allFeesIncluded: null });

/** Decimal lexemes, not binary floating point. Sub-nanodollar/unsafe values fail closed. */
export function decimalNanoUsd(value: string): number {
  const match = /^(0|[1-9]\d{0,15})(?:\.(\d{1,18}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(value);
  if (!match) return fail();
  const fraction = match[2] ?? '', exponent = Number(match[3] ?? 0);
  const scale = 9 + exponent - fraction.length;
  if (Math.abs(scale) > 40) return fail();
  let n = BigInt(match[1] + fraction);
  if (scale < 0) {
    const divisor = 10n ** BigInt(-scale);
    if (n % divisor !== 0n) return fail();
    n /= divisor;
  } else n *= 10n ** BigInt(scale);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  return Number(n);
}
class JsonDecimal { constructor(readonly source: string) {} }
/** Reject duplicate members before JSON.parse can discard them. Bounded structural
 * validation also prevents deeply nested untrusted input exhausting the reviver. */
function uniqueJsonMembers(raw: string): void {
  let index = 0;
  const ws = () => { while (index < raw.length && /[ \t\r\n]/.test(raw[index])) index++; };
  function string(): string {
    const start = index;
    if (raw[index++] !== '"') return fail();
    while (index < raw.length) {
      const char = raw[index++];
      if (char === '"') return raw.slice(start, index);
      if (char === '\\') index++;
    }
    return fail();
  }
  function value(depth: number): void {
    if (depth > 32) return fail();
    ws();
    const char = raw[index];
    if (char === '"') { string(); return; }
    if (char === '{' || char === '[') {
      index++; ws();
      const object = char === '{', close = object ? '}' : ']', keys = new Set<string>();
      if (raw[index] === close) { index++; return; }
      for (;;) {
        if (object) {
          ws(); const key: unknown = JSON.parse(string());
          if (typeof key !== 'string' || keys.has(key)) return fail();
          keys.add(key); ws(); if (raw[index++] !== ':') return fail();
        }
        value(depth + 1); ws();
        if (raw[index] === close) { index++; return; }
        if (raw[index++] !== ',') return fail();
      }
    }
    const primitive = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(index));
    if (!primitive) return fail();
    index += primitive[0].length;
  }
  value(0); ws(); if (index !== raw.length) return fail();
}
function marketJson(raw: string): unknown {
  uniqueJsonMembers(raw);
  // Node 22's source-aware reviver retains original decimals, including exponent notation.
  return JSON.parse(raw, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) return fail();
    return new JsonDecimal(context.source);
  });
}
function marketRate(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (!(v instanceof JsonDecimal)) return null;
  try { return decimalNanoUsd(v.source); } catch { return null; }
}
function hundredths(v: unknown): number | null {
  if (!(v instanceof JsonDecimal) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v.source)) return null;
  const n = Number(v.source);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}
function count24h(v: unknown): number | null {
  if (!(v instanceof JsonDecimal) || !/^(?:0|[1-9]\d*)$/.test(v.source)) return null;
  const n = Number(v.source);
  return Number.isSafeInteger(n) ? n : null;
}
function parseMarket(raw: string): { rows: QubaxObservedPrice[]; updatedAtMs: number } {
  const body = marketJson(raw);
  if (!record(body) || body.object !== 'list' || !Array.isArray(body.data) || !body.data.length || body.data.length > MAX_ROWS
    || ['next', 'next_cursor', 'has_more', 'links'].some(k => body[k] !== undefined && body[k] !== null && body[k] !== false)
    || typeof body.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.updated_at)) return fail();
  const updatedAtMs = Date.parse(body.updated_at);
  const canonicalStamp = body.updated_at.replace(/(?:\.(\d{1,3}))?Z$/, (_all, ms: string | undefined) => `.${(ms ?? '').padEnd(3, '0')}Z`);
  if (!time(updatedAtMs) || new Date(updatedAtMs).toISOString() !== canonicalStamp) return fail();
  const ids = new Set<string>(), rows: QubaxObservedPrice[] = [];
  for (const entry of body.data) {
    // One bad row must not throw away the rest of the market.
    if (!record(entry) || !text(entry.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(entry.id) || ids.has(entry.id)) continue;
    ids.add(entry.id);
    if (entry.unit !== null || !['TEXT', 'MULTIMODAL'].includes(String(entry.modality))) continue;
    let contextTokens: number | null = null;
    if (entry.context_length !== null && entry.context_length !== undefined) {
      if (entry.context_length instanceof JsonDecimal && entry.context_length.source === '0') continue;
      if (!(entry.context_length instanceof JsonDecimal) || !/^[1-9]\d{0,8}$/.test(entry.context_length.source)) continue;
      contextTokens = Number(entry.context_length.source);
    }
    rows.push({ ...emptyPrice(entry.id), modality: entry.modality === 'TEXT' ? 'text' : 'multimodal', contextTokens,
      inputNanoUsd: marketRate(entry.input_per_1m), outputNanoUsd: marketRate(entry.output_per_1m),
      discountHundredths: hundredths(entry.discount_pct), requests24h: count24h(entry.requests_24h) });
  }
  if (!rows.length) return fail();
  return { rows, updatedAtMs };
}
const cells = (line: string) => line.trim().slice(1, -1).split('|').map(v => v.trim());
function markdownRate(value: string): number | null {
  if (value === '-') return null;
  const match = /^\\?\$(\d+(?:\.\d+)?)$/.exec(value);
  return match ? decimalNanoUsd(match[1]) : fail();
}
function tableRows(section: string, expectedHeaders: string[][]): string[][][] {
  const lines = section.split(/\r?\n/), tables: string[][][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const header = cells(lines[i]);
    if (!lines[i].trim().endsWith('|') || !expectedHeaders.some(h => JSON.stringify(h) === JSON.stringify(header))) return fail();
    const separator = lines[++i]?.trim();
    if (!separator?.startsWith('|') || !separator.endsWith('|')
      || cells(separator).length !== header.length || !cells(separator).every(c => /^:?-+:?$/.test(c))) return fail();
    const rows: string[][] = [header];
    while (lines[i + 1]?.trim().startsWith('|')) {
      const line = lines[++i].trim(), row = cells(line);
      if (!line.endsWith('|') || row.length !== header.length || !text(row[0])) return fail();
      rows.push(row);
    }
    if (rows.length < 2) return fail();
    tables.push(rows);
  }
  return tables;
}
const OPENAI_LONG_HEADER = ['Model', ...['Short', 'Long'].flatMap(b => ['input', 'output', 'cached input', '30m write', '12h write'].map(k => `${b} context ${k}`))];
const OPENAI_SHORT_HEADER = ['Model', 'Input', 'Output', 'Cached input'];
function parseOpenai(raw: string): QubaxObservedPrice[] {
  // Deliberately scoped: no flattening of Batch/Flex, Fast, regional or specialized prices.
  const anchor = raw.indexOf('<a id="latest-models"></a>'), start = raw.indexOf('### Standard pricing data');
  const end = raw.indexOf('### Batch pricing data', start);
  if (anchor < 0 || start <= anchor || end <= start || !raw.slice(anchor, start).includes('Flagship models')
    || !raw.slice(anchor, start).includes('Prices per 1M tokens.')) return fail();
  const section = raw.slice(start + '### Standard pricing data'.length, end);
  if (/^#{1,4}\s/m.test(section)) return fail();
  const tables = tableRows(section, [OPENAI_LONG_HEADER, OPENAI_SHORT_HEADER]);
  if (tables.length !== 2 || tables[0][0].length !== 11 || tables[1][0].length !== 4) return fail();
  const rows: QubaxObservedPrice[] = [];
  for (const table of tables) for (const row of table.slice(1)) {
    if (!/^gpt-[a-zA-Z0-9_.-]+(?: \(<\d+K context length\))?$|^o\d(?:-[a-zA-Z0-9_.-]+)?$/.test(row[0])) return fail();
    for (const [index, band] of (row.length === 11 ? [[1, 'short'], [6, 'long']] : [[1, 'unspecified']]) as [number, QubaxObservedPrice['contextBand']][]) {
      rows.push({ ...emptyPrice(row[0]), contextBand: band, serviceTier: 'standard',
        inputNanoUsd: markdownRate(row[index]), outputNanoUsd: markdownRate(row[index + 1]), cacheReadNanoUsd: markdownRate(row[index + 2]),
        ...(row.length === 11 ? { cacheWrite30mNanoUsd: markdownRate(row[index + 3]), cacheWrite12hNanoUsd: markdownRate(row[index + 4]) } : {}) });
    }
  }
  return rows;
}
function parseZai(raw: string): QubaxObservedPrice[] {
  const start = raw.indexOf('## Models\n'), end = raw.indexOf('### Built-in Tools', start);
  if (!raw.includes('All prices are in USD.') || start < 0 || end <= start) return fail();
  const section = raw.slice(start, end);
  if (!section.includes('### Latest Models') || !section.includes('### Text Models') || !section.includes('Prices per 1M tokens.')) return fail();
  const tables = tableRows(section, [['Model', 'Input', 'Cached Input', 'Cached Input Storage', 'Output']]);
  if (tables.length !== 2) return fail();
  return tables.flatMap(t => t.slice(1).map(row => {
    if (!/^GLM-[a-zA-Z0-9_.-]+$/.test(row[0]) || !['Limited-time Free', '-'].includes(row[3])) return fail();
    return { ...emptyPrice(row[0]), inputNanoUsd: markdownRate(row[1]), cacheReadNanoUsd: markdownRate(row[2]),
      outputNanoUsd: markdownRate(row[4]), cacheStorage: row[3] === 'Limited-time Free' ? 'limited-time-free' as const : 'unknown' as const };
  }));
}

export function normalizeQubaxPriceSource(source: QubaxPriceSource, raw: string, headers: Headers, startedAtMs: number, observedAtMs: number): QubaxPriceSourceSnapshot {
  if ((source !== 'qubax' && source !== 'openai' && source !== 'zai') || !time(startedAtMs) || !time(observedAtMs) || observedAtMs < startedAtMs || Buffer.byteLength(raw) > QUBAX_PRICE_FEED_MAX_BYTES) return fail();
  const httpDateMs = Date.parse(headers.get('date') ?? '');
  const age = headers.get('age');
  const httpAgeSeconds = age === null ? null : /^\d{1,9}$/.test(age) ? Number(age) : NaN;
  if (!time(httpDateMs) || httpDateMs > observedAtMs || httpAgeSeconds !== null && !time(httpAgeSeconds)
    || /(?:^|,)\s*11[01]\s/.test(headers.get('warning') ?? '')) return fail();
  const market = source === 'qubax' ? parseMarket(raw) : null;
  const rows = market?.rows ?? (source === 'openai' ? parseOpenai(raw) : parseZai(raw));
  const sourceUpdatedAtMs = market?.updatedAtMs ?? null;
  if (sourceUpdatedAtMs !== null && sourceUpdatedAtMs > observedAtMs) return fail();
  // A successful Qubax market fetch is fresh for five minutes. A CDN Age on some other host must not pre-expire it.
  const expiresAtMs = source === 'qubax'
    ? observedAtMs + QUBAX_PRICE_FEED_TTL_MS
    : Math.min(startedAtMs, httpDateMs, observedAtMs - (httpAgeSeconds ?? 0) * 1_000, sourceUpdatedAtMs ?? startedAtMs) + QUBAX_PRICE_FEED_TTL_MS;
  const keys = rows.map(r => `${r.sourceModelLabel}\0${r.contextBand}\0${r.serviceTier}`);
  if (expiresAtMs <= observedAtMs || !rows.length || rows.length > MAX_ROWS || new Set(keys).size !== keys.length) return fail();
  return { source, url: source === 'qubax' ? QUBAX_PRICE_SOURCES.qubax : DEMOTED_PRICE_PAGES[source], parser: PARSER, bodySha256: sha(raw), startedAtMs, observedAtMs,
    httpDateMs, httpAgeSeconds, sourceUpdatedAtMs, expiresAtMs,
    coverage: source === 'qubax' ? 'market-text-token-rows' : source === 'openai' ? 'flagship-standard-only' : 'latest-and-current-text-only', rows };
}

interface CollectionSlot { operations: Set<Promise<unknown>>; collecting: boolean }
let activeCollection: CollectionSlot | undefined;
function releaseSlot(slot: CollectionSlot): void {
  if (!slot.collecting && !slot.operations.size && activeCollection === slot) activeCollection = undefined;
}
function track<T>(slot: CollectionSlot, work: Promise<T>): Promise<T> {
  slot.operations.add(work);
  const settled = () => { slot.operations.delete(work); releaseSlot(slot); };
  void work.then(settled, settled);
  return work;
}
function cleanup(slot: CollectionSlot, action: () => Promise<void>): void {
  try { void track(slot, action()).catch(() => {}); } catch { /* Synchronous cleanup failure has settled. */ }
}
async function fetchSource(source: QubaxPriceSource, transport: typeof fetch, clock: () => number, slot: CollectionSlot): Promise<QubaxPriceSourceSnapshot> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), QUBAX_PRICE_FEED_FETCH_MS);
  const signal = controller.signal, startedAtMs = clock();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | null = null;
  async function bounded<T>(work: Promise<T>): Promise<T> {
    track(slot, work);
    let abort = () => {};
    const deadline = new Promise<never>((_, reject) => { abort = () => reject(new Error('QUBAX_PRICE_FEED_UNAVAILABLE')); signal.addEventListener('abort', abort, { once: true }); });
    try { signal.throwIfAborted(); return await Promise.race([work, deadline]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  try {
    const response = await bounded(transport(QUBAX_PRICE_SOURCES[source], qubaxPriceFeedRequest({ method: 'GET', redirect: 'error', credentials: 'omit',
      referrerPolicy: 'no-referrer', headers: { Accept: source === 'qubax' ? 'application/json' : 'text/markdown,text/plain;q=0.9', 'Cache-Control': 'no-cache' }, signal }))
      .then(response => { if (signal.aborted) { if (response.body) cleanup(slot, () => response.body!.cancel()); return fail(); } return response; }));
    body = response.body;
    if (!response.ok || response.redirected || response.url && response.url !== QUBAX_PRICE_SOURCES[source] || !response.body) return fail();
    reader = response.body.getReader();
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (source === 'qubax' ? contentType !== 'application/json' : !['text/markdown', 'text/plain'].includes(contentType ?? '')) return fail();
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > QUBAX_PRICE_FEED_MAX_BYTES)) return fail();
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const next = await bounded(reader.read());
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > QUBAX_PRICE_FEED_MAX_BYTES) return fail();
      chunks.push(next.value);
    }
    signal.throwIfAborted();
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return normalizeQubaxPriceSource(source, raw, response.headers, startedAtMs, clock());
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) { cleanup(slot, () => reader!.cancel()); try { reader.releaseLock(); } catch { /* Pending read still owns the lock. */ } }
    else if (body) cleanup(slot, () => body!.cancel());
  }
}

/** One Qubax market GET. Official price pages are not fetched, so a stale page cannot block publication. */
export async function collectQubaxPrices(transport: typeof fetch = fetch, clock: () => number = Date.now): Promise<QubaxPriceSnapshot> {
  // Deadlines return promptly, but noncooperative fetch/read/cleanup retains this one
  // process-wide slot. A later scheduler tick must not accumulate detached work.
  if (activeCollection) return fail();
  const slot: CollectionSlot = { operations: new Set(), collecting: true };
  activeCollection = slot;
  try {
    const startedAtMs = clock();
    const results = await Promise.allSettled(SOURCE_IDS.map(source => fetchSource(source, transport, clock, slot)));
    if (results.some(r => r.status === 'rejected')) return fail();
    const sources = results.map(r => (r as PromiseFulfilledResult<QubaxPriceSourceSnapshot>).value);
    const observedAtMs = clock(), expiresAtMs = Math.min(startedAtMs + QUBAX_PRICE_FEED_TTL_MS, ...sources.map(s => s.expiresAtMs));
    const version = sha(JSON.stringify({ startedAtMs, sources: sources.map(s => [s.source, s.bodySha256, s.expiresAtMs]) }));
    const snapshot: QubaxPriceSnapshot = { kind: KIND, version, startedAtMs, observedAtMs, expiresAtMs, canDispatch: false, proofStatus: 'unreviewed', sources };
    if (!validQubaxPriceSnapshot(snapshot, observedAtMs)) return fail();
    return snapshot;
  } finally { slot.collecting = false; releaseSlot(slot); }
}

/** Validate persisted observations on read too; never silently renew their age. */
export function validQubaxPriceSnapshot(value: unknown, now: number): value is QubaxPriceSnapshot {
  if (!record(value) || !time(now) || value.kind !== KIND || value.canDispatch !== false || value.proofStatus !== 'unreviewed'
    || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)
    || !time(value.startedAtMs) || !time(value.observedAtMs) || !time(value.expiresAtMs)
    || value.startedAtMs > value.observedAtMs || value.observedAtMs > now || value.expiresAtMs <= now
    || value.expiresAtMs > value.startedAtMs + QUBAX_PRICE_FEED_TTL_MS || !Array.isArray(value.sources) || value.sources.length !== SOURCE_IDS.length) return false;
  for (const [i, s] of value.sources.entries()) {
    if (!record(s) || s.source !== SOURCE_IDS[i] || s.url !== QUBAX_PRICE_SOURCES[SOURCE_IDS[i]] || s.parser !== PARSER
      || typeof s.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(s.bodySha256)
      || !time(s.startedAtMs) || !time(s.observedAtMs) || !time(s.httpDateMs) || !time(s.expiresAtMs)
      || s.startedAtMs < value.startedAtMs || s.startedAtMs > s.observedAtMs || s.observedAtMs > value.observedAtMs || s.httpDateMs > s.observedAtMs
      || s.httpAgeSeconds !== null && !time(s.httpAgeSeconds) || s.sourceUpdatedAtMs !== null && (!time(s.sourceUpdatedAtMs) || s.sourceUpdatedAtMs > s.observedAtMs)
      || s.source === 'qubax' && s.sourceUpdatedAtMs === null || s.source !== 'qubax' && s.sourceUpdatedAtMs !== null
      || s.expiresAtMs <= now || value.expiresAtMs > s.expiresAtMs
      || (s.source === 'qubax'
        ? s.expiresAtMs > s.observedAtMs + QUBAX_PRICE_FEED_TTL_MS
        : s.expiresAtMs > Math.min(s.startedAtMs, s.httpDateMs, s.observedAtMs - Number(s.httpAgeSeconds ?? 0) * 1_000, Number(s.sourceUpdatedAtMs ?? s.startedAtMs)) + QUBAX_PRICE_FEED_TTL_MS)
      || !Array.isArray(s.rows) || !s.rows.length || s.rows.length > MAX_ROWS) return false;
    const identities = new Set<string>();
    for (const r of s.rows) {
      if (!record(r) || !text(r.sourceModelLabel) || !['text', 'multimodal'].includes(String(r.modality))
        || !['short', 'long', 'unspecified'].includes(String(r.contextBand)) || !['standard', 'unspecified'].includes(String(r.serviceTier))
        || r.currency !== 'USD' || r.billingBasis !== 'per-million-tokens' || !['unknown', 'limited-time-free'].includes(String(r.cacheStorage))
        || r.contextTokens !== null && (!time(r.contextTokens) || r.contextTokens === 0)
        || r.discountHundredths !== null && r.discountHundredths !== undefined && (!time(r.discountHundredths) || r.discountHundredths > 10_000)
        || r.requests24h !== null && r.requests24h !== undefined && !time(r.requests24h)
        || !['revision', 'tokenizer', 'sku', 'region', 'allFeesIncluded'].every(k => r[k] === null)
        || !['inputNanoUsd', 'outputNanoUsd', 'cacheReadNanoUsd', 'cacheWrite30mNanoUsd', 'cacheWrite12hNanoUsd'].every(k => r[k] === null || time(r[k]))) return false;
      const identity = `${r.sourceModelLabel}\0${r.contextBand}\0${r.serviceTier}`;
      if (identities.has(identity)) return false;
      identities.add(identity);
    }
  }
  return Buffer.byteLength(JSON.stringify(value)) <= QUBAX_PRICE_FEED_MAX_SNAPSHOT_BYTES;
}
