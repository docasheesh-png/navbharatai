// "FULL-STACK" IS A COMPLIMENT, NOT A SCOPE (autopsy 53a621e3, 2026-09-30). A calculator described as
// "a modern, full-stack Android calculator application" was routed COMPLEX (score 63): it skipped the
// cheap lead rung and the fast lane and cost ~4× what a calculator should.

import { describe, it, expect } from 'vitest';
import { isComplexAppPrompt } from '../src/server/lib/appComplexitySignals';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';

const REPORT = '"Create a modern, full-stack Android calculator application. It must include a clean, wide-row '
  + 'digital display area at the top that shows both the current math expression and the running answer below it. '
  + 'Provide a grid layout containing the following buttons: numbers 0-9, arithmetic operators (+, -, *, /), a decimal '
  + 'button, a clear button (C), a backspace/delete button, and an equals button (=). Ensure it handles decimal math '
  + 'accurately. Use a dark-mode theme with high-contrast white text for numbers and neon blue accents for the operator buttons."';

describe('a small app described as full-stack is still a small app', () => {
  it('the report prompt is simple', () => {
    expect(isComplexAppPrompt(REPORT)).toBe(false);
    const a = analyzeRequest({ prompt: REPORT, buildIntent: 'new_build' } as any);
    expect(a.taskType).toBe('simple_app');
    expect(a.complexityScore).toBeLessThan(40);
  });
  it('the same buzzwords on other small apps', () => {
    expect(isComplexAppPrompt('a complete app: todo list with dark mode')).toBe(false);
    expect(isComplexAppPrompt('full stack stopwatch with laps')).toBe(false);
  });
  it('a small app with a REAL complex need stays complex', () => {
    expect(isComplexAppPrompt('full-stack calculator that saves history to a database')).toBe(true);
    expect(isComplexAppPrompt('todo app with login and payment')).toBe(true);
  });
  it('full-stack on anything that is not a small app keeps its meaning', () => {
    expect(isComplexAppPrompt('a full-stack expense tracker for my team')).toBe(true);
    expect(isComplexAppPrompt('build a full stack app for my clinic')).toBe(true);
  });
});

import { NO_EVAL_RULE } from '../src/server/AgentV3/noEvalRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { fileSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';

describe('a calculator is written without eval from the first version', () => {
  it('both lanes carry the same rule', () => {
    expect(NO_EVAL_RULE).toMatch(/eval\(\), new Function\(\)/);
    expect(architectSystemPrompt()).toContain(NO_EVAL_RULE);
    expect(fileSystemPrompt('vite-react')).toContain(NO_EVAL_RULE);
  });
});
