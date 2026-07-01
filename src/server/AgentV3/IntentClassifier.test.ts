import { describe, it, expect } from 'vitest';
import { classifyIntent, classifyIntentWithConfidence, classifyIntentSmart, wantsFreshStart } from './IntentClassifier';

describe('wantsFreshStart — only an EXPLICIT reset overrides "edit the existing project"', () => {
  it('detects clear start-over phrases (English)', () => {
    expect(wantsFreshStart('scrap this and start over')).toBe(true);
    expect(wantsFreshStart('build it again from scratch')).toBe(true);
    expect(wantsFreshStart('delete everything and rebuild')).toBe(true);
    expect(wantsFreshStart('I want a brand new app')).toBe(true);
    expect(wantsFreshStart('start fresh please')).toBe(true);
  });
  it('detects Hinglish start-over phrases', () => {
    expect(wantsFreshStart('naye sire se banao')).toBe(true);
    expect(wantsFreshStart('sab kuch delete karke naya project banao')).toBe(true);
    expect(wantsFreshStart('phir se shuru karo bilkul')).toBe(true);
  });
  it('does NOT treat a normal feature request as a fresh start (the whole point of the fix)', () => {
    expect(wantsFreshStart('add a dashboard page')).toBe(false);
    expect(wantsFreshStart('make the header bigger')).toBe(false);
    expect(wantsFreshStart('ek login page banao')).toBe(false);
    expect(wantsFreshStart('create a settings screen')).toBe(false);
    expect(wantsFreshStart('build a profile component')).toBe(false);
    expect(wantsFreshStart('')).toBe(false);
  });
});

describe('classifyIntent — continuation phrases resume the build (NOT the amnesiac chat path)', () => {
  it('routes "please continue" / "continue" to edit_existing, not chat', () => {
    expect(classifyIntent('please continue')).toBe('edit_existing');
    expect(classifyIntent('continue')).toBe('edit_existing');
    expect(classifyIntent('go on')).toBe('edit_existing');
    expect(classifyIntent('keep going')).toBe('edit_existing');
    expect(classifyIntent('finish it')).toBe('edit_existing');
  });
  it('handles Hinglish continuation phrases', () => {
    expect(classifyIntent('aage badho')).toBe('edit_existing');
    expect(classifyIntent('continue karo')).toBe('edit_existing');
    expect(classifyIntent('poora karo')).toBe('edit_existing');
  });
  it('routes retry/redo (the "retry" button) to edit_existing, not the amnesiac chat path', () => {
    // The timeout "retry" button + common retry phrasings must resume the SAME project with memory.
    expect(classifyIntent('retry')).toBe('edit_existing');
    expect(classifyIntent('try again')).toBe('edit_existing');
    expect(classifyIntent('please try again')).toBe('edit_existing');
    expect(classifyIntent('do it again')).toBe('edit_existing');
    expect(classifyIntent('one more time')).toBe('edit_existing');
    // Hinglish retry
    expect(classifyIntent('dobara')).toBe('edit_existing');
    expect(classifyIntent('phir se')).toBe('edit_existing');
    expect(classifyIntent('retry karo')).toBe('edit_existing');
  });
  it('word-boundary: a retry signal embedded in a larger word does not trigger continuation', () => {
    // "retrying" contains "retry" but must NOT be matched (matchesSignal is word-boundary aware).
    // A real build request that happens to contain it still classifies on its own merits.
    expect(classifyIntent('build a network monitor that shows retrying connections')).toBe('new_build');
  });
  it('marks continuation HIGH-confidence so the LLM upgrade cannot downgrade it to chat', async () => {
    expect(classifyIntentWithConfidence('please continue')).toEqual({ intent: 'edit_existing', confidence: 'high', signal: 'continuation' });
    // Even if the LLM (wrongly) says "chat", high confidence short-circuits before the LLM is called.
    const llm = async () => 'chat';
    expect(await classifyIntentSmart('please continue', llm)).toBe('edit_existing');
  });
  it('does not hijack a real build that merely contains a build verb', () => {
    expect(classifyIntent('build a todo app')).toBe('new_build');
    expect(classifyIntent('continue building the dashboard and add a chart')).toBe('new_build');
  });
});

