// Autopsy f385a5f9 (2026-09-30, JEEVERSE AI roadmap). The planner's step 3 read: "Upon clicking, simulate
// the process: show 'Generating Script', then 'Creating Scenes', and finally a 'Rendering' progress bar."
// Rule 7 of its own prompt forbade a simulated response in words; nothing checked. The guardrail now
// rewrites such a step to an honest not-available state and marks it as needing infrastructure.
import { describe, it, expect } from 'vitest';
import { asksForSimulation, roadmapGuardrail, NO_SIMULATION_CLAUSE, megaRoadmapSystemPrompt } from '../src/server/lib/megaRoadmap';

const STEP3 = "Build the 'AI Video Creator' section. Create a text input for the topic, a language selector (English, Hindi, Assamese, etc.), and a 'Generate Video' button. Upon clicking, simulate the process: show 'Generating Script', then 'Creating Scenes', and finally a 'Rendering' progress bar. After completion, display a status message explaining that the actual video file generation requires a backend video service, but the interface is fully functional.";

describe('what asks for work to be faked', () => {
  it('🔴 the report\'s step 3', () => expect(asksForSimulation(STEP3)).toBe(true));
  it.each([
    'Show a fake upload progress while the file is saved',
    'Add a progress bar that is simulated with setInterval',
  ])('%s', (p) => expect(asksForSimulation(p)).toBe(true));
  it.each([
    'Build a photo feed with sample posts using local mock data.',
    'Implement the chat. No fake responses — call the real API with the user key.',
    'Never simulate the payment result; use the real gateway.',
    'Show a real upload progress bar from the XHR progress event.',
  ])('NOT: %s', (p) => expect(asksForSimulation(p)).toBe(false));
});

describe('the guardrail', () => {
  const parsed = {
    achievableSummary: 'x', note: null,
    steps: [
      { title: 'Question generator', goal: 'generate a question', buildPrompt: 'Build a question generator with a difficulty slider and hints.', needsInfra: null },
      { title: 'Video creator', goal: 'make a video', buildPrompt: STEP3, needsInfra: null },
      { title: 'PDF library', goal: 'read chapters', buildPrompt: 'Build a chapter list that opens the real NCERT PDF.', needsInfra: null },
    ],
  };
  it('keeps the step (the feature is not dropped), says it needs infrastructure, and forbids the fake', () => {
    const { roadmap, rejected } = roadmapGuardrail(parsed as never, 'build JEEVERSE');
    const video = roadmap!.steps.find((s) => s.title === 'Video creator')!;
    expect(video.infraCeiling).toBe(true);
    expect(video.buildPrompt.endsWith(NO_SIMULATION_CLAUSE)).toBe(true);
    expect(rejected.join(' ')).toMatch(/Video creator.*simulated/);
    expect(roadmap!.steps.find((s) => s.title === 'Question generator')!.buildPrompt).not.toContain(NO_SIMULATION_CLAUSE);
  });
  it('the planner is told in words too', () => {
    expect(megaRoadmapSystemPrompt()).toMatch(/simulated progress bar/);
  });
});
