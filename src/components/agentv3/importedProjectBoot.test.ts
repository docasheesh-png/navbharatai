import { describe, it, expect } from 'vitest';
import { shouldBootImportedProject, type ImportedBootSignals } from './importedProjectBoot';

// The admin's rule (2026-08-10): an uploaded project never needs to reach the model — install it and
// run the preview, like an IDE. Before this, an import ended in the Files tab with nothing running the
// app, so seeing it required typing a message, which sent the whole codebase through the model.

const ready: ImportedBootSignals = {
  bootSignal: 1_700_000_000_000,
  bootedFor: 0,
  workspaceId: 'ws-1',
  livePreviewAvailable: true,
};

describe('an import boots the project it just landed', () => {
  it('boots when the files are in and a sandbox exists', () => {
    expect(shouldBootImportedProject(ready)).toBe(true);
  });

  it('does nothing without an import — an ordinary session must not boot a sandbox', () => {
    expect(shouldBootImportedProject({ ...ready, bootSignal: 0 })).toBe(false);
    expect(shouldBootImportedProject({ ...ready, bootSignal: undefined })).toBe(false);
  });

  it('boots ONCE per import, however many times the effect re-runs', () => {
    // A boot installs dependencies and starts a dev server. Firing it twice for one import would run
    // two installs against the same sandbox and race over the same port.
    expect(shouldBootImportedProject({ ...ready, bootedFor: ready.bootSignal as number })).toBe(false);
  });

  it('boots AGAIN for a second import into the same workspace', () => {
    // This is the case the existing once-per-workspace auto-resume cannot serve: the workspace already
    // resumed and already has a URL, but the files are new, so the app on screen is the old one.
    const first = ready.bootSignal as number;
    expect(shouldBootImportedProject({ ...ready, bootSignal: first + 1000, bootedFor: first })).toBe(true);
  });
});

describe('waiting for the sandbox probe instead of guessing', () => {
  it('holds while the probe is still unknown', () => {
    // null is "not answered yet", and it is null for the first moments after mount — exactly when an
    // import lands. Reading it as "no backend" would drop the boot for a pure timing reason.
    expect(shouldBootImportedProject({ ...ready, livePreviewAvailable: null })).toBe(false);
  });

  it('boots as soon as the probe confirms a backend', () => {
    const waiting = { ...ready, livePreviewAvailable: null as boolean | null };
    expect(shouldBootImportedProject(waiting)).toBe(false);
    expect(shouldBootImportedProject({ ...waiting, livePreviewAvailable: true })).toBe(true);
  });

  it('never boots on a deployment with no live sandbox', () => {
    // Nothing to boot there, and the in-browser preview already renders the files.
    expect(shouldBootImportedProject({ ...ready, livePreviewAvailable: false })).toBe(false);
  });
});

describe('guards that keep it honest', () => {
  it('needs a workspace — there is nothing to hydrate from without one', () => {
    expect(shouldBootImportedProject({ ...ready, workspaceId: '' })).toBe(false);
    expect(shouldBootImportedProject({ ...ready, workspaceId: undefined })).toBe(false);
  });
});
