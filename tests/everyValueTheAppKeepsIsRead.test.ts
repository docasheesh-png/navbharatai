// EVERY VALUE THE APP KEEPS IS READ (2026-10-11, Q-600 batch five — the backlog reaches zero).
//
// `tsc --noUnusedLocals` listed 93 client locals on 2026-10-04 that nothing read — state set and never
// shown, handlers never wired. Five batches took it to zero; this one emptied App.tsx (46). Each local was
// decided, not deleted blind: a forgotten wire-up was SHOWN, dead code was REMOVED. What this file pins:
//   • the ratchet is empty and the compiler flag is on, so a new one fails `npm run typecheck`;
//   • the wire-ups really show (the checkout button's progress);
//   • the dead code that LIED stays gone (a fake "dry-run" that reported exit code 0, two full-screen
//     overlays nothing could open, a setting with no screen).
// The three defects this batch surfaced have their own files: aZipImportIsSeen (Q-792),
// nothingPollsAFakeBuildStatus (Q-793), aGithubFailureIsShown (Q-794); the deploy view is in
// deadViewBranches and the reverted landing rule's residue in noAutoReopen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the backlog is closed, and stays closed', () => {
  it('🔒 the unused-locals baseline is empty and tsconfig.json fails on a new one', () => {
    expect(JSON.parse(read('scripts/unusedLocalsBaseline.json'))).toEqual({});
    // tsconfig.json carries comments, so read the flag as text rather than JSON.parse it.
    expect(read('tsconfig.json')).toMatch(/"noUnusedLocals":\s*true/);
  });
});

describe('a forgotten wire-up is shown', () => {
  it('🔒 the top-up button says it is opening checkout while the order is being made', () => {
    // The hook kept "Requesting Cashfree checkout protocol..." in state no screen read; the button only
    // dimmed. The real state (`isRecharging`) now drives words a user understands.
    const bill = read('src/components/wallet/TokenPurchaseTab.tsx');
    expect(bill).toMatch(/\{isRecharging\s*\?[\s\S]{0,160}Opening secure checkout…/);
    const hook = code(read('src/hooks/usePaymentEngine.ts'));
    expect(hook).not.toMatch(/rechargeStatus|customPurchaseCredits/);
  });
});

describe('dead code that lied stays gone', () => {
  it('🔒 no "dry-run" runner that reports a run it never did', () => {
    const hook = code(read('src/hooks/usePreviewBundler.ts'));
    expect(hook).not.toMatch(/const runCode\b|dry-run mode|Exited with code 0/);
    expect(hook).not.toMatch(/const handleFileChange\b/);
  });

  it('no full-screen "Opening AI Workspace" overlay or its error twin — nothing could ever open them', () => {
    const modals = code(read('src/components/panels/AppModals.tsx'));
    expect(modals).not.toMatch(/isWorkspacePreparing|workspacePrepError|Opening AI Workspace|Failed to open AI Workspace/);
    expect(code(read('src/App.tsx'))).not.toMatch(/isWorkspacePreparing|workspacePrepError/);
  });

  it('no Hinglish-mode setting without a screen to set it or anything to read it', () => {
    expect(code(read('src/hooks/useSettings.ts'))).not.toMatch(/hinglishMode|navbharat_hinglish/);
  });

  it('no flag that guessed "searching the web" from words like "now" — showing it would have been a fake status', () => {
    const engine = code(read('src/hooks/useChatEngine.ts'));
    expect(engine).not.toMatch(/setIsSearching|invalidKeys|setIsDeployed/);
  });
});
