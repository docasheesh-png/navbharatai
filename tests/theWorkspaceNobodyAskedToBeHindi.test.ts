/**
 * AUTOPSY 466c260a (2026-09-29) — a workspace app ("Notes, Visualizer, pdf, code, file handling,
 * picture editor, pro chat, codestudio"), built on the weak tier in 16.6 minutes.
 *
 * Five wrong turns, each locked here against the report's own words:
 *
 *   1. The request was written in English. Every label shipped in Devanagari, and the summary told the
 *      user "Saara user-facing text Hindi mein hai, jaise aapne request ki thi".
 *   2. "pro chat" made the app a SOCIAL network, and its build was told to include auth, a realtime
 *      feed, moderation and media upload.
 *   3. Five pages rendered inside a shell whose topbar shows the page title were flagged NO_HEADING, and
 *      a 255-second repair added a second title to each.
 *   4. The "Pro Chat" answered with text written into the app — no AI, no network call anywhere — and
 *      the summary sold it as a "Smart chat interface … Instant assistant response".
 *   5. The shell used `.nb-nav`, `.nb-nav-list`, `.nb-page-title` — kit-looking names the kit does not
 *      have and no stylesheet defined — and nobody said so until the end-of-build check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appLanguageInstruction, requestNamesAppLanguage, LATIN_REQUEST_LANGUAGE_LINE } from '../src/server/AgentV3/LanguageDetect';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeDesignCoverage, shellOwnsPageHeading } from '../src/server/AgentV3/DesignCoverage';
import { findScriptedAssistant, scriptedAssistantNotice } from '../src/server/AgentV3/scriptedAssistant';
import { inventedKitClasses, inventedKitClassNote, usesNonKitNbClass } from '../src/server/AgentV3/kitRestore';
import { securityWriteNote } from '../src/server/AgentV3/SecurityAnalysis';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// The report's prompt, verbatim.
const PROMPT = 'Notes , Visualizeusing, pdf code file handling picture editor , pro chat codestudeo and more';

describe('1 · a request in Latin letters is built in Latin letters', () => {
  it('🔴 the report prompt gets the explicit Latin-script line, which forbids Devanagari', () => {
    const line = appLanguageInstruction(PROMPT);
    expect(line).toBe(LATIN_REQUEST_LANGUAGE_LINE);
    expect(line).toMatch(/NEVER switch to Devanagari/);
    expect(line).toMatch(/never tell them they asked for one/);
  });
  it('it does not force English on a Latin request in another language — it keeps THEIR language', () => {
    expect(appLanguageInstruction('una app para notas con recordatorios')).toMatch(/SAME language they wrote in/);
  });
  it('a request in an Indian script still names that language', () => {
    expect(appLanguageInstruction('मेरे लिए एक नोट्स ऐप बनाओ')).toMatch(/Hindi/);
    expect(appLanguageInstruction('மளிகை கடைக்கு ஒரு ஆப் செய்')).toMatch(/Tamil/);
  });
  it('a romanized Indian request keeps its romanized guess', () => {
    expect(appLanguageInstruction('enakku oru kadai app venum romba nalla')).toMatch(/Tamil in Roman script/);
  });
  it('🔒 an explicit ask for a language is never overridden', () => {
    for (const t of ['notes app hindi me banao', 'build a notes app in Tamil', 'a bilingual quiz app', 'translate the labels to Marathi']) {
      expect(requestNamesAppLanguage(t), t).toBe(true);
      expect(appLanguageInstruction(t), t).not.toBe(LATIN_REQUEST_LANGUAGE_LINE);
    }
    expect(requestNamesAppLanguage(PROMPT)).toBe(false);
  });
  it('the architect and every sub-agent read the SAME line', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('buildPrompt = `${appLanguageInstruction(prompt)}\\n\\n${buildPrompt}`;');
    expect(route).toContain('languageRule: () => appLanguageInstruction(prompt),');
    const sub = read('src/server/AgentV3/SubAgent.ts');
    const at = sub.indexOf('const contextBlocks = [');
    expect(sub.slice(at, sub.indexOf('].filter(Boolean);', at))).toContain('deps.languageRule?.()');
  });
});

describe('2 · a chat with an AI is a tool, not a social network', () => {
  it('🔴 the report prompt is not social', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).not.toBe('social');
  });
  it('assistant chats in any common wording', () => {
    for (const t of ['a notes app with an AI chat', 'pro chat and code studio', 'chat with PDF documents', 'a study helper chatbot', 'chat with the assistant about my files']) {
      expect(analyzeRequirementGaps(t).domain, t).not.toBe('social');
    }
  });
  it('🔒 chatting with PEOPLE keeps its domain', () => {
    for (const t of ['a group chat app with friends and followers', 'a realtime chat app with rooms, message history and user profiles']) {
      expect(analyzeRequirementGaps(t).domain, t).toBe('social');
    }
  });
});

describe('3 · a page under a shell that shows its title has a title', () => {
  const SHELL = `export default function DashboardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="nb-shell"><aside className="nb-sidebar">…</aside>
    <header className="nb-topbar"><h1 className="nb-page-title">{title}</h1></header>
    <main className="nb-main">{children}</main></div>);
}`;
  const APP = `import DashboardShell from './components/DashboardShell';
import Notes from './pages/Notes';
import Visualizer from './pages/Visualizer';
export default function App() {
  const [active, setActive] = useState('notes');
  return <DashboardShell title={titles[active]}>{active === 'notes' ? <Notes /> : <Visualizer />}</DashboardShell>;
}`;
  const PAGE = `export default function Notes() {
  return (<div className="nb-notes-layout"><div className="card"><input className="input" /><button className="btn-primary">Save</button>
  <ul className="list"><li className="row">a</li></ul><p className="muted">x</p></div></div>);
}`;
  const files = { 'src/components/DashboardShell.tsx': SHELL, 'src/App.tsx': APP, 'src/pages/Notes.tsx': PAGE };

  it('🔴 the report shape: not NO_HEADING', () => {
    expect(shellOwnsPageHeading('src/pages/Notes.tsx', files)).toBe(true);
    const found = analyzeDesignCoverage(files).findings.find((f) => f.file === 'src/pages/Notes.tsx');
    expect(found?.defects ?? []).not.toContain('NO_HEADING');
  });
  it('a layout that renders the page directly counts too', () => {
    const direct = { 'src/App.tsx': `<header className="topbar"><h2>{pageTitle}</h2></header>{tab === 'n' && <Notes />}`, 'src/pages/Notes.tsx': PAGE };
    expect(shellOwnsPageHeading('src/pages/Notes.tsx', direct)).toBe(true);
  });
  it('🔒 a brand-only header is not a page title — the page is still flagged', () => {
    const brand = { ...files, 'src/components/DashboardShell.tsx': SHELL.replace('{title}', 'NavAI') };
    expect(shellOwnsPageHeading('src/pages/Notes.tsx', brand)).toBe(false);
    expect(analyzeDesignCoverage(brand).findings.find((f) => f.file === 'src/pages/Notes.tsx')?.defects).toContain('NO_HEADING');
  });
  it('🔒 a modal or card with {title}{children} is not a layout', () => {
    const modal = {
      'src/components/Modal.tsx': `export default function Modal({ title, children }) { return <div className="modal"><h2>{title}</h2>{children}</div>; }`,
      'src/App.tsx': `import Modal from './components/Modal'; import Notes from './pages/Notes'; <Modal title="x">hi</Modal>; <Notes />`,
      'src/pages/Notes.tsx': PAGE,
    };
    expect(shellOwnsPageHeading('src/pages/Notes.tsx', modal)).toBe(false);
  });
  it('🔒 a page nobody renders inside the shell is judged as before', () => {
    const outside = { ...files, 'src/App.tsx': `import DashboardShell from './components/DashboardShell'; export default () => <DashboardShell title="a">x</DashboardShell>;` };
    expect(shellOwnsPageHeading('src/pages/Notes.tsx', outside)).toBe(false);
  });
});

describe('4 · a chat sold as an assistant must be one, or say it is not', () => {
  const CHAT = `const reply = (q: string) => ({ role: 'assistant', text: 'Great question! ' + q });
export default function ProChat() { const send = () => setTimeout(() => setMsgs((m) => [...m, reply(input)]), 400); }`;
  it('🔴 the report shape: assistant replies and no network call anywhere', () => {
    const f = findScriptedAssistant({ 'src/pages/ProChat.tsx': CHAT, 'src/pages/Notes.tsx': 'export default () => null;' }, PROMPT);
    expect(f?.files).toEqual(['src/pages/ProChat.tsx']);
    const notice = scriptedAssistantNotice(f);
    expect(notice).toMatch(/fixed replies written into the app/);
    expect(notice).not.toMatch(/claude|gpt|openai|gemini|grok|kimi|glm|anthropic/i);
  });
  it('🔒 any network or AI call anywhere in the project makes it real', () => {
    for (const call of ["await fetch('/api/chat')", "import OpenAI from 'openai'", 'await window.NavAI.ask(q)', "import axios from 'axios'"]) {
      expect(findScriptedAssistant({ 'src/pages/ProChat.tsx': CHAT, 'src/lib/api.ts': call }, PROMPT), call).toBeNull();
    }
  });
  it('🔒 a bot the user ASKED to be scripted is left alone', () => {
    expect(findScriptedAssistant({ 'src/pages/ProChat.tsx': CHAT }, 'build a rule-based FAQ bot for my shop')).toBeNull();
  });
  it('tests and mocks are not the app', () => {
    expect(findScriptedAssistant({ 'src/pages/ProChat.test.tsx': CHAT, 'src/__mocks__/chat.ts': CHAT }, PROMPT)).toBeNull();
  });
  it('the route discloses it and records the finding, after confirming on the whole project', () => {
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf('const scripted = findScriptedAssistant(whole, prompt);');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at - 400, at)).toContain('loadWorkspaceFiles(workspaceId)');
    expect(route).toContain("code: 'SCRIPTED_ASSISTANT_SHIPPED'");
  });
});

describe('5 · a kit-looking class the kit does not have is named at write time', () => {
  const SHELL = `<nav className="nb-nav"><ul className="nb-nav-list"><li className="nb-nav-item active">x</li></ul></nav><h1 className="nb-page-title">{t}</h1><div className="card">`;
  it('🔴 the report classes are flagged; kit classes and plain app classes are not', () => {
    expect(inventedKitClasses(SHELL, 'src/components/DashboardShell.tsx', { 'src/index.css': '.card{}' }))
      .toEqual(['nb-nav', 'nb-nav-list', 'nb-page-title']);
    expect(usesNonKitNbClass('<div className="nb-topbar card-title">', 'src/A.tsx')).toBe(false);
  });
  it('a class the app defines itself is not flagged', () => {
    const css = { 'src/index.css': '.nb-nav{display:flex}.nb-nav-list{gap:4px}.nb-page-title{font-size:20px}' };
    expect(inventedKitClasses(SHELL, 'src/components/DashboardShell.tsx', css)).toEqual([]);
  });
  it('the note names the classes and the kit alternatives, and a stylesheet or a non-source file is never judged', () => {
    expect(inventedKitClassNote('src/A.tsx', ['nb-nav'])).toMatch(/\.nb-nav .*kit does not define them/);
    expect(inventedKitClasses('.nb-nav{}', 'src/index.css', {})).toEqual([]);
  });
  it('the dispatcher hands the note back with the write', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('const invented = await this.inventedKitClassNotes(files);');
    expect(d).toMatch(/return hooks \+ storeLoop \+ imports \+ typecheck \+ quality \+ invented \+ undefinedCss \+ style \+ security \+ shadow(?: \+ \w+)*;/);
  });
});

describe('6 · an XSS sink is named while the file is open, not after the app is green', () => {
  const CHAT = `export default function ProChat() {
  return <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />;
}`;
  it('🔴 the report sinks are named at write time', () => {
    expect(securityWriteNote('src/pages/ProChat.tsx', CHAT)).toMatch(/Security check on src\/pages\/ProChat\.tsx[\s\S]*line 2: dangerouslySetInnerHTML/);
    expect(securityWriteNote('src/pages/CodeStudio.tsx', 'out.innerHTML = result;')).toMatch(/innerHTML/);
  });
  it('clean code, a cleared sink, tests and fixtures stay silent', () => {
    expect(securityWriteNote('src/pages/Notes.tsx', '<p>{note.text}</p>')).toBe('');
    expect(securityWriteNote('src/pages/X.tsx', "el.innerHTML = '';")).toBe('');
    expect(securityWriteNote('src/pages/ProChat.test.tsx', CHAT)).toBe('');
    expect(securityWriteNote('src/index.css', 'a{}')).toBe('');
  });
  it('the kill switch turns it off', () => {
    expect(securityWriteNote('src/pages/ProChat.tsx', CHAT, { AGENTV3_WRITE_SECURITY: 'off' })).toBe('');
  });
  it('the dispatcher hands it back with every write', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('security += securityWriteNote(p, files[p]);');
  });
});
