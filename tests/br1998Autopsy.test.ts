/**
 * BR1998 autopsy: a message that was pasted source code got "⚠️ I could not find @override in this
 * project".
 *
 * The user pasted a whole Flutter (Dart) source file as the message. Its indented `@override` lines
 * passed the file-mention parser's whitespace guard, matched no project file, and the user was told the
 * platform could not find "@override". That is noise about their own code, shown at build start.
 *
 * F1: an UNRESOLVED bare identifier in annotation position (first thing on its line) inside a message
 * that looks like pasted code is not reported as a missing file. Every other mention behaves as before.
 * All fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFileMentions, unresolvedMentionsNotice, looksLikePastedCode, fileMentionsBlock } from '../src/server/AgentV3/fileMentions';

const ROOT = join(__dirname, '..');
const TREE = ['src/App.tsx', 'src/main.tsx', 'package.json', 'Makefile'];

const DART = [
  "import 'package:flutter/material.dart';",
  '',
  'class DemoApp extends StatelessWidget {',
  '  const DemoApp({super.key});',
  '',
  '  @override',
  '  Widget build(BuildContext context) {',
  '    return const Placeholder();',
  '  }',
  '}',
].join('\n');

describe('F1 the report shape: an annotation in pasted code is not a missing file', () => {
  it('🔴 indented @override in pasted Dart: nothing unresolved, no notice', () => {
    const m = parseFileMentions(DART, TREE);
    expect(m.unresolved).toEqual([]);
    expect(unresolvedMentionsNotice(m)).toBe('');
  });

  it('Java @Override at column 0, Kotlin @Composable before code, TS @Component({ are annotations too', () => {
    const java = 'public class A {\n@Override\npublic String toString() {\n  return "a";\n}\n}';
    const kotlin = 'class B {\n  @Composable fun Greeting() {\n    Text("hi");\n  }\n}';
    const ts = "import { Component } from '@angular/core';\n@Component({\n  selector: 'x',\n})\nexport class C {\n  n = 1;\n}";
    for (const src of [java, kotlin, ts]) expect(parseFileMentions(src, TREE).unresolved).toEqual([]);
  });
});

describe('F1 neighbours: every mention that is not an annotation in pasted code is unchanged', () => {
  it('English: "@Header make it sticky" (no code) is still reported', () => {
    expect(parseFileMentions('@Header make it sticky', TREE).unresolved).toEqual(['Header']);
  });

  it('Hinglish and Hindi: a missing file named at line start is still reported', () => {
    expect(parseFileMentions('@Header ko sticky karo', TREE).unresolved).toEqual(['Header']);
    expect(parseFileMentions('@Header को ऊपर चिपका दो', TREE).unresolved).toEqual(['Header']);
  });

  it('in a code message, a path-shaped missing mention is still reported', () => {
    const msg = `@src/Missing.tsx\n@Missing.tsx\n${DART}`;
    expect(parseFileMentions(msg, TREE).unresolved).toEqual(['src/Missing.tsx', 'Missing.tsx']);
  });

  it('in a code message, a bare missing mention mid-line is still reported', () => {
    const msg = `please fix @Header here\n${DART}`;
    expect(parseFileMentions(msg, TREE).unresolved).toEqual(['Header']);
  });

  it('two brace/semicolon lines are not enough to read the message as code', () => {
    const msg = 'look at this {\n@Header\n}';
    expect(parseFileMentions(msg, TREE).unresolved).toEqual(['Header']);
  });

  it('Python decorators (no braces or semicolons) are still reported: conservative, as before', () => {
    const py = '@dataclass\nclass P:\n    x: int = 0\n';
    expect(parseFileMentions(py, TREE).unresolved).toEqual(['dataclass']);
  });

  it('RESOLVED mentions in a code message are unchanged, including a bare identifier at line start', () => {
    const msg = `@package.json\n@Makefile\n${DART}`;
    const m = parseFileMentions(msg, TREE);
    expect(m.resolved).toEqual(['package.json', 'Makefile']);
    expect(m.unresolved).toEqual([]);
    expect(fileMentionsBlock(m)).toContain('- Makefile');
  });

  it('a message with no mentions, an email and a mid-word @ are unchanged', () => {
    expect(parseFileMentions(`mail me@example.com\n${DART}`, TREE)).toEqual({ resolved: [], unresolved: [] });
    expect(parseFileMentions('make the header sticky', TREE)).toEqual({ resolved: [], unresolved: [] });
  });
});

describe('looksLikePastedCode', () => {
  it('needs three lines ending in {, } or ;', () => {
    expect(looksLikePastedCode(DART)).toBe(true);
    expect(looksLikePastedCode('a {\nb }')).toBe(false);
    expect(looksLikePastedCode('a;\nb;\nc;')).toBe(true);
    expect(looksLikePastedCode('Make a todo app.\nIt should save items.\nUse blue.')).toBe(false);
    expect(looksLikePastedCode('')).toBe(false);
  });

  it('is linear: a 200 KB code message with 5,000 annotations parses quickly', () => {
    const big = Array.from({ length: 5_000 }, (_, i) => `  @ann${i}\n  void f${i}() {\n  }`).join('\n');
    const t0 = Date.now();
    expect(parseFileMentions(big, TREE).unresolved).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe('source pins', () => {
  it('the route still tells the user about every remaining unresolved mention', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const missNotice = unresolvedMentionsNotice(mentions);');
    expect(route).toContain("if (missNotice) events.emit({ type: 'narration', agent: 'architect', text: missNotice, ts: Date.now() });");
  });
});
