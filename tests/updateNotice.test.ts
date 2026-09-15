import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { updateNoticeText } from '../src/lib/updateNotice';

/**
 * The app-update chat notice (admin 2026-07-20).
 *
 * 🔴 IT NO LONGER PICKS A LANGUAGE (admin 2026-09-14): "ui me professional language (english only)
 * honi chahiye … south india wale kaise padhenge isko??" The Hindi and Hinglish variants are gone,
 * and so is the DETECTOR that chose between them — a chooser with one choice is dead machinery that
 * invites the second choice back.
 */
describe('updateNoticeText', () => {
  it('tells the user what happened and what to do', () => {
    const t = updateNoticeText();
    expect(t.body).toMatch(/new version/i);
    expect(t.body).toMatch(/NavBharatAI/);
    expect(t.button).toMatch(/update/i);
  });

  it('🔒 is English — no Devanagari anywhere in it', () => {
    expect(JSON.stringify(updateNoticeText())).not.toMatch(/[\u0900-\u097F]/);
  });

  it('🔒 the language detector is GONE, not merely unused', () => {
    const src = readFileSync('src/lib/updateNotice.ts', 'utf8');
    expect(src).not.toContain('detectNoticeLang');
    expect(src).not.toContain('HINGLISH_TOKENS');
    expect(src).not.toMatch(/NoticeLang\b/);
  });

  it('the notice component asks for no user text — there is no language to infer', () => {
    const c = readFileSync('src/components/AppUpdateChatNotice.tsx', 'utf8');
    expect(c).toContain('updateNoticeText()');
    expect(c).not.toContain('userText');
  });
});
