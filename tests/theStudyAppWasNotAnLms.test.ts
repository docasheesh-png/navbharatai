// BR1973 (report b8fd856fce…, 2026-11-08) — "Make study app for Maharashtra board students"
// failed at the free 25-minute wall-clock cap (NOT user-stopped; not charged). The engine correctly
// named domain=education off the word "students", then REQUIREMENT_GAPS injected the six institution
// features (roles, courses, enrolment, grading, progress, fees) plus login/scale questions because
// "study app" was not in PRACTICE_TOOL_SOURCE. namesBusinessDomain therefore scored it 58 / complex_app
// (the hospital-ERP number). The fast lane built a board-study UI (subjects, chapters, materials) in
// 287s, failed typecheck (react-router-dom missing from the starter, plus BoardStandard mismatches),
// and salvaged 26 files. The full builder then added AuthContext, Login/Register, ProtectedRoute,
// RoleBasedComponent, AdminDashboard, EnrollmentWidget and UserRoleDemo — screens the user never
// asked for — wrote 21 more files after the first render at 735s, never judged the app finished,
// and hit the cap. RELEASE_GATE RED because of the timeout; the app had rendered and typechecked.
//
// This is the same class as autopsy 73648e12 (a mock-test app built Courses/Attendance/Fees/Admin).
// The opposite-class and neighbour lists below were assembled independently, before PRACTICE_TOOL_SOURCE
// was edited, so a "study app" cannot steal a school LMS, a coaching platform, an education-loan app,
// or a sentence about studying app development.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRequirementGaps, buildRequirementGuidance, missingDomainFeatures, namesASingleLearnerTool, PRACTICE_TOOL_SOURCE } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { namesPersonalTool, SIMPLE_APP_SIGNAL } from '../src/server/lib/appComplexitySignals';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';

const HERE = dirname(fileURLToPath(import.meta.url));

export const BR1973_PROMPT = 'Make study app for Maharashtra board students';

const BR1972_PROMPT = 'मुझे एक education app बनाना है app नाम है edu ai examination Assistant';
const EXAM_ANALYSE = 'Mujhe higher exam hard exam analyse app banana hai';

/** Same class: one learner's study or practice tool, no institution named. Built before the edit. */
const SAME_CLASS = [
  BR1973_PROMPT,
  'Build a study app for CBSE board students',
  'make a study app for class 10',
  'study-app for Maharashtra board students',
  'make a test series app for SSC CGL',
  'flashcards app for NEET biology',
  'UPSC previous year papers app',
  'question bank app for class 10 maths',
  // Reviewer FAIL at b8bcda5fc: these must stay captured (the un-bounded lookbehind
  // treated the "case" inside showcase/lowercase/uppercase/briefcase as "case ").
  'showcase study app',
  'lowercase study app',
  'uppercase study app',
  'briefcase study app',
  'Make a showcase study app for Maharashtra board students',
  'study  app',
  'self-study app',
  'bible study app',
  'group study app',
] as const;

/**
 * Opposite class, assembled independently before the edit. A study/practice phrase that also
 * names a school, coaching centre, logins, fees, courses or lessons must keep the institution list.
 */
const OPPOSITE_INSTITUTION = [
  'Make a study app for my school with teachers, admin and student logins',
  'Build a study app for my coaching institute with student logins and fees',
  'Study portal for our college with enrolment and fees',
  'Make an LMS for Maharashtra board students with courses and attendance',
  'Build a mock test platform for my coaching institute with student logins and fees',
  'school management system',
] as const;

/** "study app" as a verb + object (study app development) is not a learner tool. */
const OPPOSITE_NOT_A_STUDY_APP = [
  'I want to study app development',
  'Help me study app security',
  'A course to study app architecture',
  'Build an exam app',
] as const;

/**
 * Reviewer FAIL on #4164 at 9a39ae210: every phrase here must stay uncaptured as a single-learner
 * tool. The first pattern matched "case study app" (and "case-study app") and sent them to
 * simple_app/15 with the LMS gaps withdrawn; the craft-word lookahead only saw whitespace, so
 * "study-app-development" and "study app/development" slipped through. Institution prompts are
 * included so they cannot become single-learner tools either.
 */
