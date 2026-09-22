import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EXAM_TARGETS, EXAM_TARGET_OTHER, examTarget, examTargetLabel, examTargetBrief,
  examPaperInstruction, examSpecIsUsable, normalizeExamSpec, parseExamPaper, teachMyMistakesPrompt,
  type ExamSpec,
} from '../src/server/professionals/examMode';
import { readingNote, setupReady } from '../src/components/professionals/examView';

/**
 * 🎯 WHICH EXAM, AND WHAT DID YOU MEAN — the two things the admin asked for after using exam mode
 * (2026-09-22).
 *
 * > *"subject topics level ke sath kon se exam ki prepration karni hai, woh dropdown se selection
 * > karne ko aye … india me hone wala sabhi famus exam aap is list me add karoge!! aur sab
 * > alfavetical honge, 1st number par other hoga."*
 *
 * > *"student spelling mistacks kar sakte hai, jaise maine ki. to llm call ke jariye isko sahi liya
 * > jaye aur user ko paresani na ho (navbharat ai, galat spelling bhi samajh le)."*
 *
 * ## What this file is actually guarding, and why each rule is here
 *
 * - **`other` first, the rest alphabetical.** Stated twice by the admin, and both halves are silent
 *   when broken: a list that drifts out of order still renders, and a student simply cannot find
 *   their exam in it.
 * - **A name we do not know never gets an invented syllabus.** The most tempting bug in this feature
 *   is describing an exam confidently from its name alone — the same plausible-looking falsehood the
 *   module header already refuses for questions.
 * - **The spelling correction is VISIBLE.** Understanding "trignometry" is worth nothing if the
 *   student cannot see what was understood; a silent correction that guesses wrong hands them ten
 *   questions on the wrong subject with no way to tell.
 * - **A correction that changed nothing says nothing.** Otherwise every paper carries an "I read
 *   that as" and nobody reads the one that matters.
 *
 * Several cases are SOURCE-level. `tsc` and `vitest` cannot see that a dropdown was never rendered,
 * that the reading was never sent to the client, or that the spelling rule fell out of the prompt —
 * each of those breaks nothing and fails nothing. Every source guard below was proven by reversion.
 */

const root = join(__dirname, '..');
const code = (rel: string) => readFileSync(join(root, rel), 'utf8');
const CORE = 'src/server/professionals/examMode.ts';
const ROUTE = 'src/server/routes/professionals.ts';
const EXAM_UI = 'src/components/professionals/ExamMode.tsx';

const SPEC: ExamSpec = {
  subject: 'Physics', topic: 'Thermodynamics', level: 'mix', count: 5,
  targetExam: EXAM_TARGET_OTHER, targetExamOther: '',
};

describe('the list is exactly the shape the admin asked for', () => {
  it('🔒 "Other" is FIRST — the admin said so twice, and nothing else can assert it', () => {
    expect(EXAM_TARGETS[0].id).toBe(EXAM_TARGET_OTHER);
    expect(EXAM_TARGETS[0].label.toLowerCase()).toContain('other');
  });

  it('🔒 everything after it is alphabetical, and "Class 10" comes before "Class 12"', () => {
    const rest = EXAM_TARGETS.slice(1).map((t) => t.label);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    expect(rest).toEqual(sorted);
    expect(rest.indexOf('Class 10 board exam')).toBeLessThan(rest.indexOf('Class 12 board exam'));
  });

  it('it is a real list, not a token one — the admin asked for every famous Indian exam', () => {
    expect(EXAM_TARGETS.length).toBeGreaterThan(60);
    const ids = EXAM_TARGETS.map((t) => t.id);
    for (const must of ['neet_ug', 'jee_main', 'jee_advanced', 'upsc_cse', 'ssc_cgl', 'cat', 'gate', 'clat', 'ctet', 'class10', 'class12', 'nda', 'ibps_po', 'rrb_ntpc', 'ca_foundation', 'ugc_net']) {
      expect(ids).toContain(must);
    }
  });

  it('every id is unique and every entry is nameable', () => {
    const ids = EXAM_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of EXAM_TARGETS) expect(t.label.trim().length).toBeGreaterThan(0);
  });

  it('🔒 every NAMED exam carries a real brief — an entry with no brief is a dropdown row that changes nothing', () => {
    for (const t of EXAM_TARGETS.slice(1)) {
      expect(t.brief.trim().length, `${t.id} has no brief`).toBeGreaterThan(30);
    }
    // `other` is the one deliberate blank: there is nothing to describe.
    expect(EXAM_TARGETS[0].brief).toBe('');
  });

  it('🔒 no DISCONTINUED exam is offered — preparing somebody for a withdrawn exam is a lie that looks helpful', () => {
    const labels = EXAM_TARGETS.map((t) => t.label.toLowerCase()).join(' | ');
    expect(labels).not.toContain('ntse');
    expect(labels).not.toContain('kvpy');
  });

  it('🔒 WHITE-LABEL: no vendor or model name reaches a label or a brief', () => {
    const all = EXAM_TARGETS.map((t) => `${t.label} ${t.brief} ${(t.subjects || []).join(' ')}`).join(' ').toLowerCase();
    for (const vendor of ['claude', 'anthropic', 'openai', 'gpt-', 'gemini', 'vertex', 'grok', 'glm', 'kimi', 'moonshot', 'nvidia', 'nemotron']) {
      expect(all, `vendor "${vendor}" leaked`).not.toContain(vendor);
    }
  });

  it('a subject list, where it exists, is real subjects of that exam', () => {
    expect(examTarget('neet_ug')?.subjects).toEqual(['Physics', 'Chemistry', 'Biology (Botany & Zoology)']);
    expect(examTarget('jee_main')?.subjects).toEqual(['Physics', 'Chemistry', 'Mathematics']);
    // Not every exam has a fixed list, and inventing one would be worse than offering none.
    expect(examTarget('gmat')?.subjects).toBeUndefined();
  });
});

