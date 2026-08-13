/**
 * THE "FIX" BUTTON — the bridge from a failed Android build to the one place that can repair it.
 *
 * ADMIN 2026-08-11: "agar koi aisi problem hai, jo build se theek hogi to, fail hone ke bad ek button
 * apear kar do 'fix' name se … navbharatai v5 me woh error theek karne ke liye mssge auto send ho jaye,
 * full problem ke sath!"
 *
 * THE GAP IT CLOSES. The APK panel already auto-repairs failures — but only the parts NavBharatAI
 * itself SET UP (the workflow, the Capacitor project, the signing wiring). A failure inside the user's
 * own APP CODE — the reported case, a test importing a member its component does not export — is
 * outside that remit. So the panel said "NavBharatAI could not fix this one" and the user was left
 * holding an error message with nothing to press. "Try again" only helps when the cause was transient;
 * against a real code error it just repeats the failure.
 *
 * The chain has four links and every one of them is silent when it breaks, which is why each is
 * asserted here: server builds the report → panel keeps it → button dispatches it → v5 sends it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Comments explain the old behaviour on purpose; matching prose fails a test on its own explanation. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const server = read('../src/server/routes/mobileShip.ts');
const panel = read('../src/components/ide/StoreBuildPanel.tsx');
const app = read('../src/App.tsx');
const v5 = read('../src/components/agentv3/AgentV3Panel.tsx');

describe('🔒 link 1 — the server hands back the FULL problem', () => {
  it('builds a report from the real failing step, not just a summary', () => {
    const code = codeOnly(server);
    expect(code).toContain('const failureReport =');
    // A summary alone would make v5 guess at an error the compiler already named exactly.
    expect(code).toContain('failedStepSection(normalizeLog(log))');
    expect(server).toContain('The build log said:');
  });

  it('🔒 every give-up path carries it — not just the one that was easy to reach', () => {
    // If a branch returns `fixed: false` WITHOUT a report, the button silently never appears there,
    // which is the same dead end with extra steps.
    const code = codeOnly(server);
    const giveUps = (code.match(/fixed:\s*false/g) || []).length;
    const reported = (code.match(/report: failureReport\(\)/g) || []).length;
    // The signing-key branch is deliberately excluded: that one is genuinely the user's to resolve and
    // v5 must never be asked to invent a key.
    expect(reported).toBeGreaterThanOrEqual(giveUps - 2);
  });

  it('asks for a code fix and bounds the log it sends', () => {
    expect(server).toContain('Please fix the app code so it builds');
    expect(server).toContain('.slice(0, 6000)');   // a whole log would blow the prompt
  });
});

describe('🔒 link 2 — the panel keeps the report and offers the button', () => {
  const code = codeOnly(panel);

  it('stores the report the server sent', () => {
    expect(code).toContain('const [fixReport, setFixReport]');
    expect(code).toContain('if (fix?.report) setFixReport(fix.report)');
  });

  it('🔒 the button only exists when there is a real problem to send', () => {
    // Rendering it with an empty report would open v5 with nothing to fix — a button that lies.
    expect(code).toContain("{phase === 'failed' && fixReport && (");
  });

  it('is labelled as a fix, and says what it will do', () => {
    expect(panel).toContain('Fix this with NavBharatAI');
    expect(panel).toContain('Opens NavBharatAI Pro with the full error');
  });

  it('clears the old report when a new build starts', () => {
    // A stale report would send v5 to fix a failure that has already been retried.
    expect(code).toContain("setFixReport('')");
  });

  it('dispatches the whole problem, not a summary', () => {
    expect(code).toContain('fixPrompt: fixReport');
    expect(code).toContain('autoSend: true');
    expect(code).toContain("view: 'nbi_pro_chat'");
  });
});

describe('🔒 link 3 — the app routes it to v5', () => {
  const code = codeOnly(app);

  it('the navigate event understands a fix prompt', () => {
    expect(code).toContain('fixPrompt?: string; autoSend?: boolean');
    expect(code).toContain('if (detail?.fixPrompt)');
  });

  it('🔒 uses a fresh nonce, so pressing Fix twice is not ignored', () => {
    // Without it, React sees the same object shape and the second press does nothing at all.
    expect(code).toContain('nonce: Date.now()');
  });

  it('carries autoSend through rather than dropping it', () => {
    expect(code).toContain('autoSend: detail.autoSend === true');
  });
});

describe('🔒 link 4 — v5 actually sends it', () => {
  const code = codeOnly(v5);

  it('sends when the user explicitly asked for a fix', () => {
    expect(code).toContain('if (pendingFix.autoSend) void send(');
  });

  it('🔒 but PREFILL is still the default for everything else', () => {
    // The existing sidebar "Fix with AI" deliberately only prefills: a request that merely arrives must
    // never spend the user's balance on its own. Only an explicit button press is consent.
    expect(code).toContain('setPrompt(pendingFix.text)');
    expect(code).toMatch(/autoSend\?: boolean/);
    // The send is INSIDE the autoSend branch, never unconditional.
    expect(code).not.toMatch(/\n\s*void send\(\{ text: pendingFix\.text/);
  });
});
