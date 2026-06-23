import { describe, it, expect } from 'vitest';
import { classifyIntent } from './IntentClassifier';

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

  describe('build / engineering → build', () => {
    it('classifies "build me a todo app" as build', () => {
      expect(classifyIntent('build me a todo app')).toBe('build');
    });

    it('classifies "ek login page banao" as build', () => {
      expect(classifyIntent('ek login page banao')).toBe('build');
    });

    it('classifies "fix the navbar bug" as build', () => {
      expect(classifyIntent('fix the navbar bug')).toBe('build');
    });

    it('classifies a long detailed request as build', () => {
      const long =
        'I would like a complete e-commerce experience with a product listing, ' +
        'a shopping cart, a checkout flow and order history persisted somewhere reliable.';
      expect(long.length).toBeGreaterThan(120);
      expect(classifyIntent(long)).toBe('build');
    });
  });

  describe('conservative defaults → build', () => {
    it('classifies an ambiguous short noun "react" as build', () => {
      expect(classifyIntent('react')).toBe('build');
    });

    it('classifies an empty string as build (safe default)', () => {
      expect(classifyIntent('')).toBe('build');
    });

    it('classifies whitespace-only input as build (safe default)', () => {
      expect(classifyIntent('   ')).toBe('build');
    });

    it('treats a build signal mixed with social text as build', () => {
      expect(classifyIntent('thanks, now build me a login page')).toBe('build');
    });

    it('treats a message with a URL to work on as build', () => {
      expect(classifyIntent('look at https://example.com')).toBe('build');
    });
  });

  it('is case-insensitive', () => {
    expect(classifyIntent('HELLO')).toBe('chat');
    expect(classifyIntent('BUILD A PAGE')).toBe('build');
  });
});
