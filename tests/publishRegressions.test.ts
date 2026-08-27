import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Three publish failures reported together on 2026-08-27, each with the same shape underneath: work
// that outlives, or blocks, the thing it was meant to serve.
const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('1 — the SECOND publish must not fail because of the first', () => {
  const actuator = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');

  it('the dist reader no longer writes to a path shared by every publish', () => {
    // "open /tmp/nb_read_dist.cjs: permission denied" on a re-publish. A sandbox is resumed across
    // sessions, so a leftover only has to become un-writable ONCE to break every later publish.
    expect(actuator).not.toContain("'/tmp/nb_read_dist.cjs'");
    expect(actuator).not.toContain("'/tmp/nb_dist.json'");
    expect(actuator).toContain('nb_read_dist_${runId}');
    expect(actuator).toContain('nb_dist_${runId}');
  });

  it('the temp files are cleaned up, so a long-lived sandbox does not accumulate them', () => {
    expect(actuator).toMatch(/rm -f \$\{readerPath\} \$\{resultPath\}/);
  });

  it('OUR failure is not reported as the user\'s missing build', () => {
    // Exit 2 is our script saying "nothing here". Any other exit is our tooling failing, and telling
    // that user to run a build they already ran is advice that cannot work.
    expect(actuator).toContain('result.exitCode === 2');
    expect(actuator).toContain('the problem is on our side');
  });
});

describe('2 — App Mart publish must not hang', () => {
  const route = read('src/server/routes/navStore.ts');
  const chooser = read('src/components/agentv3/HostingChooser.tsx');

  it('the page bake happens AFTER the response, never inside the user\'s wait', () => {
    // renderPreview + gzipSync are SYNCHRONOUS and CPU-bound: a timeout could not have rescued this,
    // because you cannot race a promise against work holding the only thread.
    expect(route).toContain('bakeAfterResponse');
    expect(route).toContain('setImmediate');
    const call = route.indexOf('bakeAfterResponse();');
    const respond = route.indexOf("shareUrl: `/store/app/${id}`");
    expect(respond).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(respond); // the answer goes out first
  });

  it('the biggest apps skip the bake instead of burning CPU for a page that will not fit', () => {
    expect(route).toContain('BAKE_MAX_SOURCE_BYTES');
    expect(route).toContain('BAKE_MAX_SOURCE_FILES');
  });

  it('the button can never spin forever, whatever the server does', () => {
    expect(chooser).toContain('AbortController');
    expect(chooser).toContain('90_000');
    expect(chooser).toContain('AbortError');
    // …and the timer is always cleared, so a fast publish leaves nothing pending.
    expect(chooser).toContain('clearTimeout(timer)');
  });
});

describe('3 — a published app must not keep serving a page our old runtime baked', () => {
  const preview = read('src/server/runtime/ReactPreview.ts');
  const precompile = read('src/server/runtime/PreviewPrecompile.ts');
  const store = read('src/server/lib/navStoreWeb.ts');

  it('BOTH compile paths use the standard JSX runtime — the production build has no jsxDEV', () => {
    // react/cjs/react-jsx-dev-runtime.production.js ships `exports.jsxDEV = void 0`. Either path
    // emitting jsxDEV puts every React app one CDN default away from dying on first render.
    expect(preview).not.toContain("development: true");
    expect(precompile).not.toContain("development: true");
    expect(preview).toContain("runtime: 'automatic', development: false");
    expect(precompile).toContain("runtime: 'automatic', development: false");
  });

  it('the browser loader still repairs a jsxDEV call that reaches it from anywhere else', () => {
    // Second layer: we do not control a user's vendored file or a package shipping a dev build.
    expect(preview).toContain("bareCache['react/jsx-dev-runtime']");
    expect(preview).toContain('patched.jsxDEV');
    expect(preview).toContain('isStaticChildren');
  });

  it('a stored bake is stamped with the runtime that made it, and checked on the way out', () => {
    expect(store).toContain('runtime: previewRuntimeSignature()');
    expect(store).toContain('bakeIsCurrent(');
  });

  it('the two compile paths agree, because a drift is invisible until a user hits it', () => {
    const flag = /runtime: 'automatic', development: (true|false)/g;
    const both = [...preview.matchAll(flag), ...precompile.matchAll(flag)].map((m) => m[1]);
    expect(both.length).toBeGreaterThanOrEqual(4);
    expect(new Set(both).size).toBe(1);
  });
});
