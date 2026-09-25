/**
 * AUTOPSY — the Study-Racer session (admin paste, 2026-09-25; workspace agentv3-QsNg…, two builds).
 *
 * Both builds succeeded. Under the bar every autopsy is measured against — "it looked EFFORTLESS" — they
 * did not: a 13.5-minute first build the estimator had put at 3 minutes, and a card that the report
 * itself could not read straight. Six defects, each verified against the code before it was touched,
 * each locked here so it cannot come back quietly:
 *
 * 1. "clone of YouTube" — `appScopeAnalyzer` read "youtube video ka link dalunga" (I will paste YouTube
 *    links) as a request to clone YouTube, spent a 61 s planner call, and cut the user's own core ask
 *    into roadmap steps 2–3. The complexity router scored the same prompt 15 ("simple").
 * 2. The roadmap planner's 3,543 output tokens on glm-4.7-flashx were billed at Sonnet's rate through
 *    the "unattributed remainder" — ×37 on the vendor price, ×4 markup — on a free user's ₹174.80 bill.
 *    The heal runners were fixed for this in August; the three planner calls were the siblings.
 * 3. "GLM benched for the rest of this build" — twice, 2 minutes apart. The bench was a set of locals
 *    inside ONE runner instance, and a build constructs several.
 * 4. `unsafe-target-blank` on two links that carried `rel="noopener noreferrer"` on the next line — the
 *    JSX-multiline class, a third analyzer. The reviewer called the platform's own finding false.
 * 5. `PREVIEW_SNAPSHOT_STALE` on a build whose POST_GREEN_WRITES said nothing wrote after the copy: the
 *    sandbox's index.html carried our 18 KB preview bridge, the durable one did not, and the identity
 *    hash compared them raw.
 * 6. `FAST_LANE_PHASES: generate 0s (0%) … everything else 145.4s (93%)` about a lane that had spent
 *    those seconds generating — the phase clock was written only when the loop completed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeAppScope, namesAsProduct } from '../src/server/lib/appScopeAnalyzer';
import { scanSecurity, callSpanAt } from '../src/server/AgentV3/SecurityAnalysis';
import { enclosingTag } from '../src/server/AgentV3/jsxTags';
import { identitySource, workspaceContentHash, snapshotConfirmation } from '../src/server/AgentV3/snapshotIdentity';
import { PREVIEW_BRIDGE_MARKER } from '../src/server/AgentV3/previewBridge';
import { makeMultiProviderTurnRunner, createBuildBenchRegistry, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { TurnResult } from '../src/server/AgentV3/providers/ClaudeClient';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. content from a product is not the product ────────────────────────────────────────────────

describe('1 · "youtube video ka link dalunga" is not a request to clone YouTube', () => {
  const PROMPT = 'Mere liye ek study-type game banao. Jisme mai game khelte-khelte study bhi kar lu. Mai isme notes, youtube video ka link dalunga or tum isse car game, racing game, quiz game ke form me mujhe yaad karaoge';

  it('🔴 the exact prompt from the report builds DIRECTLY', () => {
    const s = analyzeAppScope(PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.famousApp).toBeNull();
    expect(s.signals.join(' ')).not.toMatch(/clone/i);
  });

  it('a content noun or a Hinglish possessive after the name marks a tool mention', () => {
    const yt = /\byoutube\b/i;
    for (const t of ['embed a youtube video', 'paste the youtube url here', 'youtube ka link daalo', 'instagram ki post dikhao', 'youtube playlist import karo', 'a youtube thumbnail preview']) {
      expect(namesAsProduct(t, yt.source.includes('youtube') ? yt : /\binstagram\b/i), t).toBe(false);
    }
    expect(namesAsProduct('instagram ki post dikhao', /\binstagram\b/i)).toBe(false);
  });

  it('🔒 a real clone request still escalates — the change is precision, not deafness', () => {
    for (const t of ['youtube jaisa app banao', 'build a youtube clone with uploads and comments', 'make me youtube']) {
      expect(analyzeAppScope(t).decision, t).toBe('analyze');
    }
  });
});

// ── 2. a planner call whose vendor is known is billed at that vendor's price ────────────────────

describe('2 · the three planner calls are attributed to the provider that answered', () => {
  const route = strip(src('src/server/routes/agentv3.ts'));
  it('the mega-roadmap, blueprint and project planners each feed the provider ledger', () => {
    expect(route).toContain('captureTurnUsage(rmProvider, { inputTokens: rmT.usage.inputTokens, outputTokens: rmT.usage.outputTokens }, rmT.model, rmT.usage.cacheReadInputTokens ?? 0);');
    expect(route).toContain('captureTurnUsage(bpProvider, { inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens }, t.model, t.usage.cacheReadInputTokens ?? 0);');
    expect(route).toContain('captureTurnUsage(ppProvider, { inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens }, t.model, t.usage.cacheReadInputTokens ?? 0);');
  });
  it('🔒 no planner adds to the build total without also attributing it', () => {
    // Every `blueprintUsage.outputTokens +=` must be followed, within the same block, by a
    // captureTurnUsage call — the shape that lets a known vendor's tokens fall into the remainder.
    const blocks = route.split('blueprintUsage.outputTokens += ').slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) expect(b.slice(0, 900)).toContain('captureTurnUsage(');
  });
});

// ── 3. the bench belongs to the build ───────────────────────────────────────────────────────────

describe('3 · a rung benched in one runner is benched in every runner of the build', () => {
  const timeoutErr = () => Object.assign(new Error('OpenAI-compatible call (GLM/Kimi) timed out — abandoned after 40000ms'), { code: 'ETIMEDOUT' });
  const ok = (name: string): TurnResult => ({ text: `from ${name}`, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, model: name } as unknown as TurnResult);
  function chain(calls: string[]): NamedRunner[] {
    return [
      { name: 'GLM', reportAs: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => { calls.push('GLM'); throw timeoutErr(); } } },
      { name: 'KIMI', reportAs: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => { calls.push('KIMI'); return ok('KIMI'); } } },
    ] as unknown as NamedRunner[];
  }
  const params = { model: 'x', system: '', messages: [], tools: [], maxTokens: 10 } as never;

  it('🔴 WITHOUT a shared registry the second runner calls the benched family again (the bug)', async () => {
    const calls: string[] = [];
    const a = makeMultiProviderTurnRunner(chain(calls));
    await a.runTurn(params); await a.runTurn(params); // two timeouts → GLM benched in runner A
    const b = makeMultiProviderTurnRunner(chain(calls));
    await b.runTurn(params);
    expect(calls.filter((c) => c === 'GLM').length).toBe(3); // runner B never heard of the bench
  });

  it('WITH one registry per build, runner B skips GLM and goes straight to KIMI', async () => {
    const calls: string[] = [];
    const bench = createBuildBenchRegistry();
    const benched: string[] = [];
    const a = makeMultiProviderTurnRunner(chain(calls), { bench, onProviderBenched: (f) => benched.push(f) });
    await a.runTurn(params); await a.runTurn(params);
    const b = makeMultiProviderTurnRunner(chain(calls), { bench, onProviderBenched: (f) => benched.push(f) });
    const r = await b.runTurn(params);
    expect(r.text).toBe('from KIMI');
    expect(calls.filter((c) => c === 'GLM').length).toBe(2);
    expect(benched).toEqual(['GLM']); // announced ONCE for the whole build
  });

  it('🔒 the route builds every runner of a build on one registry', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain('const buildBench = createBuildBenchRegistry();');
    expect(route.split('bench: buildBench').length - 1).toBeGreaterThanOrEqual(3); // fast text runner, main chain, heal runners
    const runner = strip(src('src/server/AgentV3/providers/MultiProviderTurnRunner.ts'));
    expect(runner).toContain('const bench = opts.bench ?? createBuildBenchRegistry();');
    expect(runner).not.toMatch(/let abandonedSlowRung\s*=/);
  });
});

// ── 4. the guard reads the whole tag ────────────────────────────────────────────────────────────

describe('4 · unsafe-target-blank reads the enclosing TAG, not the line', () => {
  const multiLine = [
    '<a',
    '  href={note.url}',
    '  target="_blank"',
    '  rel="noopener noreferrer"',
    '  className="btn"',
    '>',
    '  Open video',
    '</a>',
  ].join('\n');

  it('🔴 the exact shape from NoteCard.tsx is NOT a finding', () => {
    expect(scanSecurity('NoteCard.tsx', multiLine).filter((f) => f.rule === 'unsafe-target-blank')).toEqual([]);
  });
  it('a multi-line tag WITHOUT noopener is still a finding', () => {
    const bad = multiLine.replace('  rel="noopener noreferrer"\n', '');
    expect(scanSecurity('NoteCard.tsx', bad).some((f) => f.rule === 'unsafe-target-blank')).toBe(true);
  });
  it('the sibling: window.open whose features string sits on the NEXT line', () => {
    // The rule matches on the line that opens the call (`window.open(url,`); the guard used to read
    // only that line, so a 'noopener' two lines down was a finding. It reads the whole call now.
    const safe = "window.open(url,\n  '_blank',\n  'noopener,noreferrer'\n);";
    expect(scanSecurity('a.ts', safe).some((f) => f.rule === 'window-open-no-opener')).toBe(false);
    const unsafe = "window.open(url,\n  '_blank'\n);";
    expect(scanSecurity('a.ts', unsafe).some((f) => f.rule === 'window-open-no-opener')).toBe(true);
    expect(callSpanAt("x = window.open(a, 'b)', c)", 4)).toBe("window.open(a, 'b)', c)");
    expect(callSpanAt('window.open(a', 0)).toBeNull();
  });
  it('enclosingTag: inside → the tag; outside → null; braces and quotes respected', () => {
    const s = 'text <a href={x > 1 ? "a>b" : "c"}\n target="_blank" rel="noopener">go</a> tail';
    const at = s.indexOf('target=');
    expect(enclosingTag(s, at)).toBe(s.slice(s.indexOf('<a'), s.indexOf('>go') + 1));
    expect(enclosingTag(s, s.indexOf('tail'))).toBeNull();
    expect(enclosingTag('<div>', 99)).toBeNull();
  });
});

// ── 5. the identity of an app is its own bytes ──────────────────────────────────────────────────

describe('5 · the snapshot identity hashes the app, never our preview bridge', () => {
  const clean = '<!doctype html>\n<html><head><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n';
  const bridged = clean.replace('<head>', `<head><script>/* NavBharatAI preview bridge */ if (window.${PREVIEW_BRIDGE_MARKER}) {} window.${PREVIEW_BRIDGE_MARKER} = true; console.log('mirror');</script>`);
  const app = { 'src/App.tsx': 'export default () => null;' };

  it('🔴 a sandbox tree with the bridge and a durable tree without it are ONE identity', () => {
    const sandbox = { ...app, 'index.html': bridged };
    const durable = { ...app, 'index.html': clean };
    expect(workspaceContentHash(sandbox)).not.toBe(workspaceContentHash(durable)); // the raw bug
    expect(workspaceContentHash(identitySource(sandbox))).toBe(workspaceContentHash(identitySource(durable)));
  });
  it('and the confirmation then re-stamps the copy instead of calling it stale', () => {
    const taken = { url: 'https://s-x.example', filesHash: workspaceContentHash(identitySource({ ...app, 'index.html': bridged })) };
    const v = snapshotConfirmation({ taken, persistedHash: workspaceContentHash(identitySource({ ...app, 'index.html': clean })) });
    expect(v.action).toBe('restamp');
  });
  it('a REAL content change is still a real change', () => {
    const a = workspaceContentHash(identitySource({ ...app, 'index.html': bridged }));
    const b = workspaceContentHash(identitySource({ ...app, 'index.html': clean.replace('App', 'Racer') }));
    expect(a).not.toBe(b);
  });
  it('identitySource is idempotent, path-preserving and safe on null', () => {
    const t = { 'index.html': clean, 'a.ts': 'x' };
    expect(identitySource(t)).toEqual(t);
    expect(identitySource(identitySource({ 'index.html': bridged }))).toEqual(identitySource({ 'index.html': bridged }));
    expect(identitySource(null)).toEqual({});
  });
  it('🔒 both hash sites in the route read through identitySource', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain('workspaceContentHash(identitySource(source))');
    expect(route).toContain('workspaceContentHash(identitySource(persisted))');
    expect(route).not.toMatch(/workspaceContentHash\(source\)/);
    expect(route).not.toMatch(/workspaceContentHash\(persisted\)/);
  });
});

// ── 6. a phase that ends by hand-off is still a phase ───────────────────────────────────────────

describe('6 · the fast lane measures its generate phase even when it hands off mid-generation', () => {
  it('🔒 the running phase is read off its start instant, not written only on completion', () => {
    const sb = strip(src('src/server/AgentV3/SimpleBuilder.ts'));
    expect(sb).toContain('clock.generateStartedAt = generateStartedAt;');
    expect(sb).toMatch(/const generateMsNow = \(\): number => clock\.generateMs \|\| \(clock\.generateStartedAt \? Date\.now\(\) - clock\.generateStartedAt : 0\);/);
    expect(sb).toContain('generateMs: generateMsNow(),');
    expect(sb).not.toMatch(/generateMs: clock\.generateMs,/);
  });
});
