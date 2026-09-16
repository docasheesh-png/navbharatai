import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 🔴 ROOT CAUSE this locks (admin 2026-09-16, "button par click kiya jaye wahi verification start ho
 * aur referral system me use ho"): the referral screen told a blocked step "Verify your email address
 * first" / "Connect your GitHub account first" as PLAIN TEXT, and its own `onVerifyPhone` prop was
 * declared in the component's interface and never called by anything — three "buttons" that only ever
 * rendered as words, on both the Profile page (which had no email/GitHub verification at all) and the
 * referral screen (which knew exactly what was missing and offered no way to fix it in place).
 *
 * Source-scan, matching this repo's own convention for locking a UI wiring class (e.g.
 * ideNoDeadControls.test.ts) rather than a DOM render — this project's vitest environment is 'node',
 * so a real render would need jsdom infra this repo does not otherwise carry.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('Profile page: three real verification actions, not three labels', () => {
  const profile = read('src/components/profile/ProfilePage.tsx');

  it('imports the real actions rather than inventing its own copy', () => {
    expect(profile).toContain("import { sendVerificationEmail, linkGithubAccount, isGithubLinked, describeLinkGithubError } from '../../lib/accountVerificationActions'");
  });

  it('the email button calls the real send-verification action, not a no-op', () => {
    expect(profile).toContain('await sendVerificationEmail(user)');
    expect(profile).toContain('onClick={emailSent ? refreshEmailStatus : handleVerifyEmail}');
  });

  it('the GitHub button calls the real link action, not a no-op', () => {
    expect(profile).toContain('await linkGithubAccount(firebaseAuth)');
    expect(profile).toContain('onClick={handleConnectGithub}');
  });

  it('the phone button still opens the one real VerifyPhoneSheet already wired on this page', () => {
    expect(profile).toContain('onClick={() => setVerifyOpen(true)}');
    expect(profile).toContain('<VerifyPhoneSheet');
  });

  it('a step already done shows as done, derived from the real Firebase facts', () => {
    expect(profile).toContain('emailVerified ? (');
    expect(profile).toContain('githubLinked ? (');
    expect(profile).toMatch(/user\.phoneNumber\s*\?\s*\(/);
  });
});

describe('Referral screen: a blocked step offers a real button, not just an explanation', () => {
  const panel = read('src/components/panels/ReferralPanel.tsx');

  it('the dead onVerifyPhone prop is gone — a declared, never-called prop is the exact bug this fixes', () => {
    expect(panel).not.toMatch(/onVerifyPhone\?:\s*\(\)\s*=>\s*void/);
  });

  it('mounts its own VerifyPhoneSheet rather than relying on a prop nobody ever passed', () => {
    expect(panel).toContain('<VerifyPhoneSheet');
    expect(panel).toContain('setPhoneSheetOpen(true)');
  });

  it('a blocked email/github/mobile row renders a REAL action button alongside the explanation', () => {
    // The exact defect: `blocked ? <span>{blocked}</span> : <button>Claim</button>` had NO button on
    // the blocked branch at all. It must now render one.
    expect(panel).toContain("row.step === 'email' ? (emailSent ? { label: 'Refresh'");
    expect(panel).toContain("row.step === 'mobile' ? { label: 'Verify', onClick: () => setPhoneSheetOpen(true) }");
    expect(panel).toContain("row.step === 'github' ? { label: 'Connect', onClick: () => void connectGithub() }");
    expect(panel).toContain('{action && (');
  });

  it('email and GitHub actions call the SAME shared module the Profile page uses — no drifted copy', () => {
    expect(panel).toContain("import { sendVerificationEmail, linkGithubAccount, describeLinkGithubError } from '../../lib/accountVerificationActions'");
    expect(panel).toContain('await sendVerificationEmail(user)');
    expect(panel).toContain('await linkGithubAccount(firebaseAuth)');
  });

  it('completing email or GitHub verification refreshes the real server-derived progress', () => {
    // emailVerified/phoneVerified/githubLinked are the SERVER's answer (useReferralProgress); the fix
    // must re-fetch it, never invent a client-side "done" state.
    expect(panel).toContain('props.onRefresh()');
  });
});
