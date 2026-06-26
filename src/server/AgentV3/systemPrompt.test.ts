import { describe, it, expect } from 'vitest';
import { editModePrefix, architectSystemPrompt, planSystemPrompt } from './systemPrompt';

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
});
