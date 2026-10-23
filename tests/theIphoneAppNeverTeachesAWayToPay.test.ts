// THE iPHONE APP NEVER TEACHES A WAY TO PAY (admin 2026-10-11, Q-123: "stop it now" — the chat reads
// X-NBAI-Platform and, on iOS, never teaches the website top-up).
//
// The iPhone app's screens sell nothing (App Store Guideline 3.1.1), but every AI answers "how do I
// recharge?" from the knowledge base, which describes the web wallet's top-up. THE CLASS: a rule enforced on
// the screens and not on the words the app's AIs speak. The context every AI is handed now passes a
// deterministic filter on iOS, and every chat client names its platform.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clientPlatform, withoutPurchaseTeaching, PURCHASE_TEACHING, IOS_NO_PURCHASE_NOTE } from '../src/server/AppContext/iosPurchaseGuard';
import { AppContextInjector } from '../src/server/AppContext/AppContextInjector';

describe('the platform the client names', () => {
  it('reads the header; anything else is the web', () => {
    expect(clientPlatform('ios')).toBe('ios');
    expect(clientPlatform('iOS ')).toBe('ios');
    expect(clientPlatform(['android'])).toBe('android');
    expect(clientPlatform(undefined)).toBe('web');
    expect(clientPlatform('watchos')).toBe('web');
  });
});

describe('🔒 on the iPhone app the knowledge base cannot teach buying', () => {
  const ask = 'how do I recharge my wallet and buy more tokens?';

  it('the real knowledge base DOES teach it on the web — so the filter is doing the work', () => {
    const web = AppContextInjector.getRelevantContext(ask, 'nbi_chat', 'web');
    expect(web).toMatch(PURCHASE_TEACHING);
    expect(web).not.toContain(IOS_NO_PURCHASE_NOTE);
  });

  it('on iOS no sentence of it survives, and the model is told plainly', () => {
    const ios = AppContextInjector.getRelevantContext(ask, 'nbi_chat', 'ios');
    expect(ios).toContain(IOS_NO_PURCHASE_NOTE);
    expect(ios.replace(IOS_NO_PURCHASE_NOTE, '')).not.toMatch(PURCHASE_TEACHING);
    // the same for every surface that asks
    for (const surface of ['pro_chat', 'sda_chat', 'professional']) {
      const out = AppContextInjector.getRelevantContext(ask, surface, 'ios');
      expect(out.replace(IOS_NO_PURCHASE_NOTE, ''), surface).not.toMatch(PURCHASE_TEACHING);
    }
  });

  it('a balance or a statement is not buying, and stays', () => {
    expect(withoutPurchaseTeaching('Your balance is in Wallet & Billing. Tap Recharge to top up with UPI.'))
      .toBe('Your balance is in Wallet & Billing.');
  });
});

describe('🔒 every caller passes the platform, and every chat client sends it', () => {
  const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...tsFiles(p));
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
    }
    return out;
  }

  it('no answering call to the knowledge base leaves the platform out', () => {
    const missing: string[] = [];
    for (const f of tsFiles('src/server')) {
      if (f.replace(/\\/g, '/').endsWith('routes/warm.ts')) continue; // a cache warm-up, never an answer
      for (const m of code(f).matchAll(/AppContextInjector\.getRelevantContext\(([^;]*?)\)\s*;/g)) {
        if (m[1].split(',').length < 3) missing.push(`${f}: getRelevantContext(${m[1]})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the four chat clients send X-NBAI-Platform', () => {
    expect(code('src/hooks/useChatEngine.ts')).toContain('...platformHeader() };');
    expect(code('src/components/professionals/ProfessionalChat.tsx')).toContain("{ 'Content-Type': 'application/json', ...platformHeader(), 'x-nb-answer-request': newFreeAnswerRequestId() }");
    expect(code('src/components/professionals/ExamMode.tsx')).toContain('...platformHeader() }');
    expect(code('src/components/sda/SDAChat.tsx')).toContain('headers: { ...(await authJsonHeaders()), ...platformHeader() },');
  });
});