const OPPOSITE_UNCAPTURED = [
  // Case-study variants (reviewer at 9a39ae210).
  'case study app',
  'Build a case study app',
  'case study app for MBA students',
  'case-study app',
  'Case Study App',
  // Reviewer FAIL at b8bcda5fc: multi-separator / punctuation / glued forms and Case/CASE.
  'case  study app',
  'case/study app',
  'case, study app',
  'case_study app',
  'casestudy app',
  'Case study app',
  'CASE study app',
  'group study app with admin',
  // Craft-word hyphen/slash bypasses (reviewer) plus double-space craft phrases
  // so study[\s-]+ does not open a new bypass past the lookahead.
  'study-app-development',
  'study app/development tutorial',
  'study  app development',
  'study  app/development tutorial',
  // "application" is not "app".
  'study application form',
  // Hindi / Hinglish twins of the case-study and craft-word misses.
  'MBA students ke liye case study app banao',
  'mujhe case study app chahiye',
  'study app development ka tutorial',
  'mujhe study-app-development sikhna hai',
  // Already-listed craft / non-tool phrases.
  ...OPPOSITE_NOT_A_STUDY_APP,
  // Institution prompts: a study/practice phrase that names a school or coaching stays uncaptured.
  ...OPPOSITE_INSTITUTION,
] as const;

const SIZED = (prompt: string) => analyzeRequest({ prompt, buildIntent: 'new_build' } as Parameters<typeof analyzeRequest>[0]);

