// Two habits from today's reports, each said once and up front.
//  • autopsy ce115e1f: a designer styled src/index.css through ~20 serial edit_file calls (~11 min).
//  • autopsy 53a621e3: a basic calculator shipped with unrequested scientific functions (788 KB bundle).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { repeatedEditNotice, EDIT_LOOP_NOTE_AT, EDIT_LOOP_REPEAT_EVERY } from '../src/server/AgentV3/repeatedEdits';
import { BUILD_WHAT_WAS_ASKED_RULE } from '../src/server/AgentV3/noEvalRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { fileSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';

describe('a file edited piece by piece is told to be written whole', () => {
  it('silent for ordinary editing, speaks at the threshold and then only every few edits', () => {
    for (let n = 1; n < EDIT_LOOP_NOTE_AT; n++) expect(repeatedEditNotice('src/index.css', n)).toBe('');
    expect(repeatedEditNotice('src/index.css', EDIT_LOOP_NOTE_AT)).toMatch(/ONE write_file call/);
    expect(repeatedEditNotice('src/index.css', EDIT_LOOP_NOTE_AT + 1)).toBe('');
    expect(repeatedEditNotice('src/index.css', EDIT_LOOP_NOTE_AT + EDIT_LOOP_REPEAT_EVERY)).toMatch(/edit #11/);
  });
  it('the dispatcher counts edits per file and a whole-file write resets the count', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toMatch(/const editLoopNote = repeatedEditNotice\(path, editCount\);/);
    expect(src).toMatch(/editTwinNote \+ editLoopNote;/);
    expect(src).toMatch(/case 'write_file': \{\s*let path = reqStr\(input, 'path'\);\s*this\._editsPerFile\.delete\(path\);/);
  });
});

describe('build what was asked', () => {
  it('both lanes carry the rule, and it leaves room for the requirement notes', () => {
    expect(BUILD_WHAT_WAS_ASKED_RULE).toMatch(/requirement notes/);
    expect(architectSystemPrompt()).toContain(BUILD_WHAT_WAS_ASKED_RULE);
    expect(fileSystemPrompt('vite-react')).toContain(BUILD_WHAT_WAS_ASKED_RULE);
  });
});