describe('examTarget — junk in, null out, never a guess', () => {
  it('finds a real id, case- and space-insensitively', () => {
    expect(examTarget('neet_ug')?.label).toBe('NEET UG (Medical)');
    expect(examTarget(' NEET_UG ')?.label).toBe('NEET UG (Medical)');
  });

  it('`other`, empty, unknown and junk are all null — never a nearest match', () => {
    for (const bad of [EXAM_TARGET_OTHER, '', '   ', 'neet', 'nee_ug', null, undefined, 0, {}, []]) {
      expect(examTarget(bad as unknown)).toBeNull();
    }
  });
});

describe('normalizeExamSpec — the target is cleaned the same way everything else is', () => {
  it('an unknown id reads as `other`, never as an exam we would then describe', () => {
    expect(normalizeExamSpec({ subject: 'Physics', targetExam: 'ntse' }).targetExam).toBe(EXAM_TARGET_OTHER);
    expect(normalizeExamSpec({ subject: 'Physics', targetExam: { evil: true } }).targetExam).toBe(EXAM_TARGET_OTHER);
  });

  it('a real id survives, and the free-text field is CLEARED so two answers can never both be live', () => {
    const s = normalizeExamSpec({ subject: 'Physics', targetExam: 'jee_main', targetExamOther: 'something else' });
    expect(s.targetExam).toBe('jee_main');
    expect(s.targetExamOther).toBe('');
  });

  it('a typed exam under `other` is kept, trimmed and bounded', () => {
    expect(normalizeExamSpec({ subject: 'X', targetExamOther: '  my   state board  ' }).targetExamOther).toBe('my state board');
    expect(normalizeExamSpec({ subject: 'X', targetExamOther: 'e'.repeat(500) }).targetExamOther.length).toBe(80);
  });

  it('an untouched form is byte-identical to the behaviour before this field existed', () => {
    const s = normalizeExamSpec({ subject: 'Physics', topic: 'Optics', level: 'hard', count: 5 });
    expect(s.targetExam).toBe(EXAM_TARGET_OTHER);
    expect(s.targetExamOther).toBe('');
    expect(examTargetBrief(s)).toBe('');
    expect(examPaperInstruction(s)).not.toContain('EXAM:');
  });
});

describe('🔑 a named exam stands in for the subject — "set me a NEET paper" is a complete request', () => {
  const cases: Array<{ what: string; spec: Partial<ExamSpec>; usable: boolean }> = [
    { what: 'subject only', spec: { subject: 'Physics' }, usable: true },
    { what: 'exam only', spec: { subject: '', targetExam: 'neet_ug' }, usable: true },
    { what: 'both', spec: { subject: 'Physics', targetExam: 'neet_ug' }, usable: true },
    { what: 'a typed exam only', spec: { subject: '', targetExamOther: 'My school test' }, usable: true },
    { what: 'neither', spec: { subject: '', targetExam: EXAM_TARGET_OTHER }, usable: false },
    { what: 'whitespace only', spec: { subject: '   ', targetExamOther: '  ' }, usable: false },
  ];

  for (const c of cases) {
    it(`${c.what} → ${c.usable ? 'usable' : 'refused'}`, () => {
      expect(examSpecIsUsable(normalizeExamSpec(c.spec))).toBe(c.usable);
    });
  }

  it('🔒 the Start BUTTON and the SERVER agree on every one of those — a button that enables where the server refuses is a dead button', () => {
    for (const c of cases) {
      const spec = normalizeExamSpec(c.spec);
      expect(setupReady(spec.subject, examTargetLabel(spec)), c.what).toBe(examSpecIsUsable(spec));
    }
  });

  it('with an exam and no subject, the paper is set from the exam’s OWN subjects rather than from nothing', () => {
    const p = examPaperInstruction(normalizeExamSpec({ subject: '', targetExam: 'neet_ug', count: 5 }));
    expect(p).toContain('the subjects that exam itself tests');
    expect(p).toContain('NEET UG (Medical)');
  });
});

