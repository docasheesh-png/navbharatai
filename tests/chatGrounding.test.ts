import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { groundingStatusFor, firstTokenLog, GROUNDING_STATUS, SLOW_FIRST_TOKEN_MS } from '../src/server/lib/chatGrounding';

/**
 * THE BLANK SCREEN ON THE QUESTIONS PEOPLE ACTUALLY ASK.
 *
 * A message mentioning today, a price, a score or the weather is grounded: the route runs a live
 * lookup and only then lets the model speak. The lookup is right — a stale answer is worse than a slow
 * one — but the SILENCE was not: up to several seconds of an empty bubble, which from the user's chair
 * is indistinguishable from a broken app. These tests pin the fix and, more importantly, pin the two
 * things that make it safe: a status is never part of the answer, and an ordinary message never sees one.
 */

describe('groundingStatusFor — a status only where there is really a wait', () => {
  it('fires for the everyday questions that trigger a live lookup', () => {
    for (const m of [
      'aaj ka gold rate kya hai',
      'latest iPhone price',
      'India vs Australia score',
      'weather in Mumbai today',
      'train 12301 kaha pahunchi',
    ]) expect(groundingStatusFor(m), m).toBe(GROUNDING_STATUS);
  });

  it('🔒 stays SILENT for an ordinary message — a spinner for nothing teaches users to distrust the real one', () => {
    for (const m of [
      'ek kahani sunao',
      'write a poem about rain',
      'explain recursion',
      'hi',
      'thanks',
      '',
    ]) expect(groundingStatusFor(m), m).toBe('');
  });

  it('survives rubbish input rather than throwing into a live chat turn', () => {
    expect(groundingStatusFor(undefined as never)).toBe('');
    expect(groundingStatusFor(null as never)).toBe('');
    expect(groundingStatusFor(12345 as never)).toBe('');
  });

  it('🔒 WHITE-LABEL: the line names nothing outside NavBharatAI', () => {
    expect(GROUNDING_STATUS).not.toMatch(/google|bing|duckduckgo|brave|gemini|claude|glm|kimi|grok|openai|vertex/i);
    // And it says what is happening, so the wait has a reason rather than a mystery.
    expect(GROUNDING_STATUS.toLowerCase()).toContain('live');
  });

  it('is one short line — a paragraph in a chat bubble reads as the answer', () => {
    expect(GROUNDING_STATUS.length).toBeLessThan(60);
    expect(GROUNDING_STATUS).not.toContain('\n');
  });
});

describe('firstTokenLog — measured, not assumed, and split by path', () => {
  it('reports the two paths separately, because averaging them hides the only useful number', () => {
    expect(firstTokenLog({ ms: 400, grounded: false, tier: 'navbharat' })).toContain('path=direct');
    expect(firstTokenLog({ ms: 400, grounded: true, tier: 'navbharat' })).toContain('path=grounded');
  });

  it('carries the tier and the real milliseconds', () => {
    const line = firstTokenLog({ ms: 1234, grounded: false, tier: 'vip' });
    expect(line).toContain('tier=vip');
    expect(line).toContain('firstTokenMs=1234');
  });

  it('flags a slow start so it can be grepped without reading every line', () => {
    expect(firstTokenLog({ ms: SLOW_FIRST_TOKEN_MS, grounded: true, tier: 'navbharat' })).toContain('SLOW');
    expect(firstTokenLog({ ms: SLOW_FIRST_TOKEN_MS - 1, grounded: true, tier: 'navbharat' })).not.toContain('SLOW');
  });

  it('never throws and never prints a nonsense number', () => {
    expect(firstTokenLog({ ms: NaN, grounded: false, tier: 'x' })).toContain('firstTokenMs=0');
    expect(firstTokenLog({ ms: -50, grounded: false, tier: 'x' })).toContain('firstTokenMs=0');
    expect(firstTokenLog({} as never)).toContain('tier=unknown');
  });
});

describe('wiring — the stream opens BEFORE the lookup, and the status can never become the answer', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');
  const engine = readFileSync(join(process.cwd(), 'src/hooks/useChatEngine.ts'), 'utf8');
  const live = readFileSync(join(process.cwd(), 'src/server/lib/liveSearchContext.ts'), 'utf8');

  it('🔒 the status is emitted BEFORE the live lookup is awaited — that ordering IS the fix', () => {
    const status = route.indexOf('const groundingStatus = groundingStatusFor(message);');
    const lookup = route.indexOf('const liveBlock = await liveSearchContext(message);');
    expect(status).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(status);
    // And it opens the stream itself, since nothing else has yet.
    expect(route.slice(status, lookup)).toContain('res.flushHeaders();');
    expect(route.slice(status, lookup)).toContain("JSON.stringify({ s: groundingStatus })");
  });

  it('🔒 the later header block is guarded — setting a header after flush throws and would kill the reply', () => {
    const at = route.indexOf('// SSE stream — proper format');
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 600);
    expect(block).toContain('if (!res.headersSent) {');
    expect(block.indexOf('if (!res.headersSent)')).toBeLessThan(block.indexOf("res.setHeader('Content-Type', 'text/event-stream')"));
  });

  it('the status rides its own field, so an older client ignores it entirely', () => {
    // The answer is `c`; anything else is not appended by any shipped client.
    expect(route).toContain("JSON.stringify({ s: groundingStatus })");
    expect(route).toContain("JSON.stringify({ c: chunk })");
  });

  it('🔒 the client never lets a status reach the saved message', () => {
    expect(engine).toContain('let status = ');
    expect(engine).toContain("else if (typeof parsed.s === 'string' && parsed.s && !accumulated) status = parsed.s;");
    // Rendered only while there is no answer; `accumulated` wins outright.
    expect(engine).toContain('const snap = accumulated || status;');
    // And it is never concatenated into the text that gets stored.
    expect(engine).not.toContain('accumulated += parsed.s');
  });

  it('the first-token measurement starts at the REQUEST, not at the model call', () => {
    const stamp = route.indexOf('const requestStartedAt = Date.now();');
    const handler = route.indexOf('const chatHandler = async');
    expect(stamp).toBeGreaterThan(handler);
    expect(stamp - handler).toBeLessThan(600); // the first statements of the handler
    expect(route).toContain('console.log(firstTokenLog({ ms: firstTokenAt - requestStartedAt');
    // Logged once, on the FIRST chunk only.
    expect(route).toContain('if (firstTokenAt === null) {');
  });

  it('the page-read budget between the user and their first word is 2.5 s, not 4', () => {
    expect(live).toContain('opts.pageTimeoutMs ?? 2500');
    expect(live).not.toContain('opts.pageTimeoutMs ?? 4000');
  });
});
