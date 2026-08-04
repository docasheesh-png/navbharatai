import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// ROADMAP #1 Phase 0.1 — the "coming soon" audit (absolute rule 2: real features only).
//
// AUDIT RESULT (2026-08-04, every site read, not grepped-and-guessed):
//   ✅ HONEST, kept as-is — these are the CORRECT pattern for a not-built feature:
//      • GitPanel.tsx      — non-GitHub cloud sync: names the gap, refuses to fake a connection,
//                            and points at the working alternative (GitHub / ZIP). The model to copy.
//      • DebugPanel.tsx    — run controls are `disabled` with per-button titles + a visible label;
//                            the source even says "No fake stepping".
//      • ProfessionalsView — inactive cards are `disabled`, greyed, and badged "Coming Soon".
//      • HostingChooser    — states the full-stack gap AND the real alternative today.
//      • LiveCollaboration — the Pro-v5 tab is an explicit empty state, no dead controls.
//   ❌ FIXED — genuine rule-2 violations:
//      • SocialHub.tsx     — DELETED. It rendered "Feed coming soon using Firestore…", its second
//                            tab rendered NOTHING at all, and it imported Firestore APIs it never
//                            used. Worse, it was UNREACHABLE: `activeView === 'entertainment'` was
//                            never assigned anywhere, so no user could open it — a stub shipping in
//                            the bundle forever. Root cause fixed as a whole dead concept (component
//                            + lazy import + render branch + ViewType member + module flag), not
//                            just the file.
//      • TeamCollaboration — the video-call button's only explanation was a HOVER tooltip. Hover
//                            never fires on a touch device and NavBharatAI is mobile-first (the Play
//                            Store app is the main surface), so a phone user saw a dead grey button
//                            with no reason. The reason is now in the label + visible helper text.
describe('Phase 0.1 — no dead screens, no hover-only honesty', () => {
  it('the unreachable SocialHub stub is gone, root and branch', () => {
    const app = read('src/App.tsx');
    expect(app).not.toContain('SocialHub');
    // The view it hung off is gone too — otherwise the next session re-adds a screen for it.
    expect(app).not.toContain("activeView === 'entertainment'");
    expect(read('src/types/index.ts')).not.toContain("'entertainment'");
    expect(read('src/hooks/useSettings.ts')).not.toContain('entertainment');
  });

  it('an unavailable control explains itself WITHOUT hover (mobile has no hover)', () => {
    const tc = read('src/components/ide/TeamCollaboration.tsx');
    // The reason must be readable text, not a group-hover tooltip.
    expect(tc).toContain('not available yet');
    expect(tc).toContain("Video calling isn&apos;t built yet");
    // The old hover-only tooltip must not come back for this control.
    expect(tc).not.toMatch(/opacity-0 group-hover:opacity-100[\s\S]{0,200}Coming Soon/);
  });

  it('the honest-state pattern we keep is genuinely honest (guards the good examples)', () => {
    // GitPanel: refuses to fake, and names the working alternative.
    const git = read('src/components/ide/GitPanel.tsx');
    expect(git).toContain("won't fake a connection that doesn't work");
    expect(git).toContain('Use GitHub');
    // DebugPanel: controls are disabled, never fake-stepping.
    const dbg = read('src/components/ide/DebugPanel.tsx');
    expect(dbg).toContain('No fake stepping');
    expect(dbg).toMatch(/<button[^>]*\bdisabled\b/);
  });
});