describe('examTargetBrief — describes what we know, and never what we do not', () => {
  it('a known exam gets its label AND its real brief, with an instruction to pitch to it', () => {
    const b = examTargetBrief({ targetExam: 'upsc_cse', targetExamOther: '' });
    expect(b).toContain('UPSC Civil Services (IAS / IPS)');
    expect(b).toContain('assertion-reason');
    expect(b).toContain("that exam's standard");
  });

  it('🔒 a TYPED exam gets its name and NO invented syllabus — the generator is told to say nothing if it does not know it', () => {
    const b = examTargetBrief({ targetExam: EXAM_TARGET_OTHER, targetExamOther: 'Zephyr Aptitude Test' });
    expect(b).toContain('Zephyr Aptitude Test');
    expect(b).toContain('If you do not know that exam');
  });

  it('no exam chosen → the clause disappears entirely rather than becoming a sentence saying nothing', () => {
    expect(examTargetBrief({ targetExam: EXAM_TARGET_OTHER, targetExamOther: '' })).toBe('');
    expect(examTargetBrief({ targetExam: EXAM_TARGET_OTHER, targetExamOther: '   ' })).toBe('');
  });

  it('examTargetLabel names a known exam, a typed one, or nothing', () => {
    expect(examTargetLabel({ targetExam: 'cat', targetExamOther: '' })).toBe('CAT (IIM / MBA)');
    expect(examTargetLabel({ targetExam: EXAM_TARGET_OTHER, targetExamOther: 'Bank test' })).toBe('Bank test');
    expect(examTargetLabel({ targetExam: EXAM_TARGET_OTHER, targetExamOther: '' })).toBe('');
  });
});

