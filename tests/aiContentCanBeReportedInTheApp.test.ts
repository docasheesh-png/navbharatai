import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  validateReport, aiReportMessage, reportHeadline, AI_REPORT_REASONS, AI_REPORT_EXCERPT_MAX, MESSAGE_MIN, MESSAGE_MAX,
} from '../src/lib/userReport';
import { ReportAiContent } from '../src/components/chat/ReportAiContent';

// GOOGLE PLAY, 2026-09-28, rejecting version 139: "We allow apps that prohibit and prevent the generation
// of Restricted Content AND contain in-app user reporting/flagging features." The general "Report a
// problem" sheet existed, but nothing sat ON the AI output itself — so a reviewer looking at an
// offensive picture could not flag THAT picture without leaving it. These tests hold the flag in place.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('an AI-content report is a real report the server accepts', () => {
  it('validateReport accepts the `ai` kind with no target id (the content is attached to the report)', () => {
    const r = validateReport({ message: 'Reported AI image: Sexual or nude.', targetKind: 'ai' });
    expect(r).toMatchObject({ ok: true, kind: 'ai' });
  });

  it('still refuses a kind nobody defined', () => {
    expect(validateReport({ message: 'hello there', targetKind: 'nope' }).ok).toBe(false);
  });

  it('the admin list names it "AI content"', () => {
    expect(reportHeadline({ target: { kind: 'ai' }, message: 'Reported AI reply: Hateful or abusive.' }))
      .toMatch(/^AI content · /);
  });
});

describe('aiReportMessage — the text the admin reads', () => {
  it('a reason alone is a complete, valid report', () => {
    for (const r of AI_REPORT_REASONS) {
      const m = aiReportMessage({ surface: 'image', reason: r.id });
      expect(m.length).toBeGreaterThanOrEqual(MESSAGE_MIN);
      expect(m).toContain(r.label);
      expect(validateReport({ message: m, targetKind: 'ai' }).ok).toBe(true);
    }
  });

  it('carries the prompt of a picture and the text of a reply, labelled as such', () => {
    expect(aiReportMessage({ surface: 'image', reason: 'sexual', content: 'a woman on a beach' }))
      .toContain('Prompt: a woman on a beach');
    expect(aiReportMessage({ surface: 'reply', reason: 'hateful', content: 'some reply' }))
      .toContain('Reply: some reply');
  });

  it('bounds a long reply so a report can never be refused for its size', () => {
    const m = aiReportMessage({ surface: 'reply', reason: 'other', content: 'x'.repeat(10_000), note: 'n'.repeat(3000) });
    expect(m.length).toBeLessThanOrEqual(MESSAGE_MAX);
    expect(validateReport({ message: m, targetKind: 'ai' }).ok).toBe(true);
    expect(AI_REPORT_EXCERPT_MAX).toBeLessThan(MESSAGE_MAX);
  });
});

describe('the flag button', () => {
  it('renders a real, labelled button — visible, not hover-only', () => {
    const html = renderToStaticMarkup(createElement(ReportAiContent, { surface: 'image', content: 'x' }));
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Report this AI image"');
    expect(html).not.toMatch(/opacity-0/);
  });

  it('posts to the real report route as kind `ai`, with the picture attached when there is one', () => {
    const src = read('src/components/chat/ReportAiContent.tsx');
    expect(src).toContain("fetch('/api/report'");
    expect(src).toContain("targetKind: 'ai'");
    expect(src).toMatch(/screenshot \? \{ screenshot \}/);
  });
});

describe('every AI surface carries the flag (source guard)', () => {
  const surfaces: Array<[string, string]> = [
    ['AI Image Generator', 'src/components/ide/AIImageGenerator.tsx'],
    ['NavBharatAI chat', 'src/components/ide/AIChat.tsx'],
    ['Professionals', 'src/components/professionals/ProfessionalChat.tsx'],
    ['Doctor AI', 'src/components/sda/SDAChat.tsx'],
  ];
  for (const [name, file] of surfaces) {
    it(`${name} renders <ReportAiContent>`, () => {
      expect(read(file)).toMatch(/<ReportAiContent\b/);
    });
  }

  it('the image generator hides a reported picture at once', () => {
    const src = read('src/components/ide/AIImageGenerator.tsx');
    expect(src).toMatch(/reportedIds\.has\(item\.id\)/);
    expect(src).toMatch(/onReported=\{\(\) => setReportedIds/);
  });

  it('the chat flag is not hidden behind hover (a phone has no hover)', () => {
    const src = read('src/components/ide/AIChat.tsx');
    const at = src.indexOf('<ReportAiContent');
    expect(src.slice(at, at + 500)).not.toMatch(/opacity-0/);
  });
});