describe("BR1973: a study app for board students is one learner's tool, not a school LMS", () => {
  it('the report prompt is 45 characters', () => {
    expect(BR1973_PROMPT.length).toBe(45);
  });

  it('keeps the education domain and withdraws the six institution features', () => {
    const g = analyzeRequirementGaps(BR1973_PROMPT);
    expect(g.domain).toBe('education');
    expect(g.likelyMissing).toEqual([]);
    expect(g.clarifyingQuestions).toEqual([]);
    expect(buildRequirementGuidance(g)).not.toMatch(/REQUIREMENT AWARENESS/);
    expect(missingDomainFeatures(BR1973_PROMPT, '').labels).toEqual([]);
    expect(namesASingleLearnerTool(BR1973_PROMPT)).toBe(true);
  });

  it('is sized as the quiz/study family, not as a hospital ERP', () => {
    // SIMPLE_APP_SIGNAL is not widened (that list stays the small named toys). The bridge is
    // namesASingleLearnerTool → namesPersonalTool, the same path autopsy 73648e12 already uses.
    expect(SIMPLE_APP_SIGNAL.test(BR1973_PROMPT)).toBe(false);
    expect(namesPersonalTool(BR1973_PROMPT)).toBe(true);
    const a = SIZED(BR1973_PROMPT);
    expect(a.taskType).toBe('simple_app');
    expect(a.complexityScore).toBeLessThan(40);
  });

  it('stays an ordinary one-shot and is not a game', () => {
    const s = analyzeAppScope(BR1973_PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.size).toBe('small');
    expect(s.famousApp).toBeNull();
    expect(gameKitPlan(BR1973_PROMPT)).toHaveLength(0);
  });

  it("same-class study and practice tools are recognised", () => {
    for (const p of SAME_CLASS) {
      expect(namesASingleLearnerTool(p), p).toBe(true);
    }
  });

  it('an institution named beside a study or practice phrase keeps the full list and the complex sizing', () => {
    for (const p of OPPOSITE_INSTITUTION) {
      expect(namesASingleLearnerTool(p), p).toBe(false);
      expect(analyzeRequirementGaps(p).likelyMissing.length, p).toBeGreaterThan(0);
      expect(SIZED(p).taskType, p).toBe('complex_app');
    }
  });

  it('a study app that names lessons is still institution-scoped (biology-app neighbour)', () => {
    const p = 'make a study app for class 10 with lessons, quizzes and a progress page';
    expect(namesASingleLearnerTool(p)).toBe(false);
  });

  it('studying app development, or an exam with nothing named, is not a learner tool', () => {
    for (const p of OPPOSITE_NOT_A_STUDY_APP) {
      expect(namesASingleLearnerTool(p), p).toBe(false);
    }
  });

  it('reviewer opposite-class phrases stay uncaptured; the report prompt stays captured', () => {
    expect(namesASingleLearnerTool(BR1973_PROMPT)).toBe(true);
    for (const p of OPPOSITE_UNCAPTURED) {
      expect(namesASingleLearnerTool(p), p).toBe(false);
    }
  });

  it('a case-study app for MBA students keeps the education LMS list and is not simple_app/15', () => {
    const p = 'case study app for MBA students';
    const g = analyzeRequirementGaps(p);
    expect(g.domain).toBe('education');
    expect(g.likelyMissing.length).toBeGreaterThan(0);
    const a = SIZED(p);
    expect(a.taskType).toBe('complex_app');
    expect(a.complexityScore).toBeGreaterThanOrEqual(40);
    for (const bare of ['case study app', 'Build a case study app', 'case-study app']) {
      expect(namesPersonalTool(bare), bare).toBe(false);
      expect(SIZED(bare).taskType, bare).not.toBe('simple_app');
    }
  });

  it('neighbours keep their domains: education-loan is fintech; "education app" stays general (Q-2644)', () => {
    expect(analyzeRequirementGaps(BR1972_PROMPT).domain).toBe('general');
    expect(analyzeRequirementGaps('Make an education app').domain).toBe('general');
    expect(analyzeRequirementGaps('examination Assistant').domain).toBe('general');
    expect(analyzeRequirementGaps(EXAM_ANALYSE).domain).toBe('education');
    expect(analyzeRequirementGaps('education loan app').domain).toBe('fintech');
    expect(analyzeRequirementGaps('Make a bike racing game').domain).toBe('game');
    expect(namesASingleLearnerTool(EXAM_ANALYSE)).toBe(false);
    expect(namesASingleLearnerTool('Make an education app')).toBe(false);
  });

  it('a showcase study app for board students stays one learner\'s tool (not complex_app/58)', () => {
    const p = 'Make a showcase study app for Maharashtra board students';
    expect(namesASingleLearnerTool(p)).toBe(true);
    const g = analyzeRequirementGaps(p);
    expect(g.domain).toBe('education');
    expect(g.likelyMissing).toEqual([]);
    const a = SIZED(p);
    expect(a.taskType).toBe('simple_app');
    expect(a.complexityScore).toBeLessThan(40);
  });

  it('double-space, slash and comma case-study probes leak no longer (not simple_app)', () => {
    for (const p of ['case  study app', 'case/study app', 'case, study app']) {
      expect(namesASingleLearnerTool(p), p).toBe(false);
      expect(namesPersonalTool(p), p).toBe(false);
      expect(SIZED(p).taskType, p).not.toBe('simple_app');
    }
  });

  it('the variable-length lookbehind compiles on this Node and does not ship to the browser bundle', () => {
    expect(() => new RegExp(String.raw`(?<!\bcase[\s\-/,]+)study[\s-]+apps?`, 'i')).not.toThrow();
    expect(PRACTICE_TOOL_SOURCE).toContain(String.raw`(?<!\bcase[\s\-/,]+)`);
    expect(PRACTICE_TOOL_SOURCE).toContain(String.raw`study[\s-]+apps?`);
    // Vite's client target includes safari14, which predates variable-length lookbehind.
    // This regex lives only in the server analyser and must not be imported by the client entry.
    expect(readFileSync(join(HERE, '..', 'src/main.tsx'), 'utf8')).not.toMatch('RequirementGapAnalyzer');
    expect(readFileSync(join(HERE, '..', 'src/App.tsx'), 'utf8')).not.toMatch('RequirementGapAnalyzer');
  });
});
