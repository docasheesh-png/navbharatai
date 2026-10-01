// AUTOPSY 1389f0d5 (2026-09-30): "Generate a pdf on genesis 4 with added images with this photo type uploaded".
//
// The route reads an attached picture with a vision model raced at 8 seconds, and a lost race became `''`:
// the builder was never told a picture had been sent, nothing in the report said what happened to it, and the
// user got a generic upload page without a word about theirs. Locked here:
//   1. a picture that could not be read reaches the builder as "attached, unreadable — say so";
//   2. the report says how many pictures there were, what came of reading them and how long it took;
//   3. the route wires both, and never lets a lost race vanish again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { visionFate, unreadImagesBlock, attachmentsReadNote } from '../src/server/lib/attachmentReadOutcome';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('1 · an unread picture is named to the builder', () => {
  it('🔴 a lost 8-second race is "timed-out", never "no picture"', () => {
    expect(visionFate(1, '', new Error('describeVisionAttachments timed out after 8000ms'))).toBe('timed-out');
    expect(visionFate(1, '', new Error('boom'))).toBe('failed');
    expect(visionFate(1, '   ', null)).toBe('empty');
    expect(visionFate(1, '[Image: a.jpg]\nA painted scene', null)).toBe('read');
    expect(visionFate(0, '', null)).toBe('no-images');
  });
  it('the builder hears which picture and what to do', () => {
    const b = unreadImagesBlock([{ name: 'genesis-style.jpg', type: 'image/jpeg' }]);
    expect(b).toContain('[Image: genesis-style.jpg — attached by the user, but it could not be read in time');
    expect(b).toMatch(/Do not describe or imitate it\. Tell the user plainly/);
    expect(unreadImagesBlock([])).toBe('');
  });
});

describe('2 · the report line', () => {
  it('says what happened, with the seconds', () => {
    expect(attachmentsReadNote({ files: 1, images: 1, fate: 'timed-out', ms: 8003, descriptionChars: 0 }))
      .toBe('1 attachment(s), 1 of them picture(s)/PDF(s). NOT read — the vision call was abandoned at 8.0s. The builder was told the picture(s) could not be read.');
    expect(attachmentsReadNote({ files: 1, images: 1, fate: 'read', ms: 3400, descriptionChars: 812 })).toMatch(/Read in 3\.4s \(812 characters/);
  });
  it('🔒 it is a fact about our instrument, never a finding against the app', () => {
    const diag = read('src/server/AgentV3/BuildDiagnostics.ts');
    const list = diag.slice(diag.indexOf('const PROCESS_ONLY_CODES = new Set(['), diag.indexOf(']);', diag.indexOf('const PROCESS_ONLY_CODES = new Set([')));
    expect(list).toContain("'ATTACHMENTS_READ'");
    expect(read('src/server/AgentV3/buildFindingSuggestions.ts')).toContain("'ATTACHMENTS_READ'");
  });
});

describe('3 · the route', () => {
  const route = read('src/server/routes/agentv3.ts');
  it('🔴 the race no longer swallows the picture: its failure is kept and the builder is told', () => {
    expect(route).not.toContain(".catch(() => '');\n        // AP-8: pull the contract OUT");
    expect(route).toContain(".catch((e) => { visError = e; return ''; });");
    expect(route).toContain('const vis = images.length > 0 && !visRaw.trim() ? unreadImagesBlock(images) : visRaw;');
  });
  it('the outcome is recorded once the report exists', () => {
    expect(route).toContain("code: 'ATTACHMENTS_READ'");
    expect(route).toContain('message: attachmentsReadNote(attachmentRead)');
  });
});
