// "Does NavBharatAI Pro v5 know how a user actually GETS their app as an installable file?"
//
// The admin asked exactly that (2026-08-04), after an .apk finally built and downloaded. The honest
// answer at the time was NO — and the irony mattered: every OTHER AI in NavBharatAI (Free chat, Pro
// chat, Doctor, Engineer, Professionals) is fed the AppKnowledgeBase through AppContextInjector and
// could already answer it, while AgentV3 — the one assistant that actually BUILDS the app — was never
// given the knowledge base, so it was the only one that could not tell you how to hold the result.
//
// These tests lock both halves of the fix:
//   1. v5's own build prompt carries the navigation fact (kept lean — the fact, not the whole KB).
//   2. The AppKnowledgeBase entry every other AI reads names the NEW, shorter route as well, so all of
//      them give the same answer instead of drifting into two different sets of directions.

import { describe, it, expect } from 'vitest';
import { architectSystemPrompt } from './systemPrompt';
import { AppContextInjector } from '../AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../AppContext/AppKnowledgeBase';

describe('v5 can answer "how do I get my app as an Android file?"', () => {
  const prompt = architectSystemPrompt();

  it('knows the destination — the More tab, and the longer Other AI route', () => {
    expect(prompt).toMatch(/"More" tab/);
    expect(prompt).toMatch(/Download APK/);
    expect(prompt).toMatch(/Other AI → Publish & Deploy → APK Builder/);
  });

  it('knows which buttons to press, in order', () => {
    expect(prompt).toContain('Get my app ready to build');
    expect(prompt).toContain('Build my APK now');
  });

  it('answers instead of starting a build — a question is not a build request', () => {
    expect(prompt).toMatch(/answer them, do NOT start building/i);
  });

  it('states the signing-key truth correctly: .apk needs none, only Play does', () => {
    expect(prompt).toMatch(/needs NO signing key/i);
    expect(prompt).toMatch(/permanent identity/i);
    // The key must never be described as something NavBharatAI holds or creates.
    expect(prompt).toMatch(/NavBharatAI never sees it/i);
  });

  it('does not promise a fake local build — the file is built remotely and handed back', () => {
    expect(prompt).toMatch(/builds it there on a real machine/i);
  });
});

describe('every OTHER AI gives the SAME answer (one knowledge base, no drift)', () => {
  const apk = APP_KNOWLEDGE_BASE.find((f) => f.id === 'apk_builder')!;

  it('the APK entry exists and names both routes', () => {
    expect(apk).toBeTruthy();
    expect(apk.path).toMatch(/More/);
    expect(apk.path).toMatch(/Download APK/);
    expect(apk.path).toMatch(/Other AI/);
  });

  it('the fastest route leads the how-to, so a user is not sent the long way round', () => {
    expect(apk.howToUse).toMatch(/FASTEST WAY/);
    expect(apk.howToUse.indexOf('More')).toBeLessThan(apk.howToUse.indexOf('Other AI'));
  });

  it.each([
    'apk kaise banaye',
    'mujhe apk download karni hai',
    'how do I download the apk',
    'app ko phone me install kaise karu',
    'where do I build the android app',
  ])('a real user question surfaces it: %s', (question) => {
    const ctx = AppContextInjector.getRelevantContext(question, 'pro_chat');
    expect(ctx).toMatch(/APK Builder/);
  });

  it('and the surfaced answer carries the SHORT route, not only the old one', () => {
    const ctx = AppContextInjector.getRelevantContext('apk kaise download karu', 'pro_chat');
    expect(ctx).toMatch(/Download APK/);
  });

  it('a plain build request is NOT answered with APK directions', () => {
    // The injector legitimately surfaces other features for this message (dark mode, the builder
    // itself) — that is its job. What must not happen is unsolicited APK/Play-Store guidance derailing
    // someone who only asked for an app.
    const ctx = AppContextInjector.getRelevantContext('build me a todo app with dark mode', 'pro_chat');
    expect(ctx).not.toMatch(/APK Builder/);
  });
});