describe('classifyIntent — "something isn\'t working" bug reports resume the build, not chit-chat', () => {
  it('routes a short Hinglish "X nahi chala" complaint to edit_existing (real report: "previw nahi chala")', () => {
    // Real user report: a typo'd "preview nahi chala" ("the preview didn't work") was answered with a
    // sympathetic chat reply instead of actually checking/fixing the preview — because the bare word
    // "nahi" alone matches the SOCIAL_PATTERNS short-acknowledgement check ("nahi" as a standalone "no").
    expect(classifyIntent('previw nahi chala')).toBe('edit_existing');
    expect(classifyIntent('preview nahi chala')).toBe('edit_existing');
    expect(classifyIntent('nahi chala')).toBe('edit_existing');
    expect(classifyIntent('chal nahi raha')).toBe('edit_existing');
  });
  it('routes English "not working" phrasings to edit_existing', () => {
    expect(classifyIntent('preview not working')).toBe('edit_existing');
    expect(classifyIntent("it doesn't work")).toBe('edit_existing');
    expect(classifyIntent('it is broken')).toBe('edit_existing');
    expect(classifyIntent('not loading')).toBe('edit_existing');
  });
  it('marks a problem report HIGH-confidence so the LLM upgrade cannot downgrade it to chat', async () => {
    expect(classifyIntentWithConfidence('preview nahi chala')).toEqual({ intent: 'edit_existing', confidence: 'high', signal: 'problem-report' });
    const llm = async () => 'chat';
    expect(await classifyIntentSmart('preview nahi chala', llm)).toBe('edit_existing');
  });
  it('a bare standalone "nahi" (answering a yes/no question) is still chat — only a real complaint sentence is not', () => {
    expect(classifyIntent('nahi')).toBe('chat');
    expect(classifyIntent('no')).toBe('chat');
  });
});

describe('classifyIntent — comparison/explanation asks are chat, not a build (real report: "v3.0 aur claude code ko campair karo")', () => {
  it('routes the exact reported message to chat, not a ~9-minute build', () => {
    // Real report: v3.0 spent a full build cycle ("Estimated build time: ~9 min", "Setting up your
    // workspace…") answering what was only a comparison QUESTION — because the message contains "code"
    // (as part of "Claude Code"), a BUILD_SIGNALS keyword, which used to win by default.
    expect(classifyIntent('v3.0 aur claude code ko campair karo')).toBe('chat');
  });
  it('routes English "compare X and Y" / "X vs Y" phrasings to chat', () => {
    expect(classifyIntent('compare v3.0 and Claude Code')).toBe('chat');
    expect(classifyIntent('react vs vue, which is better?')).toBe('chat');
    expect(classifyIntent('what is the difference between vite and webpack')).toBe('chat');
  });
  it('routes Hinglish comparison phrasings to chat', () => {
    expect(classifyIntent('kya farak hai in dono me')).toBe('chat');
    expect(classifyIntent('tulna karo dono ki')).toBe('chat');
  });
  it('marks it HIGH-confidence so the LLM upgrade cannot be talked into a build', async () => {
    expect(classifyIntentWithConfidence('v3.0 aur claude code ko campair karo')).toEqual({ intent: 'chat', confidence: 'high', signal: 'informational' });
    const llm = async () => 'build';
    expect(await classifyIntentSmart('v3.0 aur claude code ko campair karo', llm)).toBe('chat');
  });
  it('an explicit build/edit verb still wins over a comparison mention in the same message', () => {
    expect(classifyIntent('build a comparison table and compare products')).toBe('new_build');
    expect(classifyIntent('fix the compare button, it is broken')).toBe('edit_existing');
  });
});

