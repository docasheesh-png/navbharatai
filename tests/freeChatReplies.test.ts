// FREE_CHAT_ANSWER_ALL + STUDENT_TEACHER_PROMO (2026-10-14).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  freeChatAnswerAllEnabled, studentTeacherPromoEnabled, detectReplyLanguage, isAppBuildRequest, proLine,
  missingProLine, isAboutNavBharatAI, isStudyAppRequest, teacherPromoFor, FREE_ANSWER_ALL_RULES, TEACHER_AI_NAME,
} from '../src/server/lib/freeChatReplies';

afterEach(() => { delete process.env.FREE_CHAT_ANSWER_ALL; delete process.env.STUDENT_TEACHER_PROMO; });

describe('flags', () => {
  it('both default ON; "off" is the kill switch', () => {
    expect(freeChatAnswerAllEnabled()).toBe(true);
    expect(studentTeacherPromoEnabled()).toBe(true);
    process.env.FREE_CHAT_ANSWER_ALL = 'off';
    process.env.STUDENT_TEACHER_PROMO = 'OFF';
    expect(freeChatAnswerAllEnabled()).toBe(false);
    expect(studentTeacherPromoEnabled()).toBe(false);
    expect(teacherPromoFor('Build a quiz app for my exam')).toBeNull();
  });
});

describe('the "Best job" bug', () => {
  const msg = 'Best job ke bare me batao';
  it('is NOT an app request, so no Pro line and no app pitch', () => {
    expect(isAppBuildRequest(msg)).toBe(false);
    expect(missingProLine('Yeh rahi best jobs: ...', msg)).toBe('');
  });
  it('does not pull the app-navigation block', () => {
    expect(isAboutNavBharatAI(msg)).toBe(false);
  });
  it('other non-app questions are not app requests either', () => {
    for (const q of ['Which app is best for UPI?', 'Tell me about the best jobs in India', 'chai kaise banate hain',
      'मुझे सरकारी नौकरी के बारे में बताओ', 'WhatsApp kaise install kare', 'photo banao']) {
      expect(isAppBuildRequest(q), q).toBe(false);
    }
  });
  it('the rules forbid pitching an app for a question', () => {
    expect(FREE_ANSWER_ALL_RULES).toMatch(/NEVER turn a question into an app pitch/);
  });
  it('the replacement regex matches the real free prompt in chat.ts', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/chat.ts'), 'utf8');
    expect(/APP BUILDING — LEAD WITH NavBharatAI Pro[\s\S]*?(?=\nHARD LIMITS:)/.test(src)).toBe(true);
  });
});

describe('app-build requests get the ONE Pro line in the user language', () => {
  const cases: Array<[string, 'hi' | 'hinglish' | 'en']> = [
    ['मेरे लिए एक किराना दुकान का ऐप बनाओ', 'hi'],
    ['Ek todo app bana do mere liye', 'hinglish'],
    ['Build me an expense tracker app', 'en'],
  ];
  for (const [m, lang] of cases) {
    it(`${lang}: ${m}`, () => {
      expect(isAppBuildRequest(m)).toBe(true);
      expect(detectReplyLanguage(m)).toBe(lang);
      expect(missingProLine('Features: ...', m)).toBe(`\n\n${proLine(lang)}`);
      // the model already wrote it → nothing added (never twice)
      expect(missingProLine(`Features...\n${proLine(lang)}`, m)).toBe('');
    });
  }
  it('other languages fall back to English for the server-appended line', () => {
    expect(detectReplyLanguage('আমার জন্য একটি অ্যাপ বানাও')).toBe('other');
  });
});

describe('student → Teacher AI', () => {
  it('uses the real Mode name', () => {
    const cfg = readFileSync(join(__dirname, '..', 'src/components/professionals/professionalConfigs.ts'), 'utf8');
    expect(cfg).toContain(`name: '${TEACHER_AI_NAME}'`);
  });
  it('study/exam app prompts get the promo in their language, others do not', () => {
    process.env.STUDENT_TEACHER_PROMO = 'on';
    expect(isStudyAppRequest('Build a mock test app for NEET')).toBe(true);
    expect(teacherPromoFor('Build a mock test app for NEET')).toMatch(/Mode → Teacher AI/);
    expect(teacherPromoFor('Mere exam ki padhai ke liye quiz app banao')).toMatch(/Students ke liye/);
    expect(teacherPromoFor('परीक्षा की तैयारी के लिए ऐप बनाओ')).toMatch(/छात्रों के लिए/);
    expect(teacherPromoFor('Build a restaurant menu app')).toBeNull();
  });
  it('the promo never blocks the build (emitted as a narration note only)', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toMatch(/const promo = teacherPromoFor\(String\(prompt \?\? ''\)\); if \(promo\) emit\(\{ type: 'narration'/);
  });
});
