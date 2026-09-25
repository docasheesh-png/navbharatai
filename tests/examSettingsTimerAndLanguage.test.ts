/**
 * ⏱🌐 EXAM MODE SETTINGS — the timer and the paper's language (admin 2026-09-25).
 *
 * Admin, verbatim: *"exam mode me … ek setting option bhi do. user language select kar sakta hai,
 * india ki sabhi language available honi chahiye, aur time bhi user select kare. 30 sec/question,
 * 1 min/question or 2 min per question (default timer off). user yeh bhi select kare ki time per
 * question chalega ya total."* Then the two shapes, exactly:
 *
 * 1. 1 min/question, whole paper (default), 10 questions → a 10:00 clock to 0:00; at 0:00 the paper
 *    ends, the result appears, and what is left counts as skipped.
 * 2. 2 min/question, each question → a new question every 2 minutes; unanswered ⇒ skipped; the
 *    student may answer early and move on.
 *
 * The same change fixed a bug visible in the admin's screenshot of the setup form: four labels read
 * literally `—` and `…`, because JSX text and JSX attribute strings do NOT process escape
 * sequences — only JavaScript strings do. The last block locks that class across all client code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import {
  DEFAULT_EXAM_SETTINGS, clockDecision, clockTone, formatClock, formatElapsed, normalizeExamSettings, paceMs, paperBudgetMs,
  settingsSummary, skipUnanswered, timeUpNote, timerExplainer, unansweredCount,
} from '../src/components/professionals/examTimer';
import {
  EXAM_LANGUAGES, examLanguage, examPaperInstruction, normalizeExamSpec, parseExamPaper, scoreExam,
  teachMyMistakesPrompt, type ExamQuestion, type ExamSpec,
} from '../src/server/professionals/examMode';

const ROOT = join(__dirname, '..');
const EXAM_UI = readFileSync(join(ROOT, 'src/components/professionals/ExamMode.tsx'), 'utf8');

const q = (n: number): ExamQuestion => ({
  n, question: `Q${n}?`, options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`], correctIndex: 0, explanation: 'x', topic: 'T',
});
const ten = Array.from({ length: 10 }, (_, i) => q(i + 1));

describe('settings: defaults and what a bad stored value becomes', () => {
  it('the default is timer OFF, whole paper, automatic language', () => {
    expect(DEFAULT_EXAM_SETTINGS).toEqual({ language: 'auto', pace: 'off', scope: 'paper' });
    expect(normalizeExamSettings(undefined)).toEqual(DEFAULT_EXAM_SETTINGS);
  });

  it('a corrupted pace never starts a clock nobody asked for', () => {
    expect(normalizeExamSettings({ pace: '45', scope: 'question' }).pace).toBe('off');
    expect(normalizeExamSettings({ pace: 60 }).pace).toBe('off');
    expect(normalizeExamSettings({ pace: '60', scope: 'banana' })).toEqual({ language: 'auto', pace: '60', scope: 'paper' });
  });

  it('keeps a valid choice', () => {
    expect(normalizeExamSettings({ language: 'tamil', pace: '120', scope: 'question' }))
      .toEqual({ language: 'tamil', pace: '120', scope: 'question' });
  });
});

describe('the clock arithmetic', () => {
  it('admin example 1: 10 questions at 1 min is a 10:00 paper', () => {
    expect(paperBudgetMs('60', 10)).toBe(600_000);
    expect(formatClock(600_000)).toBe('10:00');
    expect(paperBudgetMs('off', 10)).toBeNull();
    expect(paceMs('30')).toBe(30_000);
    expect(paceMs('120')).toBe(120_000);
  });

  it('never shows a negative clock, and 0:01 means a second really remains', () => {
    expect(formatClock(-5_000)).toBe('0:00');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('time TAKEN rounds down: 12.3 seconds is 0:12, not 0:13', () => {
    expect(formatElapsed(12_300)).toBe('0:12');
    expect(formatElapsed(150_000)).toBe('2:30');
    expect(formatElapsed(-1)).toBe('0:00');
  });

  it('turns amber near the end and red in the last ten seconds', () => {
    expect(clockTone(300_000, 600_000)).toBe('normal');
    expect(clockTone(100_000, 600_000)).toBe('low');
    expect(clockTone(30_000, 30_000)).toBe('normal'); // a 30-second question does not open amber
    expect(clockTone(14_000, 30_000)).toBe('low');
    expect(clockTone(30_000, 120_000)).toBe('low');
    expect(clockTone(9_000, 600_000)).toBe('critical');
  });
});

describe('what the clock does at each tick', () => {
  const base = { perQMs: 60_000, paperDeadline: 600_000, shownAt: 0, answered: false };

  it('no clock ⇒ never acts', () => {
    expect(clockDecision({ ...base, scope: 'paper', perQMs: null, now: 10_000_000 })).toBe('none');
  });

  it('whole paper: ends exactly at the deadline, not before', () => {
    expect(clockDecision({ ...base, scope: 'paper', now: 599_999 })).toBe('none');
    expect(clockDecision({ ...base, scope: 'paper', now: 600_000 })).toBe('end-paper');
    // …even while an explanation is open: exam time is exam time.
    expect(clockDecision({ ...base, scope: 'paper', answered: true, now: 600_001 })).toBe('end-paper');
  });

  it('each question: skips at its own deadline, measured from when it appeared', () => {
    expect(clockDecision({ ...base, scope: 'question', shownAt: 120_000, perQMs: 120_000, now: 239_999 })).toBe('none');
    expect(clockDecision({ ...base, scope: 'question', shownAt: 120_000, perQMs: 120_000, now: 240_000 })).toBe('skip-question');
  });

  it('each question: an answered question is never skipped — answering early stops its clock', () => {
    expect(clockDecision({ ...base, scope: 'question', answered: true, now: 10_000_000 })).toBe('none');
  });
});

describe('time up: the rest counts as SKIPPED, and skipped costs nothing', () => {
  it('admin example 1: 6 answered, time up ⇒ the other 4 are skips, marks unchanged', () => {
    const given = [1, 2, 3, 4, 5, 6].map((n) => ({ n, chosen: n <= 4 ? 0 : 1 }));
    expect(unansweredCount(ten, given)).toBe(4);
    const filled = skipUnanswered(ten, given);
    expect(filled).toHaveLength(10);
    expect(filled.filter((a) => a.chosen === null)).toHaveLength(4);
    const before = scoreExam(ten, given);
    const after = scoreExam(ten, filled);
    expect(after.marks).toBe(before.marks); // 4×4 − 2 = 14, the clock took nothing earned
    expect(after.marks).toBe(14);
    expect(after.skipped).toBe(4);
    expect(after.wrong).toBe(2);
  });

  it('keeps an answer already given, including a deliberate skip', () => {
    const filled = skipUnanswered(ten, [{ n: 3, chosen: 2 }, { n: 5, chosen: null }]);
    expect(filled.find((a) => a.n === 3)).toEqual({ n: 3, chosen: 2 });
    expect(filled.find((a) => a.n === 5)).toEqual({ n: 5, chosen: null });
  });

  it('the result says what happened, in words', () => {
    expect(timeUpNote('paper', true, 4)).toBe('Time was up. 4 questions you had not answered were counted as skipped.');
    expect(timeUpNote('paper', true, 1)).toContain('1 question you had not answered was');
    expect(timeUpNote('paper', true, 0)).toBe('Time was up just as you finished.');
    expect(timeUpNote('question', false, 3)).toBe('3 questions ran out of time and were counted as skipped.');
    expect(timeUpNote('paper', false, 0)).toBe('');
    expect(timeUpNote('question', false, 0)).toBe('');
  });
});

describe('the rule is explained before the clock starts', () => {
  it('whole paper names the total for this paper', () => {
    const line = timerExplainer({ language: 'auto', pace: '60', scope: 'paper' }, 10);
    expect(line).toContain('10 questions × 1:00 = 10:00');
    expect(line).toContain('counts as skipped (0 marks)');
  });

  it('each question says the next one appears and early answers move on', () => {
    const line = timerExplainer({ language: 'auto', pace: '120', scope: 'question' }, 10);
    expect(line).toContain('Each question gets 2:00');
    expect(line).toContain('next one appears');
    expect(line).toContain('move on straight away');
  });

  it('off says so', () => {
    expect(timerExplainer(DEFAULT_EXAM_SETTINGS, 10)).toContain('No clock');
  });

  it('the setup summary shows the active settings', () => {
    expect(settingsSummary(DEFAULT_EXAM_SETTINGS, 'Automatic')).toBe('Timer off');
    expect(settingsSummary({ language: 'tamil', pace: '30', scope: 'question' }, 'Tamil'))
      .toBe('Language: Tamil · Timer: 30 sec per question, each question');
  });
});

describe('languages: every scheduled Indian language, English and Hinglish', () => {
  const SCHEDULED = ['Assamese', 'Bengali', 'Bodo', 'Dogri', 'Gujarati', 'Hindi', 'Kannada', 'Kashmiri', 'Konkani',
    'Maithili', 'Malayalam', 'Manipuri', 'Marathi', 'Nepali', 'Odia', 'Punjabi', 'Sanskrit', 'Santali', 'Sindhi',
    'Tamil', 'Telugu', 'Urdu'];

  it('carries all 22 languages of the Eighth Schedule, plus English, Hinglish and automatic', () => {
    expect(SCHEDULED).toHaveLength(22);
    for (const name of SCHEDULED) expect(examLanguage(name.toLowerCase())?.promptName).toBe(name);
    expect(examLanguage('english')?.label).toBe('English');
    expect(examLanguage('hinglish')).not.toBeNull();
    expect(EXAM_LANGUAGES[0].id).toBe('auto');
    expect(new Set(EXAM_LANGUAGES.map((l) => l.id)).size).toBe(EXAM_LANGUAGES.length);
  });

  it('the picker labels are English text, like the rest of the UI', () => {
    for (const l of EXAM_LANGUAGES) expect(l.label).toMatch(/^[A-Za-z ,()—-]+$/);
  });

  it('an unknown language reads as automatic, never as a language described to the model', () => {
    expect(normalizeExamSpec({ subject: 'Physics', language: 'klingon' }).language).toBe('auto');
    expect(normalizeExamSpec({ subject: 'Physics' }).language).toBe('auto');
    expect(normalizeExamSpec({ subject: 'Physics', language: 'Tamil' }).language).toBe('tamil');
  });

  it('automatic keeps the paper prompt exactly as it was', () => {
    const p = examPaperInstruction(normalizeExamSpec({ subject: 'Physics' }));
    expect(p).toContain('10. Write in the language the student has been using with you.');
  });

  it('a chosen language is written into the paper prompt, with formulae left alone', () => {
    const p = examPaperInstruction(normalizeExamSpec({ subject: 'Physics', language: 'tamil' }));
    expect(p).toContain('in Tamil, in its standard script');
    expect(p).toContain('Keep formulae, units, chemical symbols and numbers exactly as they are');
    expect(p).not.toContain('the language the student has been using with you');
  });

  it('Hinglish means Latin letters, not Devanagari', () => {
    const p = examPaperInstruction(normalizeExamSpec({ subject: 'History', language: 'hinglish' }));
    expect(p).toContain('Do not use Devanagari');
  });

  it('"teach me the ones I got wrong" asks for the lesson in the same language', () => {
    const spec: ExamSpec = { ...normalizeExamSpec({ subject: 'Physics', language: 'bengali' }) };
    expect(teachMyMistakesPrompt([q(1)], [{ n: 1, chosen: 1 }], spec)).toContain('Please teach me in Bengali.');
    const auto: ExamSpec = normalizeExamSpec({ subject: 'Physics' });
    expect(teachMyMistakesPrompt([q(1)], [{ n: 1, chosen: 1 }], auto)).not.toContain('Please teach me in');
  });

  it('duplicate questions are caught in any script (the old key kept only Latin and Devanagari)', () => {
    const tamilQ = {
      question: 'நியூட்டனின் முதல் விதி எதைக் கூறுகிறது?',
      options: ['நிலைமம்', 'விசை', 'முடுக்கம்', 'வேலை'],
      correctIndex: 0, explanation: 'விளக்கம்', topic: 'இயக்கம்',
    };
    const raw = JSON.stringify({ questions: [tamilQ, { ...tamilQ }] });
    const paper = parseExamPaper(raw);
    expect(paper.questions).toHaveLength(1);
    expect(paper.dropped).toBe(1);
  });
});

describe('the wiring in the Exam mode screen', () => {
  it('the Settings button sits in the Exam mode header', () => {
    expect(EXAM_UI).toMatch(/Exam mode<\/span>[\s\S]{0,1600}data-exam-settings=""/);
    expect(EXAM_UI).toContain('aria-label="Exam settings"');
  });

  it('the chosen language is sent with the paper request', () => {
    expect(EXAM_UI).toContain('language: settings.language');
  });

  it('the running paper keeps the settings it started with', () => {
    expect(EXAM_UI).toContain('setRun({ settings, startedAt: t');
    expect(EXAM_UI).toMatch(/clockDecision\(\{\s*scope: run\.settings\.scope/);
  });

  it('time-up paths record a SKIP (null), never a wrong answer', () => {
    expect(EXAM_UI).toMatch(/const timeOutQuestion[\s\S]{0,400}chosen: null/);
    expect(EXAM_UI).toMatch(/const endPaperOnTime[\s\S]{0,300}skipUnanswered\(questions, prev\)/);
  });

  it('a letter typed in the Settings sheet cannot answer the question behind it', () => {
    expect(EXAM_UI).toContain('if (settingsOpen) return;');
    expect(EXAM_UI).toContain("target.tagName === 'SELECT'");
  });
});

describe('JSX never shows an escape sequence as text', () => {
  function clientTsx(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (full.endsWith(join('src', 'server')) || name === 'node_modules') continue;
        clientTsx(full, out);
      } else if (name.endsWith('.tsx') && !name.includes('.test.')) {
        out.push(full);
      }
    }
    return out;
  }

  const ESCAPE = /\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}|\\x[0-9a-fA-F]{2}/;

  /** JSX text and JSX attribute strings are not JavaScript strings: `—` there renders as six characters. */
  function literalEscapes(file: string, src: string): string[] {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && ESCAPE.test(node.getText(sf))) found.push(node.getText(sf).trim());
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && ESCAPE.test(node.initializer.getText(sf))) {
        found.push(node.initializer.getText(sf));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  }

  it('the detector sees both shapes from the screenshot, and leaves JavaScript strings alone', () => {
    expect(literalEscapes('a.tsx', 'const a = <span>\\u2014 optional</span>;')).toHaveLength(1);
    expect(literalEscapes('a.tsx', 'const a = <input placeholder="Physics\\u2026" />;')).toHaveLength(1);
    expect(literalEscapes('a.tsx', "const a = <span>{'paper\\u2019s'}</span>;")).toEqual([]);
    expect(literalEscapes('a.tsx', "const a = <input placeholder={'x\\u2026'} />;")).toEqual([]);
  });

  it('no client component renders one', () => {
    const offenders: string[] = [];
    for (const file of clientTsx(join(ROOT, 'src'))) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('\\u') && !src.includes('\\x')) continue;
      for (const hit of literalEscapes(file, src)) offenders.push(`${file.slice(ROOT.length + 1)}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});
