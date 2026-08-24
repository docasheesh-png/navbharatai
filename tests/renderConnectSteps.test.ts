import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderConnectSteps, managedDeployOutcome } from '../src/lib/backendDeployWiring';

/**
 * "Render Blueprint connect — Express app का backend चलाने के लिए — guide karo" (admin 2026-08-23).
 *
 * The `needs-connect` outcome was honest about WHAT is left but wrote it for someone who had used
 * Render before. When the person who commissioned the feature has to ask to be walked through the
 * step, every user needs the walkthrough.
 */

describe('renderConnectSteps', () => {
  const repo = 'https://github.com/acme/shop-api';

  it('names the user’s OWN repository in the steps', () => {
    const steps = renderConnectSteps(repo);
    expect(steps.length).toBe(4);
    expect(steps.join('\n')).toContain('acme/shop-api');
  });

  it('offers the shortcut AND the manual route in the same step', () => {
    // Render's deploy URL is somebody else's and we do not control it, so the manual path is a real
    // step beside it — not small print. If the link ever changes, the guide still works.
    expect(renderConnectSteps(repo)[0]).toContain('render.com/deploy?repo=');
    expect(renderConnectSteps(repo)[0]).toContain('New → Blueprint');
  });

  it('says the settings are already written, because they are', () => {
    expect(renderConnectSteps(repo)[1]).toContain('render.yaml');
  });

  it('ends by sending them back here — the step is one-time', () => {
    const last = renderConnectSteps(repo)[3];
    expect(last).toContain('Deploy backend');
    expect(renderConnectSteps(repo)[2]).toContain('only time');
  });

  it('🔒 no usable repo ⇒ NO guide, rather than one about someone else’s repository', () => {
    for (const bad of ['', '   ', 'acme/shop-api', 'https://gitlab.com/a/b', 'https://github.com/acme', 'not a url']) {
      expect(renderConnectSteps(bad), bad).toEqual([]);
    }
  });

  it('a trailing slash does not defeat it', () => {
    expect(renderConnectSteps(`${repo}/`).length).toBe(4);
  });
});

describe('🔒 the steps are attached to the outcome that needs them', () => {
  it('needs-connect is the branch, and it still carries the server’s own words', () => {
    const out = managedDeployOutcome(409, { reason: 'no-service', message: 'No matching Render service found yet.' });
    expect(out.kind).toBe('needs-connect');
    expect(out.lines.join('\n')).toContain('No matching Render service found yet.');
  });

  it('a SUCCESSFUL deploy is not given a connect guide', () => {
    expect(managedDeployOutcome(200, { ok: true, url: 'https://x.onrender.com' }).kind).toBe('deployed');
  });

  it('the panel renders them only for that branch', () => {
    const panel = readFileSync(join(__dirname, '..', 'src/components/ide/GitPanel.tsx'), 'utf8');
    expect(panel).toContain("if (outcome.kind === 'needs-connect') addLines(renderConnectSteps(body.repoUrl));");
  });
});
