// BR1962 (report be761ff8, 2026-11-08) — user-stopped edit, 12.5 s, nothing written.
// The prompt asked to replace demo replies in src/lib/aiService.ts with a real AI connection
// and listed nine numbered implementation/QA steps (inspect the file, never show fake replies,
// keep the existing design, …). APP_SCOPE said LARGE because of "~10 distinct features":
// featureCount's legacy numbered-line tally counted every Requirements: line, while the shared
// enumerator (MAX_ITEM_WORDS, isItem) saw only three short named parts. Software Project Mode
// did not create a plan (not a fresh build), but the same count on a new app would spend a
// planner call. Numbered lines now use the same isFeatureLine filters — only ever a smaller count.
import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { countEnumeratedFeatures, enumeratedFeatureItems } from '../src/server/AgentV3/enumeratedFeatures';

const BR1962 = `Now I want to make NOVA AI a real AI assistant.

Your review identified that src/lib/aiService.ts currently returns demo results instead of real AI responses.

Please fix this.

Requirements:

1. Inspect src/lib/aiService.ts.
2. Identify the existing connected AI service or available platform integration.
3. Replace all hardcoded and randomly generated demo responses with genuine AI-generated responses.
4. Connect the chat interface to the real AI service.
5. Support Hindi and English conversations.
6. Maintain chat history and conversation context.
7. Handle loading, timeout and API errors properly.
8. Never display fake AI responses.
9. Keep the existing NOVA AI design and all working features unchanged.

IMPORTANT:
Do not invent an API key or pretend an AI service is connected.

If an external API key or paid service is required, explain exactly what is needed before proceeding.

Test the chatbot with:
"Who is the President of India?"
and
"भारत की राजधानी क्या है?"

Confirm whether the responses come from a real AI model.`;

describe('a quality checklist is not ten product features (BR1962)', () => {
  it('the BR1962 edit is not scoped LARGE for ~10 features', () => {
    const s = analyzeAppScope(BR1962);
    expect(s.signals.join(' ')).not.toMatch(/distinct features requested/);
    expect(s.size).toBe('small');
    expect(s.decision).toBe('direct');
    expect(s.famousApp).toBeNull();
    expect(countEnumeratedFeatures(BR1962)).toBeLessThan(8);
    expect(enumeratedFeatureItems(BR1962).length).toBeLessThan(8);
  });
});

describe('🔒 neighbours: short numbered product lists and comma-module lists still escalate', () => {
  it('eight short numbered features are still LARGE', () => {
    const p = `Build a school ERP:
1. Students
2. Teachers
3. Attendance
4. Fees
5. Exams
6. Timetable
7. Library
8. Transport`;
    const s = analyzeAppScope(p);
    expect(s.decision).toBe('analyze');
    expect(s.size).toBe('large');
    expect(s.signals.join(' ')).toMatch(/distinct features requested/);
  });

  it('a one-line comma list of eight modules is still LARGE', () => {
    const p = 'school ERP with students, teachers, attendance, fees, exams, timetable, library, transport';
    const s = analyzeAppScope(p);
    expect(s.decision).toBe('analyze');
    expect(s.size).toBe('large');
  });

  it('"youtube ki tarah ek app" still clones', () => {
    const s = analyzeAppScope('youtube ki tarah ek app');
    expect(s.famousApp).toBe('YouTube');
    expect(s.decision).toBe('analyze');
  });
});
