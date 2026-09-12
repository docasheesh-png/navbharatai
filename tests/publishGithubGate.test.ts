/**
 * GITHUB AS A PREREQUISITE — SCOPED TO WHERE IT IS TRUE.
 *
 * The admin asked (2026-09-12) for the Publish button to require a GitHub connection before anything
 * publishes, with server-side enforcement so the API cannot be called around it, and no repeat OAuth
 * for a user who is already connected. They also said, explicitly, not to follow the note blindly.
 *
 * Followed blindly it would have broken the product: a static app publishes to NavBharatAI hosting,
 * which reads nothing from GitHub (`firebaseProvider.isConfigured: () => true`), and that screen's own
 * promise is "One click, no account". Every Email/Phone user — the audience the product exists for —
 * would have been locked out of publishing by a gate in front of an unlocked door.
 *
 * So the requirement is enforced exactly where a deploy genuinely READS FROM a repository: the app's
 * server half. These tests pin both halves of that — that it bites there, and that it does not bite
 * anywhere else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  publishNeedsGitHub, githubGateVerdict, githubGateCode, githubGateMessage, GITHUB_GATE_CODE,
} from '../src/lib/publishGithubGate';
import { managedDeployOutcome } from '../src/lib/backendDeployWiring';

describe('the gate applies to a server half, and to nothing else', () => {
  it('🔒 a static publish needs no GitHub — the one-click promise survives', () => {
    expect(publishNeedsGitHub({ hasServerHalf: false })).toBe(false);
    // …and says so no matter what the user's GitHub looks like, including not existing at all.
    for (const connected of [true, false]) {
      for (const hasRepo of [true, false]) {
        expect(githubGateVerdict({ hasServerHalf: false }, { connected, hasRepo })).toBe('ok');
      }
    }
  });

  it('an app with a server half does need one', () => {
    expect(publishNeedsGitHub({ hasServerHalf: true })).toBe(true);
  });
});

describe('what is missing decides the next step — never one message for two problems', () => {
  it('not connected at all ⇒ the OAuth redirect', () => {
    const v = githubGateVerdict({ hasServerHalf: true }, { connected: false, hasRepo: false });
    expect(v).toBe('connect-github');
    expect(githubGateCode(v)).toBe(GITHUB_GATE_CODE.connect);
    expect(githubGateMessage(v)).toContain('Connect your GitHub');
  });

  it('🔒 connected but this app has no repo ⇒ a push, NEVER a second authorization', () => {
    // The admin's own rule: "Existing GitHub connection होने पर यूज़र को दोबारा OAuth flow में
    // unnecessarily redirect न किया जाए."
    const v = githubGateVerdict({ hasServerHalf: true }, { connected: true, hasRepo: false });
    expect(v).toBe('push-to-github');
    expect(githubGateCode(v)).toBe(GITHUB_GATE_CODE.push);
    expect(githubGateMessage(v)).toContain('Your GitHub is connected');
    expect(githubGateMessage(v)).not.toContain('Connect your GitHub');
  });

  it('connected with a repo ⇒ nothing in the way', () => {
    const v = githubGateVerdict({ hasServerHalf: true }, { connected: true, hasRepo: true });
    expect(v).toBe('ok');
    expect(githubGateCode(v)).toBeNull();
    expect(githubGateMessage(v)).toBe('');
  });

  it('the odd state — a repo recorded while the token is gone — still refuses, and asks for the token', () => {
    // Revoked access, a cleared browser. The repo may exist; we cannot act on it, and saying "ready"
    // would be a promise the next step breaks.
    expect(githubGateVerdict({ hasServerHalf: true }, { connected: false, hasRepo: true })).toBe('connect-github');
  });
});

describe('🔒 the server enforces it — a direct API call cannot go around the screen', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return at === -1 ? '' : route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('the backend deploy route runs the gate BEFORE it contacts any provider', () => {
    expect(handler).not.toBe('');
    const gateAt = handler.indexOf('githubGateVerdict(');
    const renderAt = handler.indexOf('deployBackendToRender(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(gateAt);
    // A refusal, not a silent fall-through into a message about the wrong thing.
    expect(handler).toContain('githubGateCode(gateVerdict)');
  });

  it('🔒 the refusal is decided by the SERVER-resolved repo, not by anything the caller sends', () => {
    // `effectiveRepoUrl` is the request's own url OR the workspace's durable record — resolved here,
    // never trusted from a field. This is what makes the gate unbypassable rather than cosmetic.
    expect(handler).toContain('hasRepo: !!effectiveRepoUrl');
    // And the one browser-supplied value in the gate is named as a hint, and only selects wording.
    expect(handler).toContain('connected: githubConnectedHint');
  });

  it('a forged "connected" flag buys a different sentence and no access', () => {
    // The property that makes taking the client's word safe, asserted directly.
    for (const connected of [true, false]) {
      expect(githubGateVerdict({ hasServerHalf: true }, { connected, hasRepo: false })).not.toBe('ok');
    }
  });
});

/**
 * 🔴 A REFUSAL IS NOT DELIVERED UNTIL THE USER READS THE RIGHT SENTENCE.
 *
 * The gate returns 422, and the client's existing 422 branch says "we could not create the backend
 * service in your account" — a sentence about Render, for a problem that is not Render's. That is the
 * same "one message for two problems" failure the gate exists to end, so it would have reappeared one
 * layer up. These cases pin the specific words.
 */
describe('the refusal reaches the user as the right next action', () => {
  it('not connected ⇒ words about GitHub, never about creating a Render service', () => {
    const out = managedDeployOutcome(422, {
      error: githubGateMessage('connect-github'),
      code: GITHUB_GATE_CODE.connect,
    });
    expect(out.kind).toBe('needs-github');
    expect(out.lines.join(' ')).toContain('server half');
    expect(out.lines.join(' ')).not.toContain('could not create the backend service');
  });

  it('🔒 connected but no repo ⇒ a save, and NOT a second authorization', () => {
    const out = managedDeployOutcome(422, {
      error: githubGateMessage('push-to-github'),
      code: GITHUB_GATE_CODE.push,
    });
    expect(out.kind).toBe('needs-github');
    expect(out.lines.join(' ')).toContain('not saved to a repository');
    expect(out.lines.join(' ')).not.toContain('Connect your GitHub');
  });

  it('an ordinary 422 that is NOT the gate keeps its own meaning', () => {
    // The branch must be specific to the code, never widened to every 422.
    const out = managedDeployOutcome(422, { error: 'Render refused the service name.' });
    expect(out.kind).toBe('create-refused');
  });
});