describe('🔤 wrong spelling is understood by the SAME call that writes the paper', () => {
  it('🔒 the prompt carries the spelling rule AND the instruction to report back what it read', () => {
    const p = examPaperInstruction(SPEC);
    expect(p).toContain('SPELLING');
    expect(p).toContain('MISSPELLED');
    // The guard against over-correcting: an unfamiliar word is kept, not turned into a lookalike.
    expect(p).toContain('keep it exactly as written');
    expect(p).toContain('"read" reports the subject and topic BACK');
    expect(p).toContain('"read": { "subject": string, "topic": string }');
  });

  it('🔒 it costs NOT ONE extra model call — the reading rides the paper the student already paid for', () => {
    // One instruction, one request. If a second call is ever added, this route's own comment ("ONE
    // call for the WHOLE paper") and the ONE-WALLET charge below it both stop being true.
    const route = code(ROUTE);
    const examBlock = route.slice(route.indexOf("'/api/professional/:id/exam'"));
    const body = examBlock.slice(0, examBlock.indexOf('sendSafeError'));
    expect(body.match(/runProfessionalChatWithUsage\(/g)?.length).toBe(1);
  });

  it('the parser reads what the generator said it understood', () => {
    const raw = JSON.stringify({
      read: { subject: 'Trigonometry', topic: 'Heights and distances' },
      questions: [{ question: 'Q?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'Why.', topic: 'T' }],
    });
    expect(parseExamPaper(raw).read).toEqual({ subject: 'Trigonometry', topic: 'Heights and distances' });
  });

  it('a paper that said nothing about what it read yields null, never an empty shape the surface must special-case', () => {
    const q = [{ question: 'Q?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'Why.', topic: 'T' }];
    expect(parseExamPaper(JSON.stringify({ questions: q })).read).toBeNull();
    expect(parseExamPaper(JSON.stringify({ read: {}, questions: q })).read).toBeNull();
    expect(parseExamPaper(JSON.stringify({ read: { subject: '  ', topic: '' }, questions: q })).read).toBeNull();
    expect(parseExamPaper('not json at all').read).toBeNull();
  });

  it('🔒 the reading TRAVELS to the client — a correction nobody can see is a silent one', () => {
    expect(code(ROUTE)).toContain('read: paper.read');
    expect(code(EXAM_UI)).toContain('setRead((data.read ?? null)');
  });
});

describe('🔤 "I read that as …" — visible when it corrected, silent when it did not', () => {
  it('says nothing when the student spelled it perfectly well', () => {
    expect(readingNote({ subject: 'Physics', topic: 'Optics' }, { subject: 'Physics', topic: 'Optics' })).toBe('');
  });

  it('says nothing for a difference that is only case, spacing or punctuation', () => {
    expect(readingNote({ subject: 'class 10', topic: '' }, { subject: 'Class-10', topic: '' })).toBe('');
    expect(readingNote({ subject: '  PHYSICS ', topic: '' }, { subject: 'Physics', topic: '' })).toBe('');
  });

  it('🔒 speaks up when the subject was genuinely read as something else', () => {
    const n = readingNote({ subject: 'trignometry', topic: '' }, { subject: 'Trigonometry', topic: '' });
    expect(n).toContain('Trigonometry');
    expect(n).toContain('I read that as');
  });

  it('names the topic too when both moved', () => {
    const n = readingNote({ subject: 'bayology', topic: 'sel divison' }, { subject: 'Biology', topic: 'Cell division' });
    expect(n).toContain('Biology — Cell division');
  });

  it('🔒 a topic the student never typed is not a correction — otherwise every exam-only paper carries a note', () => {
    expect(readingNote({ subject: 'Physics', topic: '' }, { subject: 'Physics', topic: 'Optics' })).toBe('');
  });

  it('nothing to say when the generator said nothing, or said nothing usable', () => {
    expect(readingNote({ subject: 'Physics', topic: '' }, null)).toBe('');
    expect(readingNote({ subject: 'Physics', topic: '' }, undefined)).toBe('');
    expect(readingNote({ subject: 'Physics', topic: '' }, { subject: '', topic: 'Optics' })).toBe('');
  });

  it('works in Devanagari, because a student typing Hindi is the same student', () => {
    expect(readingNote({ subject: 'भौतिकी', topic: '' }, { subject: 'भौतिकी', topic: '' })).toBe('');
    expect(readingNote({ subject: 'भोतिकी', topic: '' }, { subject: 'भौतिकी', topic: '' })).toContain('भौतिकी');
  });

  it('🔒 the correction is never forced on the student — the first question offers the way back', () => {
    const ui = code(EXAM_UI);
    expect(ui).toContain('Not what I meant');
    expect(ui).toContain('{at === 0 && note && (');
  });
});

describe('the exam travels into the lesson that follows the paper', () => {
  const questions = parseExamPaper(JSON.stringify({
    questions: [{ question: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'Why.', topic: 'Optics' }],
  })).questions;

  it('🔑 the teacher is told WHICH exam — the same wrong answer needs a different lesson for a Class 12 student and a JEE candidate', () => {
    const p = teachMyMistakesPrompt(questions, [{ n: 1, chosen: 2 }], { ...SPEC, targetExam: 'jee_advanced' });
    expect(p).toContain('I am preparing for JEE Advanced.');
  });

  it('and is not told one when none was chosen', () => {
    const p = teachMyMistakesPrompt(questions, [{ n: 1, chosen: 2 }], SPEC);
    expect(p).not.toContain('I am preparing for');
  });

  it('an exam-only paper still names its scope rather than an empty phrase', () => {
    const spec = normalizeExamSpec({ subject: '', targetExam: 'neet_ug', count: 1 });
    const p = teachMyMistakesPrompt(questions, [{ n: 1, chosen: 2 }], spec);
    expect(p).toContain('NEET UG (Medical)');
    expect(p).not.toContain('test on  and');
  });
});

describe('🔒 THE WIRING — the dropdown is real, and it is the list', () => {
  it('the setup screen renders EXAM_TARGETS itself, so an exam added to the list appears with no UI change', () => {
    const ui = code(EXAM_UI);
    expect(ui).toContain('{EXAM_TARGETS.map((t) => (');
    expect(ui).toContain('<option key={t.id} value={t.id}>{t.label}</option>');
  });

  it('🔒 the choice is SENT — a dropdown that changes no request is decoration', () => {
    expect(code(EXAM_UI)).toContain('JSON.stringify({ subject, topic, level, count, targetExam, targetExamOther })');
  });

  it('🔒 an exam’s own subjects are offered as one tap — which is what stops the commonest misspelling being typed at all', () => {
    expect(code(EXAM_UI)).toContain('chosenTarget?.subjects');
  });

  it('🔒 the list is sorted BY CODE — a hand-ordered list drifts on the first append and nothing fails', () => {
    expect(code(CORE)).toContain('function sortTargets(');
    expect(code(CORE)).toContain('[OTHER_TARGET, ...sortTargets(NAMED_TARGETS)]');
  });
});
