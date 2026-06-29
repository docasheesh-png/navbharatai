import { describe, it, expect } from 'vitest';
import { classifyIntent, classifyIntentWithConfidence, classifyIntentSmart } from './IntentClassifier';

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

  it('is case-insensitive', () => {
    expect(classifyIntent('HELLO')).toBe('chat');
    expect(classifyIntent('BUILD A PAGE')).toBe('new_build');
    expect(classifyIntent('FIX THE BUG')).toBe('edit_existing');
  });
});
