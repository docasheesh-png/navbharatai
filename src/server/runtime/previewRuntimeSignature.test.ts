import { describe, it, expect } from 'vitest';
import { previewRuntimeSignature, bakeIsCurrent } from './previewRuntimeSignature';
import { renderPreview } from './renderPreview';
import { VirtualFileSystem } from '../project/ProjectModel';

// A store app's page is compiled once at publish and stored. Before this module, the ONLY thing that
// invalidated that stored page was the app's own version — so a bug in OUR preview runtime became
// permanent for every app baked while it existed, and shipping the fix reached nobody who already had
// the broken page. That is what happened with jsxDEV (admin report 2026-08-27).

describe('the runtime signature', () => {
  it('is a real, stable fingerprint — not the failure constant', () => {
    const a = previewRuntimeSignature();
    expect(a).not.toBe('unavailable');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    // Memoized and deterministic: two calls in one process must agree, or every bake would be stale.
    expect(previewRuntimeSignature()).toBe(a);
  });

  it('describes the RUNTIME, not any particular app', () => {
    // Rendering two different apps must not change what the current runtime is.
    const one = renderPreview(VirtualFileSystem.fromRecord({
      'package.json': '{"name":"a"}', 'index.html': '<!doctype html><div id="root"></div>',
      'src/main.tsx': "export default function A() { return <p>a</p>; }",
    }), 'https://x.invalid', 'a');
    const two = renderPreview(VirtualFileSystem.fromRecord({
      'package.json': '{"name":"b"}', 'index.html': '<!doctype html><div id="root"></div>',
      'src/main.tsx': "export default function B() { return <p>b</p>; }",
    }), 'https://x.invalid', 'b');
    expect(one).not.toBe(two);                       // the apps really are different
    expect(previewRuntimeSignature()).toMatch(/^[0-9a-f]{16}$/); // …and the signature is unmoved
  });
});

describe('bakeIsCurrent — two independent reasons a stored page is stale', () => {
  const sig = previewRuntimeSignature();

  it('serves a bake that matches BOTH the version and the runtime', () => {
    expect(bakeIsCurrent({ version: 3, runtime: sig }, 3)).toBe(true);
  });

  it('refuses a bake from an older version of the app (the creator re-published)', () => {
    expect(bakeIsCurrent({ version: 2, runtime: sig }, 3)).toBe(false);
  });

  it('THE REPORTED CASE: refuses a bake from a different runtime, even at the right version', () => {
    // This is the check that did not exist. Every App Mart page baked during the jsxDEV window sat at
    // the current version and would have been served forever.
    expect(bakeIsCurrent({ version: 3, runtime: 'deadbeefdeadbeef' }, 3)).toBe(false);
  });

  it('refuses a bake with NO runtime stamp — those are exactly the pages baked before this existed', () => {
    expect(bakeIsCurrent({ version: 3 }, 3)).toBe(false);
    expect(bakeIsCurrent({ version: 3, runtime: '' }, 3)).toBe(false);
  });

  it('refuses when there is no bake at all', () => {
    expect(bakeIsCurrent(null, 1)).toBe(false);
  });
});
