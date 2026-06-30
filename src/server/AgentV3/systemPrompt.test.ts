import { describe, it, expect } from 'vitest';
import { editModePrefix, architectSystemPrompt, planSystemPrompt, dateContextBlock, LANGUAGE_RULE } from './systemPrompt';

describe('LANGUAGE_RULE (mirror the user, never default to Hindi)', () => {
  it('is blunt about mirroring the user and not defaulting to Hindi', () => {
    expect(LANGUAGE_RULE).toContain('MIRROR THE USER');
    expect(LANGUAGE_RULE.toLowerCase()).toContain('do not default to hindi');
    expect(LANGUAGE_RULE).toContain('English in');
  });
  it('is carried by BOTH the architect build prompt and the plan prompt', () => {
    expect(architectSystemPrompt()).toContain('MIRROR THE USER');
    expect(planSystemPrompt()).toContain('MIRROR THE USER');
  });
});

describe('editModePrefix', () => {
  it('declares EDIT MODE and instructs reading before writing', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('EDIT MODE');
    expect(p).toContain('READ BEFORE WRITING');
  });

  it('instructs preferring edit_file over write_file for existing files', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('PREFER edit_file');
    expect(p).toContain('write_file');
  });

  it('instructs locating code with grep/glob before editing', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('LOCATE FIRST');
    expect(p).toContain('grep');
    expect(p).toContain('glob');
  });

  it('forbids rebuilding from scratch and demands minimum changes', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('NEVER REBUILD FROM SCRATCH');
    expect(p).toContain('MINIMUM CHANGES');
  });

  it('injects the provided file tree between explicit markers', () => {
    const p = editModePrefix(['src/App.tsx', 'src/components/Navbar.tsx', 'package.json']);
    expect(p).toContain('<<<EXISTING_FILES>>>');
    expect(p).toContain('<<<END_FILES>>>');
    expect(p).toContain('src/App.tsx');
    expect(p).toContain('src/components/Navbar.tsx');
    expect(p).toContain('package.json');
  });

  it('still allows creating genuinely-new files', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('NEW FILES ARE FINE');
  });

  it('makes "never break the app" the #1 absolute edit rule and demands post-edit verification', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('YOUR EDIT MUST NEVER BREAK THE APP');
    // It must demand actually proving the app still builds/runs after editing.
    expect(p).toContain('npx tsc --noEmit');
    expect(p).toContain('prove it still works');
  });

  it('omits the file-tree block when no files are supplied (defensive default)', () => {
    const p = editModePrefix();
    expect(p).toContain('EDIT MODE');
    expect(p).not.toContain('<<<EXISTING_FILES>>>');
  });

  it('is a non-empty string distinct from the plain architect prompt', () => {
    const edit = editModePrefix(['a.ts']);
    const architect = architectSystemPrompt();
    expect(edit.length).toBeGreaterThan(0);
    expect(edit).not.toEqual(architect);
  });
});

describe('dateContextBlock (P-PE.8)', () => {
  it('formats a human + ISO date and tells the AI to use it as today', () => {
    const block = dateContextBlock('2026-06-29T12:00:00.000Z');
    expect(block).toContain('2026-06-29T12:00:00.000Z');
    expect(block).toContain('June 29, 2026');
    expect(block.toLowerCase()).toContain('today');
  });
  it('returns "" for a blank timestamp (no change)', () => {
    expect(dateContextBlock('')).toBe('');
    expect(dateContextBlock('   ')).toBe('');
  });
  it('falls back to the raw string for an unparseable timestamp', () => {
    const block = dateContextBlock('not-a-date');
    expect(block).toContain('not-a-date');
  });
});

describe('architectSystemPrompt / planSystemPrompt sanity', () => {
  it('architect prompt mentions write_file and edit_file tools', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('write_file');
    expect(p).toContain('edit_file');
  });

  it('plan prompt instructs planning only (no file writes yet)', () => {
    const p = planSystemPrompt();
    expect(p.toLowerCase()).toContain('plan');
    expect(p).toContain('update_todo');
  });

  it('instructs building every app to be edit-resilient so later edits never break it', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('EDIT-RESILIENT');
    expect(p).toContain('NEVER BREAK FROM LATER EDITS');
    // The concrete robustness levers must be spelled out, not just asserted.
    expect(p).toContain('ERROR BOUNDARY');
    expect(p).toContain('DECOUPLED');
  });

  it('tells the agent NOT to self-background the dev server (the "Killed" loop guard)', () => {
    const p = architectSystemPrompt();
    // The sandbox already backgrounds + keeps the dev server alive; a self-backgrounded
    // server is orphaned and reaped ("Killed"). The prompt must forbid `&`/`nohup` and
    // tell the agent what to do instead when it sees "Killed".
    expect(p).toContain('PLAIN FOREGROUND command');
    expect(p).toContain('nohup');
    expect(p).toContain('Killed');
    expect(p).toContain('do NOT relaunch with');
  });

  it('carries the prompt-injection guard: fenced external content is data, never instructions', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('UNTRUSTED EXTERNAL DATA');
    expect(p).toContain('UNTRUSTED_EXTERNAL_DATA');
    expect(p).toContain('exfiltrate');
  });
});
