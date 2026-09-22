/**
 * "BANAO!! DONO! EK EK KAR KE" — admin, 2026-09-22. This is the SECOND of the two.
 *
 * 🔴 THE REFUSAL WAS A RED ERROR BESIDE A BUTTON THAT COULD NOT WORK. The server has sent an
 * honest empty-balance sentence and a machine-readable `wallet_empty` code since earlier that day
 * (`walletEmptyNotice.ts`), and the image studio was wired to it. Four screens were not: Doctor AI,
 * the App Debugger, the Design System palette and the App Scanner all folded the 402 into their
 * generic failure path — so a PRICE was drawn as a fault, and the single control on offer was
 * **Try again**, which the same gate refuses every time. A user with an empty wallet could press
 * it for ever and never be shown the one thing that resolves it.
 *
 * ⚠️ MOST OF THIS IS SOURCE-LEVEL, AND IT HAS TO BE. `tsc` and `vitest` cannot see that a wallet
 * check sits AFTER the throw that swallows it, that a retry banner and a price banner can be drawn
 * together, or that five screens hand-wrote five copies of one card. Every one of those is exactly
 * how this class ships.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isWalletEmptyRefusal, walletEmptyMessage, walletEmptyRefusalMessage,
} from '../src/lib/walletEmptyRefusal';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Comments stripped. These files DOCUMENT the bug they close — the card's own note says why it
 * offers no "Try again", and Doctor AI's quotes the `.includes('balance')` check as the thing not
 * to write. A prose scan that reads comments therefore fails on the explanation instead of on the
 * code, which is how a guard gets weakened until it says nothing.
 */