describe('classifyIntentSmart — intention-aware gatekeeper (not keyword-locked)', () => {
  it('ambiguous tech-noun messages are NO LONGER hard-locked — they consult the LLM', async () => {
    // "the notes app keeps crashing" contains the build noun 'app' but is a QUESTION. It used to be
    // high-confidence new_build (LLM never consulted); now it is low-confidence so the LLM decides.
    expect(classifyIntentWithConfidence('the notes app keeps crashing').confidence).toBe('low');
    let asked = false;
    const llm = async () => { asked = true; return 'chat'; };
    expect(await classifyIntentSmart('the notes app keeps crashing', llm)).toBe('chat');
    expect(asked).toBe(true);
  });

  it('feeds project + conversation context into the LLM so it reads intention', async () => {
    let seenPrompt = '';
    const llm = async (p: string) => { seenPrompt = p; return 'edit'; };
    const res = await classifyIntentSmart('add a dark mode toggle', llm, {
      projectExists: true,
      recentRequests: ['build a notes app', 'add a search bar'],
    });
    expect(res).toBe('edit_existing');
    expect(seenPrompt).toContain('ALREADY has a working project'); // project context fed in
    expect(seenPrompt).toContain('build a notes app');             // conversation context fed in
  });

  it('still short-circuits CLEAR cases without calling the LLM (fast + cheap)', async () => {
    let asked = false;
    const llm = async () => { asked = true; return 'chat'; };
    expect(await classifyIntentSmart('build me a calculator app', llm)).toBe('new_build'); // explicit build verb
    expect(await classifyIntentSmart('fix the login bug', llm)).toBe('edit_existing');     // explicit edit verb
    expect(asked).toBe(false);
  });

  it('falls back to the keyword result when the LLM fails (never blocks or breaks)', async () => {
    const llm = async () => { throw new Error('llm down'); };
    expect(await classifyIntentSmart('add a payment button', llm)).toBe('new_build');
  });
});

