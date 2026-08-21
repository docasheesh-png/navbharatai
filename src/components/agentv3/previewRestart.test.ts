import { describe, it, expect } from 'vitest';
import { canOfferRestart, restartStatusLine } from './previewRestart';

/**
 * ROADMAP §8B B3 — "start / stop / restart one service: today a stuck server needs a full rebuild."
 *
 * The reboot itself always existed; it was only reachable from the "No live preview yet" empty state.
 * A user whose preview URL still resolves while the server behind it has died — a blank page, a
 * connection refused, an app stuck mid-boot — could not get to it, and the honest answer was "rebuild
 * the whole app".
 */
describe('canOfferRestart — where the control belongs', () => {
  it('offered on the LIVE preview, showing a URL, for a real workspace', () => {
    expect(canOfferRestart({ mode: 'live', url: 'https://x.e2b.app', workspaceId: 'ws1' })).toBe(true);
  });

  it('NOT offered in the in-browser preview — there is no server there to restart', () => {
    expect(canOfferRestart({ mode: 'inbrowser', url: 'https://x.e2b.app', workspaceId: 'ws1' })).toBe(false);
  });

  it('NOT offered with no URL — the empty state already offers it, and two would be confusing', () => {
    expect(canOfferRestart({ mode: 'live', url: '', workspaceId: 'ws1' })).toBe(false);
  });

  it('NOT offered without a workspace — there would be nothing to restart', () => {
    expect(canOfferRestart({ mode: 'live', url: 'https://x.e2b.app', workspaceId: '' })).toBe(false);
  });
});

describe('restartStatusLine — a 30-90s reboot has to say what it is doing', () => {
  it('says nothing when nothing is happening', () => {
    expect(restartStatusLine({ diagnosing: false, stage: null, result: null }).kind).toBe('none');
  });

  it('names the real stage and the seconds while it runs', () => {
    // A silent spinner for a minute and a half is indistinguishable from a hang.
    const l = restartStatusLine({ diagnosing: true, stage: { label: 'Installing dependencies', seconds: 42 }, result: null });
    expect(l.kind).toBe('progress');
    expect(l.text).toBe('Restarting the server — Installing dependencies…');
    expect(l.seconds).toBe(42);
  });

  it('still says RESTARTING when no stage has arrived yet', () => {
    const l = restartStatusLine({ diagnosing: true, stage: null, result: null });
    expect(l.kind).toBe('progress');
    expect(l.text).toBe('Restarting the server…');
    expect(l.seconds).toBe(0);
  });

  it('calls it a RESTART, not a diagnosis — the button says restart', () => {
    // A status line that uses a different word for the same action reads as something else happening.
    const l = restartStatusLine({ diagnosing: true, stage: { label: 'Booting', seconds: 1 }, result: null });
    expect(l.text.toLowerCase()).not.toContain('diagnos');
  });

  it('reports success ONLY for a boot that actually verified', () => {
    const l = restartStatusLine({ diagnosing: false, stage: null, result: { ok: true, reason: '' } });
    expect(l.kind).toBe('ok');
    expect(l.text).toContain('responding');
  });

  it('🔒 THE HONESTY RULE: a failed restart never reads as a fixed one', () => {
    // Otherwise the user goes on staring at the same broken preview believing it was repaired.
    const l = restartStatusLine({
      diagnosing: false, stage: null,
      result: { ok: false, reason: 'Nothing was listening on port 5173 after 90s.' },
    });
    expect(l.kind).toBe('failed');
    expect(l.text).toBe('Nothing was listening on port 5173 after 90s.');
  });

  it('a failure with NO reason still reports failure — silence is not evidence of success', () => {
    const l = restartStatusLine({ diagnosing: false, stage: null, result: { ok: false, reason: '   ' } });
    expect(l.kind).toBe('failed');
    expect(l.text).toContain('did not come back up');
    expect(l.text).toContain('Your files are safe');
  });

  it('while running, an OLD result never shows — the previous outcome is not this one', () => {
    const l = restartStatusLine({
      diagnosing: true, stage: { label: 'Booting', seconds: 3 },
      result: { ok: true, reason: '' },
    });
    expect(l.kind).toBe('progress');
  });
});