const code = (p: string) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\`])\/\/[^\n]*/g, '$1');

/** Every screen that can meet the refusal, and the state it keeps the message in. */
const SCREENS = [
  { file: 'src/components/ide/AIImageGenerator.tsx', state: 'balanceBlock' },
  { file: 'src/components/ide/AIDebugger.tsx', state: 'balanceBlock' },
  { file: 'src/components/ide/AppScanPanel.tsx', state: 'balanceBlock' },
  { file: 'src/components/ide/DesignSystem.tsx', state: 'paletteNoCredit' },
  { file: 'src/components/sda/SDAChat.tsx', state: 'needsCredit' },
];

/** The refusal body a real server sends, per `walletEmptyBody`. */
const REFUSAL = { error: 'You have spent ₹6.03 more than your balance. Add more than ₹6.03 of credit to carry on.', code: 'wallet_empty' };

describe('one call decides it, and it cannot be done by halves', () => {
  it('a real refusal yields the SERVER\'s own sentence, never our fallback', () => {
    expect(walletEmptyRefusalMessage(402, REFUSAL)).toBe(REFUSAL.error);
  });

  it('a 402 WITHOUT the code is somebody else\'s offer — hosting, a domain — and is not ours', () => {
    expect(walletEmptyRefusalMessage(402, { error: 'This needs a hosting plan.' })).toBeNull();
    expect(isWalletEmptyRefusal(402, { error: 'This needs a hosting plan.' })).toBe(false);
  });

  it('the code WITHOUT a 402 is not the refusal either — both halves, always', () => {
    expect(walletEmptyRefusalMessage(500, REFUSAL)).toBeNull();
    expect(walletEmptyRefusalMessage(200, REFUSAL)).toBeNull();
    expect(walletEmptyRefusalMessage(429, REFUSAL)).toBeNull();
  });

  it('a body that is not an object at all — a failed json(), an HTML proxy page — is null, never a throw', () => {
    for (const junk of [null, undefined, '', 'Bad Gateway', 0, [], NaN]) {
      expect(walletEmptyRefusalMessage(402, junk)).toBeNull();
    }
  });

  it('a refusal whose sentence went missing still gets a sentence, and it states NO number', () => {
    const msg = walletEmptyRefusalMessage(402, { code: 'wallet_empty' });
    expect(msg).toBeTruthy();
    expect(msg).toBe(walletEmptyMessage({ code: 'wallet_empty' }));
    expect(msg).not.toMatch(/₹\s*\d/);
  });

  it('a blank server sentence falls back rather than showing the user an empty card', () => {
    expect(walletEmptyRefusalMessage(402, { error: '   ', code: 'wallet_empty' }))
      .toBe(walletEmptyMessage({}));
  });
});

describe('the comment-stripper itself, so no guard above is vacuously true', () => {
  it('strips the prose and keeps the code', () => {
    const body = code('src/components/common/AddCreditNotice.tsx');
    expect(body).toContain('onClick={openAddCredit}');       // code survives
    expect(body).not.toContain('YOUR BALANCE IS EMPTY');      // the block comment is gone
    expect(body).not.toContain('drifted-copy');               // a line comment is gone
    expect(code('src/components/sda/SDAChat.tsx')).toContain('needsCredit: !!noCredit');
  });
});

describe('THE CARD IS ONE COMPONENT — five hand-written copies is the drifted-copy class', () => {
  const card = src('src/components/common/AddCreditNotice.tsx');

  it('the button lives in exactly one file', () => {
    expect(card).toContain('onClick={openAddCredit}');
    const authors = SCREENS.filter(s => src(s.file).includes('onClick={openAddCredit}'));
    // Doctor AI draws the button inside its own chat bubble (a card would break the bubble), so it
    // is the ONE permitted second caller — and it still calls the shared `openAddCredit`, never a
    // hand-rolled navigation.
    expect(authors.map(a => a.file)).toEqual(['src/components/sda/SDAChat.tsx']);
  });

  it('no screen hand-writes the navigation — `openAddCredit` is the one channel', () => {
    for (const s of SCREENS) {
      const body = src(s.file);
      if (!body.includes('openAddCredit')) continue;
      expect(body, `${s.file} dispatches its own navigate event`).not.toContain("'navbharat:navigate'");
    }
  });

  it('the card offers NO retry — the next press meets the same gate', () => {
    const body = code('src/components/common/AddCreditNotice.tsx');
    expect(body).not.toMatch(/Try again/i);
    expect(body).not.toMatch(/Retry/i);
  });

  it('the card names no vendor — the White-Label Law reaches the bill too', () => {
    for (const vendor of ['GLM', 'Z.ai', 'Kimi', 'Moonshot', 'Claude', 'Anthropic', 'Gemini', 'Vertex', 'Grok', 'xAI', 'OpenAI']) {
      expect(card).not.toContain(vendor);
    }
  });
});

describe('THE REFUSAL IS READ BEFORE THE THROW THAT WOULD SWALLOW IT', () => {
  // The whole defect, in one property: every one of these files parses the body and then throws or
  // sets a generic error. Reading the wallet AFTER that point is unreachable code that compiles.
  const ORDERED = [
    { file: 'src/components/ide/AIDebugger.tsx', swallow: 'The analysis service could not be reached' },
    { file: 'src/components/ide/AppScanPanel.tsx', swallow: 'The scan could not be started' },
    { file: 'src/components/ide/DesignSystem.tsx', swallow: 'Could not create a palette just now' },
  ];

  for (const { file, swallow } of ORDERED) {
    it(`${file.split('/').pop()} checks the wallet first`, () => {
      const body = src(file);
      const check = body.indexOf('walletEmptyRefusalMessage(');
      const generic = body.indexOf(swallow);
      expect(check, `${file} never checks the wallet`).toBeGreaterThan(-1);
      expect(generic, `${file} lost its generic message`).toBeGreaterThan(-1);
      expect(check, `${file} checks the wallet after the generic path`).toBeLessThan(generic);
    });
  }

  it('the App Scanner checks it inside `streamRun`, where the STATUS still exists', () => {
    const body = src('src/components/ide/AppScanPanel.tsx');
    // The catch below sets `runError` from an Error message — by then there is no status to judge
    // by, so a check there could only ever match on prose.
    const stream = body.slice(body.indexOf('const streamRun'), body.indexOf('const handleScan'));
    expect(stream).toContain('walletEmptyRefusalMessage(res.status');
  });

  it('Doctor AI reads the code, never the sentence', () => {
    const body = src('src/components/sda/SDAChat.tsx');
    expect(body).toContain('walletEmptyRefusalMessage(res.status, errData)');
  });
});

describe('a price and a retry are never drawn together', () => {
  // 🔴 THE GUARD IS THE BANNER'S OWN CONDITION, NOT THE FILE'S CONTENTS. The first version of this
  // test asked only whether `!balanceBlock` appeared ANYWHERE in the file — and every one of these
  // files says it in two or three other places, so deleting it from the failure banner (the exact
  // regression) left the test green. Found by reversion, not by reasoning.
  const GUARDED = [
    { file: 'src/components/ide/AIImageGenerator.tsx', banner: '{!isLoading && imageError && !balanceBlock && (' },
    { file: 'src/components/ide/AIDebugger.tsx', banner: '{!isLoading && analyzeError && !balanceBlock && (' },
    { file: 'src/components/ide/AppScanPanel.tsx', banner: '{runError && !balanceBlock && (' },
    { file: 'src/components/ide/DesignSystem.tsx', banner: '{paletteMsg && !paletteNoCredit && (' },
  ];

  for (const { file, banner } of GUARDED) {
    it(`${file.split('/').pop()} hides its failure banner while the wallet card is up`, () => {
      expect(src(file), `${file} can show a retry beside a price`).toContain(banner);
    });
  }

  it('every screen clears the card before it tries again, so a stale price cannot outlive a top-up', () => {
    for (const s of SCREENS) {
      if (s.state === 'needsCredit') continue; // a chat message is per-turn; there is nothing to clear
      const setter = `set${s.state[0].toUpperCase()}${s.state.slice(1)}('')`;
      expect(src(s.file), `${s.file} never resets ${s.state}`).toContain(setter);
    }
  });
});

describe('THE CODE IS THE SWITCH — never the prose', () => {
  it('no screen matches on the words of a sentence that will be reworded', () => {
    for (const s of SCREENS) {
      const body = code(s.file);
      expect(body, `${s.file} matches on prose`).not.toMatch(/includes\(\s*['"][^'"]*balance/i);
      expect(body, `${s.file} matches on prose`).not.toMatch(/includes\(\s*['"][^'"]*credit/i);
    }
  });
});

describe('Doctor AI: the offer lives in THIS session and is never restored as a live one', () => {
  const body = src('src/components/sda/SDAChat.tsx');

  it('the autosave maps its fields by name and `needsCredit` is not among them', () => {
    const save = body.slice(body.indexOf('messages: messages.slice(-150).map('));
    const block = save.slice(0, save.indexOf('files: {}'));
    expect(block).toContain('isRedFlag: m.isRedFlag');
    // If this ever becomes a spread, a refusal from last week comes back as a live Add-credit
    // offer after the doctor has already topped up.
    expect(block, 'the autosave now persists needsCredit').not.toContain('needsCredit');
    expect(block, 'the autosave was tidied into a spread').not.toMatch(/\.\.\.\s*m\b/);
  });

  it('a refusal bubble carries the flag and drops the ⚠️ — a price is not a warning', () => {
    expect(body).toContain('needsCredit: !!noCredit');
    expect(body).toContain('text: noCredit ? honest : `⚠️ ${honest}`');
  });
});
