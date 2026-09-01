/**
 * PUBLISHING IS THE USER'S DECISION (admin 2026-09-01).
 *
 * A user typed "continue". The build finished, the agent decided by itself — "Build successful! Ab
 * deploy karta hoon." — and their app went live on a public URL. Nobody asked for it.
 *
 * The only thing between a private app and the open internet was a SENTENCE in the deploy tool's
 * description: "use when the user asks to deploy/publish/go live". The model did not follow it. A
 * permission enforced by asking the model nicely is not a permission, so it is a gate now.
 *
 * The default is what matters most here: refusing someone who wanted their app live costs one
 * sentence, and the Publish button is right there. Allowing it wrongly puts unfinished work in public.
 */
import { describe, it, expect } from 'vitest';
import { decidePublishConsent, PUBLISH_NOT_REQUESTED } from '../src/server/AgentV3/publishConsent';
import { readFileSync } from 'fs';
import { join } from 'path';

const DISPATCH = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('the exact message that caused this', () => {
  it('"continue" does NOT authorise a publish', () => {
    expect(decidePublishConsent('continue').consent).toBe('denied');
    expect(decidePublishConsent('continue').reason).toBe('not-asked');
  });

  it('nor does any other ordinary build instruction', () => {
    for (const m of [
      'ek ad blocker browser banao', 'add a dark mode toggle', 'fix the error',
      'aur kuch features add karo', 'make it responsive', 'theek karo', '',
    ]) {
      expect(decidePublishConsent(m).consent, `"${m}" must not publish`).toBe('denied');
    }
  });
});

describe('a real ask is honoured — in the languages people actually type', () => {
  it('English', () => {
    for (const m of ['publish it', 'deploy this app', 'go live', 'make it live', 'ship it', 'host it now', 'put it online']) {
      expect(decidePublishConsent(m).consent, m).toBe('granted');
    }
  });

  it('Hinglish and Hindi', () => {
    for (const m of ['publish kar do', 'publish karo', 'deploy karo', 'deploy kardo', 'ise live kar do', 'live karo', 'host karo', 'online kar do', 'इसे लाइव करो', 'प्रकाशित करो']) {
      expect(decidePublishConsent(m).consent, m).toBe('granted');
    }
  });
});

describe('a negation WINS — the worst possible failure is publishing on a sentence that said not to', () => {
  it('takes the ask back', () => {
    for (const m of [
      'abhi publish mat karna', 'publish mat karo', 'do not publish yet', "don't deploy this",
      'publish nahi karna', 'deploy later', 'baad me publish karenge', 'abhi nahi, publish mat karo',
      'build it without deploying',
    ]) {
      expect(decidePublishConsent(m).consent, `"${m}" MUST NOT publish`).toBe('denied');
    }
    expect(decidePublishConsent('abhi publish mat karna').reason).toBe('withdrawn');
  });
});

describe('the gate is structural, not advisory', () => {
  it('deploy REFUSES before doing anything when consent was not given', () => {
    const at = DISPATCH.indexOf("case 'deploy': {");
    const head = DISPATCH.slice(at, at + 6000);
    expect(head).toMatch(/if \(!this\._publishConsent\) return PUBLISH_NOT_REQUESTED;/);
    // It must come before the download/publish work, or the refusal is decorative.
    expect(head.indexOf('_publishConsent')).toBeLessThan(head.indexOf('downloadDistFiles'));
  });

  it('defaults to DENIED, so a call site that forgets cannot publish', () => {
    expect(DISPATCH).toMatch(/private _publishConsent = false;/);
  });

  it('refuses as a normal result, not a throw — the model should RELAY it', () => {
    // An error would read to the model as the app being unfit to publish, which is a different and
    // false message. The user should hear "your app is ready, press Publish".
    const at = DISPATCH.indexOf("case 'deploy': {");
    expect(DISPATCH.slice(at, at + 900)).not.toMatch(/if \(!this\._publishConsent\) throw/);
    expect(PUBLISH_NOT_REQUESTED).toMatch(/Publish button/);
    expect(PUBLISH_NOT_REQUESTED).not.toMatch(/error|failed|cannot be published/i);
  });
});

describe('both doors are wired', () => {
  it('the Publish BUTTON grants consent — otherwise the button silently stops working', () => {
    const at = ROUTE.indexOf("dispatcher.dispatch({ id: 'publish', name: 'deploy'");
    expect(at).toBeGreaterThan(-1);
    // Granted immediately above the dispatch, where it cannot drift away from it.
    expect(ROUTE.slice(Math.max(0, at - 500), at)).toMatch(/dispatcher\.setPublishConsent\(true\)/);
  });

  it('the BUILD loop grants only from this turn\'s message', () => {
    expect(ROUTE).toMatch(/const consent = decidePublishConsent\(prompt\);/);
    expect(ROUTE).toMatch(/dispatcher\.setPublishConsent\(consent\.consent === 'granted'\)/);
  });

  it('a failure while deciding leaves it DENIED', () => {
    const at = ROUTE.indexOf('const consent = decidePublishConsent(prompt);');
    expect(ROUTE.slice(at, at + 700)).toMatch(/catch \{[^}]*DENIED/);
  });
});
