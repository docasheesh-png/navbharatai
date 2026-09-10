import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decidePreviewReload, HMR_FRESH_MS, ACTIVITY_FRESH_MS } from '../src/components/agentv3/previewReloadPolicy';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';

const base = { mode: 'live', phase: 'generating' as const, everRendered: true };

describe('the reload decision can finally see inside the app', () => {
  it('does NOT remount when hot reload already applied the change', () => {
    // The remount was pure loss: it destroyed whatever the person had typed in order to show them
    // something already on screen. Not a defer either — there is nothing left to land.
    expect(decidePreviewReload({ ...base, hmrAgeMs: 300 })).toEqual({ reload: false, defer: false });
  });

  it('falls back to reloading the moment hot reload goes quiet', () => {
    // A dropped socket, an update that needed a full reload, an app not served by Vite at all. A
    // stale preview is a worse failure than a lost scroll position, so the fallback must be a reload.
    expect(decidePreviewReload({ ...base, hmrAgeMs: HMR_FRESH_MS + 1 }).reload).toBe(true);
    expect(decidePreviewReload({ ...base, hmrAgeMs: null }).reload).toBe(true);
    expect(decidePreviewReload({ ...base }).reload).toBe(true);
  });

  it('holds a reload while somebody is actually using the app', () => {
    // This is the rule previewReloadPolicy said could not be implemented. It can now, and it is
    // strictly better than the phase test that stood in for it.
    expect(decidePreviewReload({ ...base, activityAgeMs: 1_000 })).toEqual({ reload: false, defer: true });
  });

  it('stops holding once the app has been left alone', () => {
    expect(decidePreviewReload({ ...base, activityAgeMs: ACTIVITY_FRESH_MS + 1 }).reload).toBe(true);
  });

  it('keeps every rule it already had', () => {
    expect(decidePreviewReload({ ...base, mode: 'inbrowser', activityAgeMs: 10 })).toEqual({ reload: true, defer: false });
    expect(decidePreviewReload({ ...base, everRendered: false, activityAgeMs: 10 })).toEqual({ reload: true, defer: false });
    expect(decidePreviewReload({ ...base, phase: 'settling' })).toEqual({ reload: false, defer: true });
  });

  it('ignores nonsense ages rather than acting on them', () => {
    expect(decidePreviewReload({ ...base, hmrAgeMs: -5 }).reload).toBe(true);
    expect(decidePreviewReload({ ...base, activityAgeMs: -5 }).reload).toBe(true);
  });

  it('hot reload wins over activity — the change is already visible, so nothing needs holding', () => {
    expect(decidePreviewReload({ ...base, hmrAgeMs: 100, activityAgeMs: 100 })).toEqual({ reload: false, defer: false });
  });
});

describe('the bridge reports both facts, cheaply', () => {
  const js = previewBridgeSource('live');

  it('watches the events a person actually generates', () => {
    for (const e of ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart']) expect(js).toContain(`'${e}'`);
  });

  it('observes without ever delaying the app’s own handling', () => {
    expect(js).toContain('passive: true');
  });

  it('throttles, so an app never becomes a chat channel to its panel', () => {
    expect(js).toContain('now - lastActivityPost < 2000');
  });

  it('uses Vite’s documented client events, not a private detail', () => {
    expect(js).toContain("'vite:afterUpdate'");
    expect(js).toContain("'vite:beforeFullReload'");
  });
});

describe('the surface reads the evidence at decision time', () => {
  const surface = readFileSync(join(__dirname, '..', 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

  it('passes both ages into the decision', () => {
    expect(surface).toContain('hmrAgeMs:');
    expect(surface).toContain('activityAgeMs:');
  });

  it('shows no "updates waiting" line for a change that already landed', () => {
    expect(surface).toContain('if (!decision.reload && !decision.defer) return;');
  });

  it('keeps them in refs — a keystroke must not re-render the whole preview', () => {
    expect(surface).toContain('lastActivityAtRef');
    expect(surface).toContain('lastHmrAtRef');
  });
});
