// REAL-MONEY BETTING IS NOT BUILT; PRETEND-CHIP GAMES ARE (admin 2026-11-20: "other app builder jo karte hai, same karo").
// Bolt and Builder.io forbid UNLAWFUL gambling, Replit lists gambling among illegal uses; India's Promotion and Regulation
// of Online Gaming Act, 2025 makes every real-money online game unlawful. So the request is refused before a token is
// spent, the published page is blocked, and a Teen Patti / poker / Ludo game with pretend chips is still built.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { triagePrompt, blockMessage } from '../src/server/lib/promptSafety';
import { classifyPublishedText } from '../src/server/AgentV3/illegalContentRules';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';

const REFUSED = [
  'Teen Patti real money app banao jisme UPI deposit aur withdraw ho',
  'build a cricket betting app where users deposit money, place bets and withdraw winnings',
  'Make a fantasy cricket game with a wallet and real-money prizes',
  'satta matka app banao jisme paise lagao aur jeeto',
  'online casino website with deposit bonus and instant cash out',
  'rummy app with cash prizes and wallet top-up',
  'सट्टा ऐप बनाओ जिसमें असली पैसे लगें',
  'poker app where players win real money',
  // Other scripts read the same rule (the ban census requires every script).
  'பணம் டெபாசிட் செய்து விளையாடும் பெட்டிங் ஆப் உருவாக்கு',
  'আসল টাকা দিয়ে জুয়া খেলার অ্যাপ বানাও',
  // ಚಟುವಟಿಕೆ ("activity") starts with ಚಟ ("addiction"): it must not let a real-money betting app through as an addiction app.
  'ಬೆಟ್ಟಿಂಗ್ ಆಪ್ ಮಾಡಿ, ದೈನಂದಿನ ಚಟುವಟಿಕೆ ಮತ್ತು ಡೆಪಾಸಿಟ್ ಜೊತೆ',
];

const BUILT = [
  'Teen Patti game banao with virtual chips, no real money',
  'a poker game for fun with pretend chips and a leaderboard',
  'ek ludo game banao 4 players',
  'casino style slot machine game with fake coins, never real money',
  'a lottery result checker app',
  'gambling addiction recovery app that shows how much real money you lost and a helpline',
  'stock trading app with deposit and withdraw',
  'cricket score app with live scores',
  'ek business board game banao jisme property kharid sake',
];

describe('real-money betting is refused at the request', () => {
  it.each(REFUSED)('"%s" is refused', (prompt) => {
    const t = triagePrompt(prompt);
    expect(t.verdict).toBe('block');
    expect(t.ruleId).toBe('REAL_MONEY_GAMBLING');
  });
  it.each(BUILT)('"%s" is built', (prompt) => {
    const t = triagePrompt(prompt);
    expect(t.ruleId === 'REAL_MONEY_GAMBLING' && t.verdict === 'block', JSON.stringify(t)).toBe(false);
  });
});

describe('the refusal says why and offers the game with pretend chips', () => {
  it('English and Hindi', () => {
    const en = blockMessage('illegal', REFUSED[1], 'REAL_MONEY_GAMBLING');
    expect(en).toMatch(/Online Gaming Act, 2025/);
    expect(en).toMatch(/pretend chips/);
    const hi = blockMessage('illegal', REFUSED[6], 'REAL_MONEY_GAMBLING');
    expect(hi).toMatch(/2025/);
    expect(hi).toMatch(/नकली चिप्स/);
    // Other rules keep their own message.
    expect(blockMessage('illegal', 'x', 'WEAPON_MANUFACTURE')).toMatch(/Acceptable Use/);
  });

  it('every caller passes the rule that fired, so no surface shows the bare refusal for this', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p); } };
    walk(join(__dirname, '../src'));
    const calls = files.flatMap((f) => (readFileSync(f, 'utf8').match(/blockMessage\(.*$/gm) ?? []).map((c) => [f, c] as const))
      .filter(([, c]) => !c.startsWith('blockMessage(contentClass'));
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const [f, c] of calls) expect(c, f).toMatch(/,\s*triage\.ruleId\)/);
  });
});

describe('the published page', () => {
  it('a real-money betting page is blocked', () => {
    const r = classifyPublishedText('Play Teen Patti now! Deposit ₹100 via UPI and withdraw your winnings instantly.');
    expect(r.findings.map((f) => f.id)).toContain('REAL_MONEY_GAMBLING');
    expect(r.contentClass).toBe('illegal');
  });

  it('a pretend-chips game built with our own kit is not blocked by the kit\'s own disclaimer', () => {
    const kit = Object.values(generateBoardGames().files).join('\n');
    expect(kit).toMatch(/teen patti/i);
    expect(kit).toMatch(/real-money play is not/i);
    expect(classifyPublishedText(kit).findings.map((f) => f.id)).not.toContain('REAL_MONEY_GAMBLING');
    expect(classifyPublishedText('Teen Patti — play with 10,000 free chips. No real money, no deposits, no cash prizes.').findings).toEqual([]);
  });
});
