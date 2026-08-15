import { describe, it, expect } from 'vitest';
import {
  isValidDataCollection, validateRow, dayBucket,
  MAX_ROW_BYTES, MAX_ROWS_PER_APP, MAX_WRITES_PER_APP_PER_DAY, MAX_LIST_LIMIT,
} from './navStoreWebData';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SHARED DATA (Kadam 4) — the quota-bound exception to "user apps never touch our accounts".
 *
 * The quotas are not tuning knobs; they are the TERMS of the admin's authorization (CLAUDE.md,
 * 2026-08-15). So the tests here defend two things: the caps themselves (their existence and that
 * writes are refused honestly at the edge), and the wiring that makes the whole feature real
 * end-to-end (the NavData helper in every generated page, the id injection that flips it from
 * per-device to genuinely shared, and CORS — without which the opaque-origin player could not call
 * the API at all and every "working" chat app would be an app talking to nobody).
 */

describe('what an app may name and store', () => {
  it('collection names are short lowercase words — no path tricks', () => {
    for (const good of ['messages', 'guest-book', 'scores_2026', 'a']) expect(isValidDataCollection(good), good).toBe(true);
    for (const bad of ['', 'A', '1x', 'a/../b', 'a b', 'x'.repeat(40), null, 7]) expect(isValidDataCollection(bad as never), String(bad)).toBe(false);
  });

  it('a row is capped on its SERIALIZED size — what actually occupies the database', () => {
    expect(validateRow({ msg: 'hi' }).ok).toBe(true);
    const big = validateRow({ msg: 'x'.repeat(MAX_ROW_BYTES) });
    expect(big.ok).toBe(false);
    expect(big.reason).toContain('KB');
  });

  it('an unserializable row is refused, not stored broken', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateRow(cyclic).ok).toBe(false);
    expect(validateRow(undefined).ok).toBe(false);
  });

  it('the day bucket runs on the server clock', () => {
    expect(dayBucket(new Date('2026-08-15T23:59:59Z'))).toBe('2026-08-15');
    expect(dayBucket(new Date('2026-08-16T00:00:01Z'))).toBe('2026-08-16');
  });

  it('the quotas exist and are the sane shape the authorization named', () => {
    // Their VALUES may move only with admin sign-off (CLAUDE.md); their EXISTENCE may not move at all.
    expect(MAX_ROWS_PER_APP).toBeGreaterThan(0);
    expect(MAX_WRITES_PER_APP_PER_DAY).toBeGreaterThan(0);
    expect(MAX_LIST_LIMIT).toBeLessThanOrEqual(500);
  });
});

describe('the wiring that makes a shared app real end-to-end', () => {
  const runtime = readFileSync(join(process.cwd(), 'src/server/runtime/previewImportMeta.ts'), 'utf8');
  const routes = readFileSync(join(process.cwd(), 'src/server/routes/navStore.ts'), 'utf8');

  it('every generated page carries window.NavData (both templates)', () => {
    expect(runtime).toContain('NAVDATA_RUNTIME_SOURCE');
    for (const f of ['src/server/runtime/ReactPreview.ts', 'src/server/runtime/VuePreview.ts']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).toContain('${NAVDATA_RUNTIME_SOURCE}');
    }
  });

  it('the player bakes the app id in — the flip from talking-to-yourself to shared', () => {
    expect(routes).toContain('__NBAI_STORE_APP_ID');
  });

  it('the data routes answer CORS-open, or the opaque-origin player could never call them', () => {
    const dataSection = routes.slice(routes.indexOf('SHARED DATA (Kadam 4)'));
    expect(dataSection).toContain("Access-Control-Allow-Origin', '*'");
    // …including the preflight, which a JSON POST from a foreign origin always sends first.
    expect(dataSection).toContain("app.options('/api/nav-store/web/app/:id/data/:collection'");
  });

  it('writes and reads are rate-limited at the route layer', () => {
    const dataSection = routes.slice(routes.indexOf('SHARED DATA (Kadam 4)'));
    expect(dataSection).toContain('store-data-write');
    expect(dataSection).toContain('store-data-read');
  });

  it('the NavData helper is additive and crash-proof where storage is hostile', () => {
    // Opaque origins THROW on localStorage; the helper must fall back, never take the app down.
    expect(runtime).toContain("typeof window.NavData === 'undefined'");
    expect(runtime).toMatch(/catch \(e\) \{ return mem\[k\]/);
  });

  it('the builder is told the capability exists — an API nobody generates against is dead code', () => {
    const prompt = readFileSync(join(process.cwd(), 'src/server/AgentV3/systemPrompt.ts'), 'utf8');
    expect(prompt).toContain('NavData.add(collection, obj)');
    // …with the honest preview-vs-store difference stated, not implied.
    expect(prompt).toContain('per-device');
  });
});
