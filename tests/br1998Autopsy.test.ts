/**
 * BR1998 autopsy: a message that was pasted source code got "⚠️ I could not find @override in this
 * project".
 *
 * The user pasted a whole Flutter (Dart) source file as the message. Its indented `@override` lines
 * passed the file-mention parser's whitespace guard, matched no project file, and the user was told the
 * platform could not find "@override". That is noise about their own code, shown at build start.
 *
 * F1 (reworked after review): an UNRESOLVED bare identifier is not reported as a missing file only when
 * it is not a well-known extensionless file name, is first on its line, the message is mostly code (3+
 * code-ending lines AND at least half the non-empty lines), its own line reads as an annotation (not
 * prose), and it sits between code lines. When unsure, the warning stays. All fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFileMentions, unresolvedMentionsNotice, looksLikePastedCode, fileMentionsBlock, KNOWN_ANNOTATIONS } from '../src/server/AgentV3/fileMentions';

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

describe('F1 the review probes: prose plus a short snippet keeps every real warning', () => {
  const NONE: string[] = []; // a tree in which none of the probed names exist
  const FN3 = 'function f() {\n  return 1;\n}';
  const CONST3 = 'const a = 1;\nconst b = 2;\nconst c = 3;';

  it('🔴 "@Header ko sticky karo" plus a 3-line function', () => {
    expect(parseFileMentions(`@Header ko sticky karo\n${FN3}`, NONE).unresolved).toEqual(['Header']);
  });

  it('🔴 "@Header को ऊपर चिपका दो" plus three const lines', () => {
    expect(parseFileMentions(`@Header को ऊपर चिपका दो\n${CONST3}`, NONE).unresolved).toEqual(['Header']);
  });

  it('🔴 "Please add:\\n@Dockerfile\\n@Makefile" plus a snippet', () => {
    expect(parseFileMentions(`Please add:\n@Dockerfile\n@Makefile\n${FN3}`, NONE).unresolved).toEqual(['Dockerfile', 'Makefile']);
  });

  it('🔴 "@Dockerfile" and "@Makefile add karo" at line start: in prose plus a snippet, and at the top of a paste', () => {
    expect(parseFileMentions(`@Dockerfile\n${FN3}`, NONE).unresolved).toEqual(['Dockerfile']);
    expect(parseFileMentions(`@Makefile add karo\n${CONST3}`, NONE).unresolved).toEqual(['Makefile']);
    expect(parseFileMentions(`@Dockerfile\n${DART}`, NONE).unresolved).toEqual(['Dockerfile']);
    expect(parseFileMentions(`@Makefile add karo\n${DART}`, NONE).unresolved).toEqual(['Makefile']);
  });

  it('🔴 "@App" plus a snippet', () => {
    expect(parseFileMentions(`@App\n${FN3}`, NONE).unresolved).toEqual(['App']);
    expect(parseFileMentions(`@App\n${DART}`, NONE).unresolved).toEqual(['App']);
  });

  it('well-known extensionless names are never dropped, even in annotation position inside code', () => {
    for (const name of ['Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'Rakefile', 'Jenkinsfile', 'Vagrantfile', 'Brewfile', 'Podfile', 'Caddyfile', 'Justfile', 'LICENSE', 'README', 'CHANGELOG']) {
      const msg = `class A {\n  @${name}\n  void f() {\n  }\n}`;
      expect(parseFileMentions(msg, NONE).unresolved).toEqual([name]);
    }
  });

  it('a word after the token keeps the warning even inside code (ko, add, को, please)', () => {
    for (const word of ['ko sticky karo', 'add karo', 'को ठीक करो', 'please fix it,']) {
      const msg = `class A {\n  @Header ${word}\n  void f() {\n  }\n}`;
      expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
    }
  });

  it('a keyword-like word on a prose line (no code ending) keeps the warning', () => {
    const msg = `class A {\n  @Header export karo\n  void f() {\n  }\n}`;
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('a lower-case "word word;" after the token is not a typed declaration', () => {
    const msg = `class A {\n  @Header fix it;\n  void f() {\n  }\n}`;
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('a lone token followed by prose (not code) keeps the warning', () => {
    const msg = `const a = 1;\nconst b = 2;\nconst c = 3;\n@Header\nmake it sticky please`;
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('a dotted or mid-line token inside code keeps the warning', () => {
    expect(parseFileMentions(`class A {\n  @app.route\n  void f() {\n  }\n}`, NONE).unresolved).toEqual(['app.route']);
    expect(parseFileMentions(`class A {\n  int x; @Header\n  void f() {\n  }\n}`, NONE).unresolved).toEqual(['Header']);
  });

  it('prose arguments in parentheses keep the warning', () => {
    const msg = `class A {\n  @Header (the top bar)\n  void f() {\n  }\n}`;
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('a snippet that is less than half the message is not a paste', () => {
    const prose = ['Make the header sticky.', 'Keep the colours.', 'Use the brand font.', 'Add a shadow.'].join('\n');
    const msg = `${prose}\nclass A {\n  @override\n  void f() {\n  }\n}`;
    expect(looksLikePastedCode(msg)).toBe(false);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['override']);
  });
});

describe('F1 the second review probes: a neighbour ending in , or ) is not code', () => {
  const NONE: string[] = [];
  const CONST3 = 'const a = 1;\nconst b = 2;\nconst c = 3;';

  it('🔴 probe 1: a prose line ending in a comma, then a lone @Header, then a snippet', () => {
    const msg = 'Please fix the header,\n\n@Header\n\nconst a = 1;\nconst b = 2;\nconst c = 3;';
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('🔴 probe 2: a "- item," list, then @Header, then the snippet', () => {
    const msg = `- home,\n- profile,\n- settings,\n@Header\n${CONST3}`;
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('🔴 probe 3: a Hinglish list ending in (1)..(5), then @Header, then the snippet', () => {
    const list = ['header ko sticky karo (1)', 'footer ka color badlo (2)', 'logo bada karo (3)', 'menu theek karo (4)', 'font change karo (5)'].join('\n');
    const msg = `${list}\n@Header\n${CONST3}`;
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('a stack of lone @Name lines beside prose is not code: every one keeps its warning', () => {
    const msg = `Please add:\n@Header\n@Footer\n@Sidebar\n${CONST3}\n${CONST3}`;
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header', 'Footer', 'Sidebar']);
  });

  it('a code line on only one side is not enough', () => {
    expect(parseFileMentions(`${CONST3}\n@Header\nthen make it sticky`, NONE).unresolved).toEqual(['Header']);
    expect(parseFileMentions(`Make it sticky.\n@Header\n${CONST3}`, NONE).unresolved).toEqual(['Header']);
  });

  it('more than 8 stacked annotations is unsure: the warning stays', () => {
    // Names still in KNOWN_ANNOTATIONS (Test/Inject/Required/Immutable/Protected were removed as
    // colliding app-file names). Ten stacked known annotations: the last has 9 to walk back over.
    const NAMES = ['Override', 'Deprecated', 'Nullable', 'Autowired', 'Transactional', 'Composable', 'NonNull', 'NotNull', 'JvmStatic', 'JvmField'];
    const stack = NAMES.map((n) => `  @${n}`).join('\n');
    const fields = Array.from({ length: 12 }, (_, i) => `  int x${i};`).join('\n');
    const msg = `class A {\n${fields}\n${stack}\n  void f() {\n  }\n}`;
    expect(looksLikePastedCode(msg)).toBe(true);
    const unresolved = parseFileMentions(msg, NONE).unresolved;
    expect(unresolved).toContain('JvmField'); // 9 annotations to walk over before the code before it
    expect(unresolved).not.toContain('Override'); // code right before it, and a walk of known annotations reaches the declaration
    expect(unresolved).not.toContain('Nullable'); // within the cap
  });

  it('an own line ending in ) or , is not code for the after-test', () => {
    const msg = `const a = 1;\nconst b = 2;\nconst c = 3;\n@Header(x: 1)\nmake it sticky`;
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('the report shape: @override between "const DemoApp({super.key});" and "Widget build(...) {" still matches', () => {
    const msg = ['class DemoApp extends StatelessWidget {', '  const DemoApp({super.key});', '', '  @override', '  Widget build(BuildContext context) {', '    return const Placeholder();', '  }', '}'].join('\n');
    expect(parseFileMentions(msg, NONE).unresolved).toEqual([]);
  });
});

describe('F1 the third review probes: a lone @Name between code lines keeps its warning (strict belt)', () => {
  const NONE: string[] = [];
  const SANDWICH = (name: string) => `const a=1;\nconst b=2;\nconst c=3;\n\n@${name}\n\nfunction f() {\n  return 1;\n}`;

  it('🔴 the sandwich: three const lines, a lone @Header, then a function', () => {
    expect(looksLikePastedCode(SANDWICH('Header'))).toBe(true);
    expect(parseFileMentions(SANDWICH('Header'), NONE).unresolved).toEqual(['Header']);
  });

  it('🔴 the sandwich with an intro line (English and Hinglish)', () => {
    for (const intro of ['Please look at this:', 'yeh abhi ka code hai:']) {
      expect(parseFileMentions(`${intro}\n${SANDWICH('Header')}`, NONE).unresolved).toEqual(['Header']);
    }
  });

  it('🔴 @Login in the same shape', () => {
    expect(parseFileMentions(SANDWICH('Login'), NONE).unresolved).toEqual(['Login']);
    expect(parseFileMentions(`Please look at this:\n${SANDWICH('Login')}`, NONE).unresolved).toEqual(['Login']);
  });

  it('🔴 @Header with no blank line before function f() {', () => {
    const msg = 'const a=1;\nconst b=2;\nconst c=3;\n@Header\nfunction f() {\n  return 1;\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Header']);
  });

  it('common app-file and screen names are not known annotations', () => {
    for (const n of ['Header', 'Footer', 'Login', 'App', 'Home', 'Profile', 'Settings', 'Dashboard', 'Sidebar', 'Navbar', 'Main', 'Index', 'Service', 'Controller', 'Repository', 'Value', 'Table', 'Page', 'Screen', 'Layout', 'Input', 'Output', 'Component', 'Test', 'Entity', 'Directive', 'Id', 'Required', 'Immutable', 'Protected', 'Preview', 'Inject']) {
      expect(KNOWN_ANNOTATIONS.has(n.toLowerCase())).toBe(false);
      const msg = `class A {\n  int x;\n  @${n}\n  void f() {\n  }\n}`;
      expect(parseFileMentions(msg, NONE).unresolved).toEqual([n]);
    }
  });

  it('a known annotation with a blank line before its declaration keeps the warning', () => {
    const msg = 'class A {\n  int x;\n  @override\n\n  void f() {\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['override']);
  });

  it('a known annotation followed by an unknown lone @Name keeps both warnings', () => {
    const msg = 'class A {\n  int x;\n  @Override\n  @Header\n  void f() {\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Override', 'Header']);
  });

  it('a known annotation whose next line ends in , or ) keeps the warning', () => {
    const msg = 'class A {\n  int x;\n  int y;\n  @override\n  Widget build(BuildContext c)\n  {\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['override']);
  });

  it('a known annotation after a line ending in , keeps the warning', () => {
    const msg = 'class A {\n  int x;\n  int y;\n  f(a,\n  @override\n  void g() {\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['override']);
  });

  it('a known annotation in the middle of a line keeps the warning', () => {
    const msg = 'class A {\n  int x;\n  int y; @override\n  void g() {\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['override']);
  });

  it('a path-shaped token with code after it keeps the warning', () => {
    for (const t of ['util.ts', 'lib/util', 'my-file']) {
      const msg = `class A {\n  int x;\n  int y;\n  @${t}();\n  void g() {\n  }\n}`;
      expect(parseFileMentions(msg, NONE).unresolved).toEqual([t]);
    }
  });

  it('a well-known file name with code-like arguments after it keeps the warning', () => {
    for (const t of ['Makefile', 'Dockerfile', 'README', 'license']) {
      const msg = `class A {\n  int x;\n  int y;\n  @${t}(x = 1)\n  void g() {\n  }\n}`;
      expect(parseFileMentions(msg, NONE).unresolved).toEqual([t]);
    }
  });

  it('a known annotation stacked on another known annotation (with arguments) is dropped', () => {
    const msg = 'class A {\n  int x;\n  @Override\n  @SuppressWarnings("unchecked")\n  public void f() {\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual([]);
  });
});

describe('F1 the fourth review probes: colliding names and a stack with no declaration keep the warning', () => {
  const NONE: string[] = [];
  const CONST3 = 'const a = 1;\nconst b = 2;\nconst c = 3;';

  it('🔴 tight sandwich: @Input/@Preview/@Test/@Component keep the warning, Hindi and English prose', () => {
    const cases: Array<{ name: string; intro: string; decl: string }> = [
      { name: 'Preview', intro: 'yeh current code hai:', decl: 'function Preview() {' },
      { name: 'Preview', intro: 'Please look at this:', decl: 'function Preview() {' },
      { name: 'Test', intro: 'yeh current code hai:', decl: 'export default function Test() {' },
      { name: 'Test', intro: 'Please look at this:', decl: 'export default function Test() {' },
      { name: 'Input', intro: 'yeh current code hai:', decl: 'export default function Input() {' },
      { name: 'Input', intro: 'Please look at this:', decl: 'export default function Input() {' },
      { name: 'Input', intro: '', decl: 'export default function Input() {' },
      { name: 'Component', intro: 'yeh current code hai:', decl: 'function Component() {' },
      { name: 'Component', intro: 'Please look at this:', decl: 'function Component() {' },
    ];
    for (const c of cases) {
      const head = c.intro ? `${c.intro}\n` : '';
      const msg = `${head}${CONST3}\n@${c.name}\n${c.decl}\n  return 1;\n}`;
      expect(looksLikePastedCode(msg)).toBe(true);
      const m = parseFileMentions(msg, NONE);
      expect(m.unresolved).toEqual([c.name]);
      expect(unresolvedMentionsNotice(m)).toContain(`@${c.name}`);
    }
  });

  it('🔴 stacked then prose: @Input then @Component then a request, Hindi and English', () => {
    for (const tail of ['I want these files created', 'in files ko create karo']) {
      const msg = `${CONST3}\n@Input\n@Component\n${tail}`;
      expect(looksLikePastedCode(msg)).toBe(true);
      expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Input', 'Component']);
    }
  });

  it('🔴 stacked then prose for @Preview/@Test/@Component as well, Hindi and English', () => {
    for (const names of [['Preview', 'Test'], ['Test', 'Preview'], ['Component', 'Input'], ['Preview', 'Component']]) {
      for (const tail of ['I want these files created', 'in files ko create karo']) {
        const msg = `${CONST3}\n@${names[0]}\n@${names[1]}\n${tail}`;
        expect(looksLikePastedCode(msg)).toBe(true);
        expect(parseFileMentions(msg, NONE).unresolved).toEqual(names);
      }
    }
  });

  it('🔴 @Input then @Override at EOF keeps both warnings', () => {
    const msg = `${CONST3}\n@Input\n@Override`;
    expect(looksLikePastedCode(msg)).toBe(true);
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Input', 'Override']);
  });

  it('a paren-less @Preview above fun Foo() keeps the warning (accepted residual)', () => {
    const msg = 'class B {\n  int x;\n  int y;\n  @Preview\n  fun Foo() {\n    return 1;\n  }\n}';
    expect(parseFileMentions(msg, NONE).unresolved).toEqual(['Preview']);
  });

  it('@Input(), @Component({ and @Test() with arguments still drop (non-lone path unchanged)', () => {
    const input = 'class A {\n  int x;\n  int y;\n  @Input()\n  name: string;\n}';
    const component = "import { Component } from '@angular/core';\n@Component({\n  selector: 'x',\n})\nexport class C {\n  n = 1;\n}";
    const testAnn = 'public class A {\n  int x;\n  int y;\n  @Test()\n  public void f() {\n  }\n}';
    for (const src of [input, component, testAnn]) expect(parseFileMentions(src, NONE).unresolved).toEqual([]);
  });
});

describe('F1 whole pastes are still silenced', () => {
  it('Dart, Java, Kotlin and TS pastes report nothing', () => {
    const java = 'public class A {\n  @Override\n  @Deprecated\n  public String toString() {\n    return "a";\n  }\n  @Override public int hashCode() {\n    return 1;\n  }\n}';
    const kotlin = 'class B {\n  @Composable fun Greeting() {\n    Text("hi");\n  }\n  @Preview(showBackground = true)\n  @Composable\n  fun P() {\n    Greeting();\n  }\n}';
    const ts = "import { Component, Input } from '@angular/core';\n@Component({\n  selector: 'x',\n})\nexport class C {\n  @Input() name: string;\n  @Input() size = 1;\n}";
    const springish = 'public class S {\n  @Autowired\n  private Repo repo;\n  @Nullable String label;\n}';
    for (const src of [DART, java, kotlin, ts, springish]) expect(parseFileMentions(src, TREE).unresolved).toEqual([]);
  });
});

describe('looksLikePastedCode', () => {
  it('Flutter-style code (most lines end in ( , or )) counts toward the half', () => {
    const flutter = ['class W extends StatelessWidget {', '  @override', '  Widget build(BuildContext context) {', '    return Scaffold(', '      body: Center(', '        child: Column(', '          children: [', '            Text(', "              'x',", '            ),', '          ],', '        ),', '      ),', '    );', '  }', '}'].join('\n');
    expect(looksLikePastedCode(flutter)).toBe(true);
    expect(parseFileMentions(flutter, TREE).unresolved).toEqual([]);
  });

  it('prose lines ending in commas or brackets do not make three statements', () => {
    expect(looksLikePastedCode('Add a header,\nand a footer,\n(both sticky)\n@Header')).toBe(false);
  });

  it('needs three lines ending in {, } or ; ; code-shaped lines are at least half of the non-empty lines', () => {
    expect(looksLikePastedCode(DART)).toBe(true);
    expect(looksLikePastedCode('a {\nb }')).toBe(false);
    expect(looksLikePastedCode('a;\nb;\nc;')).toBe(true);
    expect(looksLikePastedCode('a;\nb;\nc;\nx\ny\nz')).toBe(true);
    expect(looksLikePastedCode('a;\nb;\nc;\nw\nx\ny\nz')).toBe(false);
    expect(looksLikePastedCode('a;\n\n\nb;\n\nc;\nx')).toBe(true);
    expect(looksLikePastedCode('Make a todo app.\nIt should save items.\nUse blue.')).toBe(false);
    expect(looksLikePastedCode('')).toBe(false);
  });

  it('is linear: a 200 KB code message with 5,000 annotations parses quickly', () => {
    const big = `class Big {\n${Array.from({ length: 5_000 }, (_, i) => `  @override\n  void f${i}() {\n  }`).join('\n')}\n}`;
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
