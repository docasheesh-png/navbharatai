import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * NO DEAD CONTROLS IN THE IDE (admin 2026-08-04: "koi hidden bugs ya kuch aur inactive button to nahi
 * rah gaye?").
 *
 * A shortcut listed in the Shortcuts panel, or an icon rendered in a toolbar, is a PROMISE to the user.
 * One that silently does nothing is the same defect as a button with no onClick — and it is worse than
 * a missing feature, because it teaches the user that the app is broken.
 *
 * The audit that prompted this found ten: a ▶ that only re-ran the preview, a <Layout/> icon with no
 * handler at all, four permanently-disabled debugger controls, and nine shortcuts advertised in the
 * panel that no `case` in handleShortcut ever matched — including three debug-stepping keys for a
 * debugger that does not exist and a "Open Dev Tools" a web page cannot open.
 *
 * This test does the whole audit mechanically, so the next one is caught by CI instead of by an admin
 * tapping a button and finding nothing happens.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** Source minus comments — for invariants about what the USER sees, not what the file explains. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const studio = read('src/components/ide/CodeStudio.tsx');
const editor = read('src/components/ide/Editor.tsx');

/** Commands the UI advertises to the user (Shortcuts panel + Command Palette). */
function advertisedCommands(): Set<string> {
  const out = new Set<string>();
  for (const f of ['src/components/ide/VirtualKeyboard.tsx', 'src/components/ide/CommandPalette.tsx']) {
    const src = read(f);
    for (const m of src.matchAll(/command:\s*'([^']+)'/g)) out.add(m[1]);
    for (const m of src.matchAll(/action:\s*'([^']+)'/g)) out.add(m[1]);
  }
  return out;
}

/** Commands handleShortcut explicitly handles. */
function handledCommands(): Set<string> {
  const start = studio.indexOf('const handleShortcut');
  const body = studio.slice(start, studio.indexOf('\n  }, [', start));
  return new Set([...body.matchAll(/case '([^']+)'/g)].map((m) => m[1]));
}

/**
 * Monaco action ids are forwarded wholesale to the editor, so they need no `case`. The prefixes here
 * mirror the real forwarding condition in handleShortcut — keep them in step if that changes.
 */
const isMonacoPassthrough = (c: string) =>
  c.startsWith('editor.') || c.startsWith('actions.') || c.startsWith('cursor')
  || c === 'undo' || c === 'redo' || c === 'acceptSelectedSuggestion';

describe('every advertised shortcut actually does something', () => {
  it('no command in the Shortcuts panel is unhandled', () => {
    const handled = handledCommands();
    const dead = [...advertisedCommands()].filter((c) => !handled.has(c) && !isMonacoPassthrough(c)).sort();
    expect(dead).toEqual([]);
  });

  it('the four that were silently dead are now really implemented', () => {
    const handled = handledCommands();
    for (const c of [
      'expandLineSelection',              // Ctrl+L — lacks the prefix the passthrough matched on
      'workbench.action.files.openFile',  // Ctrl+O — routes to the real quick-open
      'workbench.action.showAllSymbols',  // Ctrl+T — Monaco's quick outline
      'workbench.action.reopenClosedEditor', // Ctrl+Shift+T — a real closed-tab stack
    ]) {
      expect(handled.has(c)).toBe(true);
    }
    // Reopen must restore a real tab, and skip files that no longer exist — reopening onto a deleted
    // file would show an empty editor that looks like the file was emptied.
    const i = studio.indexOf("case 'workbench.action.reopenClosedEditor'");
    const body = studio.slice(i, i + 900);
    expect(body).toContain('closedTabs');
    expect(body).toContain('files[path] === undefined');
    expect(body).toContain('setActiveFile(path)');
  });

  it('shortcuts a browser genuinely cannot perform are GONE, not stubbed', () => {
    const kb = read('src/components/ide/VirtualKeyboard.tsx');
    for (const c of [
      'workbench.action.toggleDevTools',              // a page cannot open browser devtools
      'workbench.action.terminal.openNativeConsole',  // no native OS console from a browser
      'workbench.action.debug.stepInto',              // no live debugger exists
      'workbench.action.debug.stepOver',
      'workbench.action.debug.stepOut',
      'workbench.action.terminal.runRecentCommand',   // the real shell's own ↑ already does this
    ]) {
      expect(kb).not.toContain(`command: '${c}'`);
    }
    // And nothing quietly logs guidance instead of acting.
    expect(studio).not.toContain("console.log('Press F12");
  });

  it('no two OF OUR OWN commands claim the same key', () => {
    // Ctrl+Shift+C was listed twice — "External Terminal" and "Open Dev Tools". Both routed through our
    // own switch, so at most one could ever fire and the other was dead by construction.
    //
    // Deliberately scoped to commands WE dispatch. Monaco passthroughs may legitimately share a key:
    // Tab is bound to both `acceptSelectedSuggestion` and `editor.action.inlineSuggest.commit`, exactly
    // as in VS Code, and Monaco resolves which applies from what is on screen. Flagging that would be
    // the test inventing a rule the editor itself does not follow.
    const kb = read('src/components/ide/VirtualKeyboard.tsx');
    const ours = [...kb.matchAll(/key:\s*'([^']+)'[^\n]*?command:\s*'([^']+)'/g)]
      .filter((m) => !isMonacoPassthrough(m[2]))
      .map((m) => m[1]);
    const dupes = ours.filter((k, i) => ours.indexOf(k) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });
});

describe('every screen you can navigate to actually renders', () => {
  it('no navigation target falls through to a blank panel', () => {
    // THE BLIND SPOT IN THE EARLIER AUDIT. Checking "does a `case` exist for this command?" is not the
    // same as "does that case lead anywhere". Ctrl+Shift+D (`workbench.view.debug`) was handled — it
    // set activeScreen='debug' and opened the sidebar — but the sidebar renders from a switch with no
    // 'debug' case, so it hit `default: return null` and the panel opened EMPTY.
    const targets = new Set([
      ...[...studio.matchAll(/handleScreenChange\('([^']+)'\)/g)].map((m) => m[1]),
      ...[...studio.matchAll(/setActiveScreen\('([^']+)'\)/g)].map((m) => m[1]),
    ]);
    const rendered = new Set([
      ...[...studio.matchAll(/case '([^']+)':/g)].map((m) => m[1]),
      ...[...studio.matchAll(/activeScreen === '([^']+)'/g)].map((m) => m[1]),
    ]);
    expect([...targets].filter((t) => !rendered.has(t)).sort()).toEqual([]);
  });

  it('the Debug view shortcut opens the real debugger panel', () => {
    const i = studio.indexOf("case 'workbench.view.debug'");
    expect(i).toBeGreaterThan(-1);
    const body = studio.slice(i, i + 700);
    expect(body).toContain('setIsDebugPanelOpen(true)');
    expect(body).not.toContain("setActiveScreen('debug')");
  });
});

describe('nothing in the IDE invites a tap and then swallows it', () => {
  it('Tag Mode and Fix Bug reach the AI panel — they used to be dead ends', () => {
    // PreviewPanel is mounted ONLY by Code Studio, and Code Studio did not pass `onEditWithAI`. Tag
    // Mode was gated on `generatedCode` alone, so you could switch it on, see a badge on every
    // element, tap one — and `onEditWithAI?.(hint)` was undefined. Worse than an inert button, because
    // it invites the interaction first. Same for the error overlay's Fix Bug button.
    const i = studio.indexOf('<PreviewPanel');
    const mount = studio.slice(i, i + 1200);
    expect(mount).toContain('onEditWithAI=');
    expect(mount).toContain("setActiveScreen('ai')");
    // The hint must actually reach the chat box.
    expect(studio).toContain('prefill={aiPrefill}');
    const chat = read('src/components/ide/AgentV3MiniChat.tsx');
    expect(chat).toContain('prefill');
    expect(chat).toContain('setInput(');
  });

  it('a repeated tap on the SAME element still registers, without polluting the message', () => {
    // Keyed on a nonce, not the text — otherwise React sees an identical value and ignores the second
    // tap, and stuffing a timestamp into the text would put it in the user's message.
    const chat = read('src/components/ide/AgentV3MiniChat.tsx');
    expect(chat).toContain('prefill?.nonce');
    expect(studio).toContain('nonce: Date.now()');
  });

  it('the prefill APPENDS — it never clobbers what the user was typing', () => {
    // Replacing a half-written message to insert an element reference would lose the user's words at
    // the exact moment they were describing the change they wanted.
    const chat = read('src/components/ide/AgentV3MiniChat.tsx');
    const i = chat.indexOf('const text = prefill?.text');
    expect(chat.slice(i, i + 400)).toContain('setInput((cur) =>');
  });

  it('the IDE Settings screen has no fake navigation rows', () => {
    // General / Editor / Terminal / Extensions were rendered `cursor-pointer` with a chevron and no
    // onClick — they looked like doors into sub-screens that were never built.
    expect(stripComments(studio)).not.toMatch(/\['General', 'Editor', 'Terminal', 'Extensions'\]/);
  });
});

describe('no inert icons in the editor toolbar', () => {
  it('every clickable-looking icon in the toolbar row has a handler', () => {
    // The <Layout/> icon sat here styled `cursor-pointer` with no onClick at all.
    const row = editor.slice(editor.indexOf('{/* DEBUG'), editor.indexOf('{/* C11: Binary file warning'));
    const inert = [...row.matchAll(/<([A-Z]\w+)\s+className="[^"]*cursor-pointer[^"]*"\s*\/>/g)].map((m) => m[1]);
    expect(inert).toEqual([]);
  });

  it('the debugger ships no disabled run controls', () => {
    const panel = read('src/components/ide/DebugPanel.tsx');
    expect(panel).not.toContain('cursor-not-allowed');
    expect(panel).not.toMatch(/<button[^>]*\sdisabled\b/);
    // …while still saying plainly what is not available, so nobody hunts for a stepper.
    expect(panel.toLowerCase()).toContain('not available yet');
  });

  it('the debugger has no tabs that lead to a "coming soon" screen', () => {
    // It shipped Call Stack and Variables tabs whose only content was a deferred-state message. Same
    // defect as the disabled buttons: two things a user can tap that go nowhere — and they DO tap them,
    // to find out. The panel is single-purpose now, and breakpoints are completely real.
    const panel = read('src/components/ide/DebugPanel.tsx');
    expect(panel).not.toContain("label: 'Call Stack'");
    expect(panel).not.toContain("label: 'Variables'");
    expect(panel).not.toContain('DeferredState');
    // Checked against the CODE only. The file's header comment still recounts what was removed and
    // why — that history is worth keeping, and a test that forbids a word in a comment would just
    // teach the next person to delete the explanation.
    expect(stripComments(panel)).not.toMatch(/coming soon/i);
  });

  it('NO phone-reachable IDE surface hides a control behind hover', () => {
    // A touch device never fires hover, so `opacity-0 group-hover:opacity-100` is not a subtle reveal
    // there — it is an invisible, untappable control. Two real capabilities were lost this way:
    // deleting a file from the Files tab, and closing a background editor tab. Both surfaces are
    // FOOTER TABS on a phone, i.e. exactly where they are used most.
    //
    // The fix is not "always visible" — that loses the desktop polish. It is `(hover: hover)`: pointer
    // devices keep the reveal, touch devices get the control. So what is banned is an UNGATED
    // opacity-0 reveal, not the pattern itself.
    for (const f of [
      'src/components/ide/FileExplorer.tsx',
      'src/components/ide/Editor.tsx',
      'src/components/ide/DebugPanel.tsx',
      'src/components/ide/CodeStudio.tsx',
      'src/components/ide/TerminalPanel.tsx',
      'src/components/ide/GitPanel.tsx',
      'src/components/ide/ProblemsPanel.tsx',
    ]) {
      // Comments stripped: the files explain this very pattern, and a test that forbids a word
      // in a comment only teaches the next person to delete the explanation.
      const src = stripComments(read(f));
      // An `opacity-0 … group-hover:opacity-100` that is NOT gated on (hover: hover).
      const ungated = [...src.matchAll(/opacity-0\s+(?:\[@media\(hover:hover\)\]:)?group-hover(?:\/\w+)?:opacity-100/g)]
        .map((m) => m[0])
        .filter((m) => !m.includes('hover:hover'));
      expect({ file: f, ungated }).toEqual({ file: f, ungated: [] });
    }
  });

  it('no control in the debugger is HOVER-ONLY — a phone has no hover', () => {
    // `opacity-0 group-hover:opacity-100` makes a button invisible and effectively untappable on
    // touch. Debug is a phone footer tab, so that is exactly where its remove-breakpoint ✕ is used
    // most. Fading in on hover is fine; starting at zero is not.
    const panel = read('src/components/ide/DebugPanel.tsx');
    expect(panel).not.toContain('opacity-0 group-hover:opacity-100');
  });
});

/**
 * ONE APP, ONE VIEW OF IT (admin 2026-08-05, from the live site).
 *
 * Three symptoms, two root causes:
 *   • an app built EARLIER opened empty in Code Studio
 *   • Code Studio's preview said "Waiting for magic…" while the status bar said PREVIEW LIVE · 13 FILES
 *   • Code Studio's preview was a different preview from the slide-menu / v5 one
 *
 * Both causes were the same shape: Code Studio read app-level state that only a build finishing IN
 * THAT SESSION ever populated, so two views of one running app disagreed with each other.
 */
describe('Code Studio shows the SAME app the rest of the product does', () => {
  it('renders the v5 PreviewSurface — not the retired generatedCode panel — when a workspace exists', () => {
    expect(studio).toContain("import { PreviewSurface }");
    const i = studio.indexOf('v3Preview?.workspaceId || v3Preview?.previewUrl');
    expect(i).toBeGreaterThan(-1);
    const block = studio.slice(i, i + 700);
    expect(block).toContain('<PreviewSurface');
    expect(block).toContain('url={v3Preview?.previewUrl}');
    expect(block).toContain('workspaceId={v3Preview?.workspaceId}');
  });

  it('is handed the same preview state the slide-menu Preview renders from', () => {
    const panels = read('src/components/panels/ViewPanels.tsx');
    const i = panels.indexOf('<CodeStudio');
    expect(panels.slice(i, i + 1600)).toContain('v3Preview={v3Preview}');
    // The slide-menu Preview reads the very same object — that is what makes them one preview.
    expect(panels).toContain('url={v3Preview?.previewUrl}');
  });

  it('hydrates the file set from the workspace, not only from a build that just finished', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('hydratedWorkspaceRef');
    const i = app.indexOf('const hydratedWorkspaceRef');
    const block = app.slice(i, i + 2200);
    expect(block).toContain("'/api/agentv3/workspace-files'");
    // Must never clobber files the user already has open, and must not echo the load back as an edit.
    expect(block).toContain('if (Object.keys(files).length > 0) return;');
    expect(block).toContain('noteRemote(clean)');
    // Once per workspace, so it cannot loop.
    expect(block).toContain('hydratedWorkspaceRef.current === workspaceId');
  });

  it('a dormant workspace is WOKEN for the terminal, not handed back as a chore', () => {
    // The live report: opening the terminal on a project with 21 saved files said "send a message in
    // v5.0 chat to bring the sandbox back online, then the terminal works again". Honest, and still
    // the wrong answer — it hands the user a task and sends them to another screen to do it. We know
    // the workspace, we hold the files, and the resume path was already proven; it was simply never
    // wired to the terminal.
    const routes = read('src/server/routes/agentv3.ts');
    // Now a BACKGROUND job with pollable progress (2026-08-06): holding /shell/open through a cold
    // sandbox create is what made a 90s client deadline expire on wakes that were succeeding.
    expect(routes).toContain('function startTerminalWake');
    const i = routes.indexOf('function startTerminalWake');
    const fn = routes.slice(i, i + 6500);
    expect(fn).toContain('ensureWorkspace(workspaceId, undefined, resumeSandboxId)');
    expect(fn).toContain('registerSession(workspaceId, git, userId, actuator)');
    // Seeds the saved project back — a recreated sandbox comes back EMPTY, and a terminal opening onto
    // an empty directory looks exactly like the data loss this path exists to prevent.
    expect(fn).toContain('loadWorkspaceFiles(workspaceId)');
    expect(fn).toContain('TERMINAL_WAKE_MAX_FILES');
    // A failed wake records its REAL (sanitized) reason instead of vanishing into a boolean.
    expect(fn).toContain('sanitizeWakeError');
    // Only attempted for a workspace that really holds a project, and only when a sandbox exists to wake.
    const open = routes.slice(routes.indexOf("app.post('/api/agentv3/shell/open'"), routes.indexOf("app.get('/api/agentv3/shell/stream'"));
    expect(open).toContain('hasProject > 0 && canWake');
    expect(open).toContain("AGENTV3_TERMINAL_AUTOWAKE !== 'off'");
    // The open ANSWERS instead of blocking: a waking workspace is reported as such with progress.
    expect(open).toContain("reason: 'waking'");
    // And the user is told it is happening — resuming a sandbox takes real seconds.
    expect(read('src/components/ide/ShellTerminal.tsx')).toContain('Starting your workspace…');
  });

  it('the terminal shows WHICH precondition failed, not just that one did', () => {
    // "No sandbox" has three quite different causes needing three different actions: the workspace is
    // not on this instance (a cold start — wake it), it is here with no runner, or its runner cannot
    // open a TTY. Collapsing them into one sentence is what made a live report undiagnosable.
    const routes = read('src/server/routes/agentv3.ts');
    const i = routes.indexOf("const cause = !session ? 'no_session'");
    expect(i).toBeGreaterThan(-1);
    expect(routes.slice(i, i + 260)).toContain("'runner_not_pty'");
    // Sent only on the ownership-checked route, so only the workspace's owner can ever read it.
    const open = routes.slice(routes.indexOf("app.post('/api/agentv3/shell/open'"), routes.indexOf("app.get('/api/agentv3/shell/stream'"));
    expect(open).toContain('assertVerifiedWorkspaceOwner');
    expect(open).toContain('cause,');
    const shell = read('src/components/ide/ShellTerminal.tsx');
    expect(shell).toContain('if (j.cause)');
    expect(shell).toContain('j?.detail');
  });

  it('the terminal names the real reason it failed', () => {
    // "Could not reach the terminal service." on its own told nobody anything — including me, when a
    // live report arrived and I could not reproduce it. An error that hides its cause is a second bug.
    const shell = read('src/components/ide/ShellTerminal.tsx');
    expect(shell).toContain('session expired');       // 401/403
    expect(shell).toContain('Too many terminals');    // 429
    expect(shell).toContain('not enabled on this server'); // 404
    expect(shell).toContain('navigator.onLine');      // genuinely offline
    expect(shell).toContain('e instanceof Error');    // carries the browser's own reason
  });
});

/**
 * UPLOAD ZIP in Code Studio (admin 2026-08-05). Destructive, so the wiring is pinned, not just the
 * presence of a menu entry: the warning must come first, it must be readable by the user, and the
 * upload must reuse the transport v5.0 already proved rather than a second one with its own limits.
 */
describe('Code Studio → Upload ZIP', () => {
  it('lives in the More sheet with a LOCALIZED label', () => {
    const i = studio.indexOf('PHONE BOTTOM-TAB IDE');
    const block = studio.slice(i, i + 5200);
    expect(block).toContain('zipText.menuLabel');
    // An English menu entry above a Hindi warning is a seam the user notices first.
    expect(block).not.toContain("label: 'Upload ZIP'");
  });

  it('warns BEFORE the picker — the destructive step is never one tap away', () => {
    // Tapping the menu opens the confirm dialog; only the confirm button opens the device picker.
    expect(studio).toContain('setZipConfirmOpen(true)');
    const i = studio.indexOf('{zipText.confirm}');
    expect(i).toBeGreaterThan(-1);
    expect(studio.slice(Math.max(0, i - 500), i)).toContain('zipInputRef.current?.click()');
    // The menu entry itself must NOT open the picker directly.
    const menu = studio.slice(studio.indexOf('zipText.menuLabel'), studio.indexOf('zipText.menuLabel') + 200);
    expect(menu).not.toContain('zipInputRef.current?.click()');
  });

  it('reuses the v5.0 chunked uploader — not a second transport with its own size cap', () => {
    // A base64 request body is what capped the old import at ~18 MB; uploadZipProject chunks instead,
    // so "kitni bhi badi file" is a property of the transport, not a hope.
    expect(studio).toContain("import { uploadZipProject } from '../../lib/zipProjectUpload'");
    expect(studio).toContain('await uploadZipProject(file, workspaceId');
    // Progress is shown, because a large archive on a phone takes real time.
    expect(studio).toContain('setZipProgress');
  });

  it('syncs the landed project everywhere through ONE bridge', () => {
    // Same endpoint a build's own writes use → replace (not merge) → preview rebuilt in App.
    expect(studio).toContain("'/api/agentv3/workspace-files'");
    expect(studio).toContain('onReplaceProjectFiles?.(data.files)');
    const app = read('src/App.tsx');
    const i = app.indexOf('const replaceProjectFiles');
    const fn = app.slice(i, i + 1400);
    expect(fn).toContain('noteRemote(clean)');   // already durable — do not upload it straight back
    expect(fn).toContain('setFiles(clean)');     // REPLACE, matching the consent given
    expect(fn).toContain('updatePreview(clean)');
  });

  it('does not report a failed upload when only the read-back failed', () => {
    // The archive IS on the server at that point; telling the user it failed would have them upload
    // the whole thing again.
    expect(studio).toContain('reload to see your project');
  });

  it('lets the same file be chosen again after an attempt', () => {
    // Without clearing the input, re-picking the SAME archive fires no change event and the button
    // looks broken.
    expect(studio).toContain('zipInputRef.current.value = \'\'');
  });
});
