import { describe, it, expect } from 'vitest';
import { decidePreviewReload, shouldFlushOnBuildEnd, deferredReloadNote } from './previewReloadPolicy';

describe('decidePreviewReload — the reported failure', () => {
  it('does NOT remount a rendered live app while the engine is settling it', () => {
    // The exact case: the app rendered at minute 11, then repairs churned it for seven more minutes,
    // each batch hard-remounting the iframe under the person using it.
    expect(decidePreviewReload({ mode: 'live', phase: 'settling', everRendered: true }))
      .toEqual({ reload: false, defer: true });
  });

  it('still reloads freely while the app is being WRITTEN', () => {
    // Watching an app appear is the point of streaming first paint. Nothing to lose yet.
    expect(decidePreviewReload({ mode: 'live', phase: 'generating', everRendered: true }).reload).toBe(true);
  });

  it('always shows the FIRST render, even mid-settle', () => {
    // No user state exists yet, and a blank preview is worse than any churn.
    expect(decidePreviewReload({ mode: 'live', phase: 'settling', everRendered: false }).reload).toBe(true);
  });

  it('reloads when no build is running at all', () => {
    expect(decidePreviewReload({ mode: 'live', phase: 'idle', everRendered: true }).reload).toBe(true);
  });

  it('leaves in-browser mode completely unchanged', () => {
    // Deliberate: same-origin, no hard remount of a server-backed app, and not where this failed.
    for (const phase of ['idle', 'generating', 'settling'] as const) {
      expect(decidePreviewReload({ mode: 'inbrowser', phase, everRendered: true }))
        .toEqual({ reload: true, defer: false });
    }
  });
});

describe('shouldFlushOnBuildEnd — a deferral that never lands is its own lie', () => {
  it('lands the held changes once the build is over', () => {
    expect(shouldFlushOnBuildEnd({ phase: 'idle', pendingChanges: 3 })).toBe(true);
  });

  it('does nothing when nothing was held', () => {
    expect(shouldFlushOnBuildEnd({ phase: 'idle', pendingChanges: 0 })).toBe(false);
  });

  it('does not flush while the build is still going', () => {
    expect(shouldFlushOnBuildEnd({ phase: 'settling', pendingChanges: 3 })).toBe(false);
    expect(shouldFlushOnBuildEnd({ phase: 'generating', pendingChanges: 3 })).toBe(false);
  });
});

describe('deferredReloadNote', () => {
  it('counts honestly and says why the view is being kept', () => {
    expect(deferredReloadNote(1)).toContain('1 update ready');
    expect(deferredReloadNote(4)).toContain('4 updates ready');
    expect(deferredReloadNote(4)).toContain('Still finishing your app');
    expect(deferredReloadNote(4)).toContain('nothing you are doing is lost');
  });

  it('says nothing when nothing is held', () => {
    expect(deferredReloadNote(0)).toBe('');
  });

  it('names no vendor', () => {
    expect(deferredReloadNote(2)).not.toMatch(/e2b|sandbox|glm|kimi|claude|gemini|grok/i);
  });
});
