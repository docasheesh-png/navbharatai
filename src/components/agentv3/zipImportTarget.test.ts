import { describe, it, expect } from 'vitest';
import { resolveImportWorkspaceId, importTargetUnavailableMessage, zipImportProgressLabel } from './zipImportTarget';

describe('resolveImportWorkspaceId', () => {
  it('uses the deterministic fallback on a FRESH session — the reported 161 MB failure', () => {
    // The exact reported state: a new v5.0 tab, Files (0) / History (0), no build has attached yet, so
    // state.workspaceId is still empty. Passing that empty value through is what made the import upload
    // the whole archive and only THEN get refused by the server.
    expect(resolveImportWorkspaceId({
      stateWorkspaceId: '',
      fallbackWorkspaceId: 'agentv3-RyN1xjbfr6gmySF5E28apuC9ZJR2-c134ad7a',
    })).toBe('agentv3-RyN1xjbfr6gmySF5E28apuC9ZJR2-c134ad7a');
  });

  it('prefers the live session id once a build has attached', () => {
    expect(resolveImportWorkspaceId({
      stateWorkspaceId: 'agentv3-uid-live',
      fallbackWorkspaceId: 'agentv3-uid-fallback',
    })).toBe('agentv3-uid-live');
  });

  it('treats null/undefined/whitespace as absent rather than sending them to the server', () => {
    expect(resolveImportWorkspaceId({ stateWorkspaceId: null, fallbackWorkspaceId: undefined })).toBeNull();
    expect(resolveImportWorkspaceId({ stateWorkspaceId: '   ', fallbackWorkspaceId: '  ' })).toBeNull();
    expect(resolveImportWorkspaceId({})).toBeNull();
  });

  it('falls back when the live id is only whitespace', () => {
    expect(resolveImportWorkspaceId({ stateWorkspaceId: '  ', fallbackWorkspaceId: 'agentv3-uid-x' })).toBe('agentv3-uid-x');
  });

  it('returning null is what lets the caller refuse BEFORE transferring 161 MB', () => {
    // The whole point: the decision is available in the first millisecond, so a doomed import never
    // costs the user a multi-minute upload.
    expect(resolveImportWorkspaceId({ stateWorkspaceId: '', fallbackWorkspaceId: '' })).toBeNull();
  });
});

describe('importTargetUnavailableMessage', () => {
  it('tells the user nothing was uploaded, so the refusal is not mistaken for data loss', () => {
    expect(importTargetUnavailableMessage()).toMatch(/nothing was uploaded/i);
  });

  it('exposes no internal identifier the user cannot act on', () => {
    expect(importTargetUnavailableMessage().toLowerCase()).not.toContain('workspaceid');
    expect(importTargetUnavailableMessage()).not.toMatch(/agentv3-/);
  });
});

describe('zipImportProgressLabel', () => {
  it('shows real percentage during the upload — the difference between "working" and "frozen"', () => {
    expect(zipImportProgressLabel('uploading', 0)).toBe('Uploading… 0%');
    expect(zipImportProgressLabel('uploading', 0.5)).toBe('Uploading… 50%');
    expect(zipImportProgressLabel('uploading', 1)).toBe('Uploading… 100%');
  });

  it('names the server-side phase so a long unpack does not look like a hang either', () => {
    expect(zipImportProgressLabel('extracting', 1)).toMatch(/unpacking/i);
  });

  it('clamps nonsense rather than rendering NaN% or 4200%', () => {
    expect(zipImportProgressLabel('uploading', Number.NaN)).toBe('Uploading… 0%');
    expect(zipImportProgressLabel('uploading', -3)).toBe('Uploading… 0%');
    expect(zipImportProgressLabel('uploading', 42)).toBe('Uploading… 100%');
  });
});
