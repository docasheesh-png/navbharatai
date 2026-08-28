import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { offTopicSummaryNotice, quotedAppName, significantWords } from './offTopicSummary';

const HOSPITAL_PROMPT = 'Build a professional, mobile-first medical app named “Hospital Emergency Management”.\n\nHome Page…';
const DINO_SUMMARY = 'Aapka **Dino Run** game taiyaar hai! 🎮\n\n## Live Game\n🔗 Khelne ke liye yahan click karein';

describe('THE REAL FAILURE: the Dino Run summary on the hospital build (report 2026-08-28)', () => {
  it('fires on the exact prompt + summary pair from the report', () => {
    const n = offTopicSummaryNotice(HOSPITAL_PROMPT, DINO_SUMMARY);
    expect(n).not.toBeNull();
    expect(n).toContain('Hospital Emergency Management');
    expect(n).toMatch(/never mentions it/);
    expect(n).toMatch(/Open the preview/);
  });

  it('stays SILENT the moment the summary mentions any word of the name', () => {
    expect(offTopicSummaryNotice(HOSPITAL_PROMPT, 'Your Hospital app is ready with 4 pages.')).toBeNull();
    expect(offTopicSummaryNotice(HOSPITAL_PROMPT, 'Emergency triage flows are live.')).toBeNull();
    expect(offTopicSummaryNotice(HOSPITAL_PROMPT, 'The management dashboard renders.')).toBeNull();
  });
});

describe('deliberately narrow — a false alarm would stamp doubt on good builds', () => {
  it('no quoted name in the prompt → never fires, whatever the summary says', () => {
    expect(offTopicSummaryNotice('build me a hospital app', DINO_SUMMARY)).toBeNull();
  });

  it('a one-word quoted name is not distinctive enough to accuse a summary with', () => {
    expect(offTopicSummaryNotice('an app named “Zenith”', 'Your dashboard is ready.')).toBeNull();
  });

  it('an empty summary is nothing to warn about', () => {
    expect(offTopicSummaryNotice(HOSPITAL_PROMPT, '')).toBeNull();
  });

  it('matching is case-insensitive', () => {
    expect(offTopicSummaryNotice(HOSPITAL_PROMPT, 'HOSPITAL module done.')).toBeNull();
  });
});

describe('the name extraction', () => {
  it('reads curly and straight quotes, first distinctive name wins', () => {
    expect(quotedAppName('app named “Hospital Emergency Management”.')).toBe('Hospital Emergency Management');
    expect(quotedAppName('app named "Track My Fleet" please')).toBe('Track My Fleet');
    expect(quotedAppName('use the ‘Daily Expense Diary’ name')).toBe('Daily Expense Diary');
  });

  it('skips a short quoted fragment and finds the real name after it', () => {
    expect(quotedAppName('press “OK” in the “Hospital Emergency Management” app')).toBe('Hospital Emergency Management');
  });

  it('significantWords drops glue and keeps the words worth matching', () => {
    expect(significantWords('Hospital Emergency Management')).toEqual(['hospital', 'emergency', 'management']);
    expect(significantWords('An App For You')).toEqual([]);
  });
});

describe('WIRING — the net sits at settle, before the celebration reaches the user', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('mutates the summary and records the finding', () => {
    expect(route).toContain('offTopicSummaryNotice(prompt, result.summary)');
    expect(route).toContain("code: 'SUMMARY_OFF_TOPIC'");
  });

  it('the warning LEADS the summary — a caveat below a celebration goes unread', () => {
    const at = route.indexOf('offTopicSummaryNotice(prompt, result.summary)');
    const seg = route.slice(at, at + 400);
    expect(seg).toContain('`${offTopic}\\n\\n---\\n\\n${result.summary}`');
  });
});