describe('classifyIntent', () => {
  describe('social / conversational → chat', () => {
    it('classifies "hello" as chat', () => {
      expect(classifyIntent('hello')).toBe('chat');
    });

    it('classifies "namaste kaise ho" as chat', () => {
      expect(classifyIntent('namaste kaise ho')).toBe('chat');
    });

    it('classifies "thanks" as chat', () => {
      expect(classifyIntent('thanks')).toBe('chat');
    });

    it('classifies "tum kya kar sakte ho" as chat', () => {
      expect(classifyIntent('tum kya kar sakte ho')).toBe('chat');
    });

    it('classifies common greetings/acknowledgements as chat', () => {
      expect(classifyIntent('hi')).toBe('chat');
      expect(classifyIntent('hey there')).toBe('chat');
      expect(classifyIntent('who are you')).toBe('chat');
      expect(classifyIntent('thank you')).toBe('chat');
      expect(classifyIntent('cool')).toBe('chat');
    });
  });

  describe('new build → new_build', () => {
    it('classifies "build me a todo app" as new_build', () => {
      expect(classifyIntent('build me a todo app')).toBe('new_build');
    });

    it('classifies "ek login page banao" as new_build', () => {
      expect(classifyIntent('ek login page banao')).toBe('new_build');
    });

    it('classifies a long detailed request as new_build', () => {
      const long =
        'I would like a complete e-commerce experience with a product listing, ' +
        'a shopping cart, a checkout flow and order history persisted somewhere reliable.';
      expect(long.length).toBeGreaterThan(120);
      expect(classifyIntent(long)).toBe('new_build');
    });

    it('classifies "create a React dashboard" as new_build', () => {
      expect(classifyIntent('create a React dashboard')).toBe('new_build');
    });

    it('classifies "make a calculator app" as new_build', () => {
      expect(classifyIntent('make a calculator app')).toBe('new_build');
    });

    it('classifies "generate an e-commerce site" as new_build', () => {
      expect(classifyIntent('generate an e-commerce site')).toBe('new_build');
    });

    it('classifies "design a landing page" as new_build', () => {
      expect(classifyIntent('design a landing page')).toBe('new_build');
    });

    it('classifies "deploy the app to production" as new_build', () => {
      expect(classifyIntent('deploy the app to production')).toBe('new_build');
    });

    it('new_build signal wins even when edit signal is also present', () => {
      expect(classifyIntent('build a new page and fix the footer')).toBe('new_build');
      expect(classifyIntent('create the app and debug the login')).toBe('new_build');
    });
  });

  describe('edit existing → edit_existing', () => {
    it('classifies "fix the navbar bug" as edit_existing', () => {
      expect(classifyIntent('fix the navbar bug')).toBe('edit_existing');
    });

    it('classifies "update the button color" as edit_existing', () => {
      expect(classifyIntent('update the button color')).toBe('edit_existing');
    });

    it('classifies "change the header text" as edit_existing', () => {
      expect(classifyIntent('change the header text')).toBe('edit_existing');
    });

    it('classifies "refactor the auth module" as edit_existing', () => {
      expect(classifyIntent('refactor the auth module')).toBe('edit_existing');
    });

    it('classifies "remove the sidebar" as edit_existing', () => {
      expect(classifyIntent('remove the sidebar')).toBe('edit_existing');
    });

    it('classifies "rename the function" as edit_existing', () => {
      expect(classifyIntent('rename the function')).toBe('edit_existing');
    });

    it('classifies "debug the payment flow" as edit_existing', () => {
      expect(classifyIntent('debug the payment flow')).toBe('edit_existing');
    });

    it('classifies "improve the loading animation" as edit_existing', () => {
      expect(classifyIntent('improve the loading animation')).toBe('edit_existing');
    });

    it('classifies Hindi edit requests as edit_existing', () => {
      expect(classifyIntent('theek karo yeh button')).toBe('edit_existing');
      expect(classifyIntent('badlo yeh color')).toBe('edit_existing');
      expect(classifyIntent('sudharo login page')).toBe('edit_existing');
      expect(classifyIntent('hatao yeh footer')).toBe('edit_existing');
    });

    it('classifies "fix karo yeh bug" as edit_existing', () => {
      expect(classifyIntent('fix karo yeh bug')).toBe('edit_existing');
    });

    it('classifies "update karo navbar ki color" as edit_existing', () => {
      expect(classifyIntent('update karo navbar ki color')).toBe('edit_existing');
    });
  });

  describe('conservative defaults → new_build', () => {
    it('classifies an ambiguous short noun "react" as new_build', () => {
      expect(classifyIntent('react')).toBe('new_build');
    });

    it('classifies an empty string as new_build (safe default)', () => {
      expect(classifyIntent('')).toBe('new_build');
    });

    it('classifies whitespace-only input as new_build (safe default)', () => {
      expect(classifyIntent('   ')).toBe('new_build');
    });

    it('treats a build signal mixed with social text as new_build', () => {
      expect(classifyIntent('thanks, now build me a login page')).toBe('new_build');
    });

    it('treats a message with a URL to work on as new_build', () => {
      expect(classifyIntent('look at https://example.com')).toBe('new_build');
    });

    it('classifies "add a payment button" as new_build (ambiguous verb)', () => {
      expect(classifyIntent('add a payment button')).toBe('new_build');
    });
  });

  describe('true last-resort default is now chat, not new_build (admin decision, 2026-07-01: "text reply > build app")', () => {
    it('a genuinely signal-free message (no build/edit/informational/problem/continuation word, not short, not social) defaults to chat', () => {
      // No word here matches NEW_BUILD/EDIT/BUILD_SIGNALS, INFORMATIONAL_SIGNALS, CONTINUATION_SIGNALS,
      // PROBLEM_SIGNALS, or SOCIAL_PATTERNS, and it's longer than the 3-word short-message cutoff — the
      // TRUE bare fallback, which used to silently start a build for an ambiguous non-build message.
      expect(classifyIntent('tell me something interesting please')).toBe('chat');
      expect(classifyIntentWithConfidence('tell me something interesting please')).toEqual({ intent: 'chat', confidence: 'low', signal: 'default' });
    });
    it('stays LOW confidence so the LLM upgrade (with project/conversation context) still gets the final say when available', async () => {
      const llm = async () => 'edit'; // a genuine build/edit request phrased unusually
      expect(await classifyIntentSmart('tell me something interesting please', llm)).toBe('edit_existing');
    });
    it('every EARLIER, more specific signal still wins — this default only fires when truly nothing else matched', () => {
      // Unaffected: an explicit build/edit verb, a BUILD_SIGNALS tech noun, a comparison/problem/
      // continuation phrase, a long message, a URL, or a short/social message all resolve BEFORE
      // reaching this tail default, exactly as before.
      expect(classifyIntent('build me a todo app')).toBe('new_build');
      expect(classifyIntent('add a payment button')).toBe('new_build');
      expect(classifyIntent('fix the login bug')).toBe('edit_existing');
      expect(classifyIntent('hi')).toBe('chat');
    });
  });

  it('is case-insensitive', () => {
    expect(classifyIntent('HELLO')).toBe('chat');
    expect(classifyIntent('BUILD A PAGE')).toBe('new_build');
    expect(classifyIntent('FIX THE BUG')).toBe('edit_existing');
  });
});
