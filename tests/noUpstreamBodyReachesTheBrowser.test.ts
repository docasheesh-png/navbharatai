// Q-887 — AN UPSTREAM PROVIDER'S RESPONSE BODY MUST NEVER REACH THE BROWSER.
//
// 🔴 THE DEFECT. `payment.ts`'s create-order catch answered the client by hand:
//
//     return res.status(500).json({
//       error: `Cashfree integration error: ${errorMessage}`,
//       details: detailedError          // ← the provider's own response body, whole
//     });
//
// Verified live before it was touched (Q-1126 batch 1 census): still present at `payment.ts:350`.
//
// 🧬 THE CLASS IS NOT "ONE FILE FORGOT" — IT IS THAT THE DOOR WAS OPTIONAL. `lib/httpError.ts`
// already existed for exactly this, from the 2026-07-19 sweep, and its own header names the harm:
// *"a raw error can leak internal file paths, stack fragments, upstream host names, or — worst for us
// — a third-party PROVIDER/vendor name … which also breaks the white-label law."*
//
// ⚠️ AND THE SAME FILE CALLS `sendSafeError` AT FOUR OTHER SITES. The fifth survived because the sweep
// was shaped around one expression — `res.status(500).json({ error: err.message })` — while this site
// had already assembled its own variable from `error.response?.data`. So the hunt's SHAPE, not its
// thoroughness, is what let it through. A door four of five callers use is not a door: nothing failed
// when the fifth walked past it. This census is that missing failure.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toSafeClientMessage, sendSafeError } from '../src/server/lib/httpError';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const ROOT = process.cwd();

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); continue; }
      if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(relative(ROOT, p).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src/server'));
  return out;
}

/**
 * The GENERATED-APP templates are not NavBharatAI answering its own user — they are the code of the
 * app a user built, talking to the user's OWN provider with the user's own keys. Naming Cashfree or
 * Stripe there is correct and useful; redacting it would make their app's errors unreadable to them.
 * Listed with that reason rather than quietly skipped.
 */
const GENERATED_APP_TEMPLATES = /\/(?:[A-Z][A-Za-z]*Generator)\.ts$/;

describe('no upstream body, and no provider name, reaches the browser', () => {
  it('the create-order catch goes through the door, and answers in words written for a person', () => {
    // ⚠️ COMMENTS STRIPPED. My first version of this assertion failed on its OWN evidence: the comment
    // the fix left behind QUOTES the old `details: detailedError` so the next reader can see what was
    // wrong. This is the second time in a day I have written a source check that reads its own
    // documentation as shipped code (the Q-1037 census did it too) — so it is noted here, not just fixed.
    const src = stripCodeComments(readFileSync(join(ROOT, 'src/server/routes/payment.ts'), 'utf8'));
    expect(src, 'the provider body must not be handed to the client').not.toContain('details: detailedError');
    expect(src, 'and the provider must not be named in what the client reads')
      .not.toContain('Cashfree integration error');
    expect(src).toContain("'payment create-order'");
    expect(src, 'the user is told the money is safe, which is the fact they need most')
      .toContain('Nothing has been charged');
  });

  it('🔴 CENSUS — no upstream BODY reaches a client response, anywhere in the server', () => {
    // 🔑 THE LINE THIS DRAWS, AND WHY IT IS HERE AND NOT WIDER. Measured across the server, two shapes
    // exist and only ONE is the defect:
    //
    //   ❌ the whole provider BODY in a client response — `details: detailedError` where
    //      `detailedError = error.response?.data`. An object nobody here wrote, of unknown contents:
    //      upstream host names, internal fields, a vendor name. That was `payment.ts`, and only it.
    //   ✅ the provider's `.message` STRING, forwarded as the error text for a service the USER
    //      connected themselves. `mobileShip.ts:737` is the considered form — a curated `hint` per
    //      status for the person, with the upstream message as a secondary `detail` — and `github.ts`
    //      / `cloudsync.ts` forward it as the error itself. Replacing "Repository already exists" with
    //      a generic sentence would make those features worse, not safer. Banning it would have been
    //      fixing one problem by creating another; the quality gap in the two weaker sites is a row
    //      (they have no curated hint), not a silent rewrite here.
    //
    // ⚠️ AND THE SCAN IS PAREN-MATCHED, not a window and not a character class. `[^}]*` was closed
    // early by the `}` of a `${…}` template span, so the reversion did not fail the census; a 400-char
    // window then produced FALSE positives by reaching a neighbouring `console.error` — detail in the
    // SERVER LOG is exactly where it belongs. Only the argument of the `.json(` call is read.
    const argOf = (src: string, at: number): string => {
      let depth = 0;
      for (let k = at; k < src.length && k < at + 2000; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') { depth--; if (depth === 0) return src.slice(at, k + 1); }
      }
      return src.slice(at, at + 2000);
    };
    const offenders: string[] = [];
    for (const file of serverFiles()) {
      if (GENERATED_APP_TEMPLATES.test('/' + file)) continue;
      const src = stripCodeComments(readFileSync(join(ROOT, file), 'utf8'));
      const bodyVars = [...src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*(?:\s*as\s*[^=]+)?\??\.response\??\.data\s*(?:\|\||;|$)/gm)]
        .map((m) => m[1]);
      for (const m of src.matchAll(/\.json\(/g)) {
        const arg = argOf(src, (m.index ?? 0) + '.json'.length);
        // The OBJECT form: `.response.data` not narrowed to a single field.
        if (/\.response\??\.data\s*(?:\|\||\}|,|\))/.test(arg)) {
          offenders.push(`${file}: the whole upstream body in a client response`);
        }
        for (const name of bodyVars) {
          if (new RegExp(`\\b${name}\\b`).test(arg)) offenders.push(`${file}: \`${name}\` (the whole upstream body) in a client response`);
        }
      }
    }
    expect(offenders, 'route it through sendSafeError — it logs the detail and redacts what the client sees').toEqual([]);
  });

  it('⚠️ and NOT every hand-rolled error response is a defect — recorded so this census is not widened', () => {
    // My FIRST version of the census above failed 35 files, on the rule "a file that imports the door
    // may not also answer the client by hand". That rule is wrong, and `httpError.ts` says so in its own
    // header: it *"deliberately does NOT touch routes whose `err.message` is an intentionally-curated,
    // user-facing message"*. `payment.ts` is full of those — "Payments are temporarily unavailable.
    // Please try again shortly." is a sentence written for a person and needs no redactor. Banning them
    // would have been a 35-file churn in service of a rule nobody holds.
    const src = readFileSync(join(ROOT, 'src/server/lib/httpError.ts'), 'utf8');
    expect(src).toContain('intentionally-curated');
    const payment = readFileSync(join(ROOT, 'src/server/routes/payment.ts'), 'utf8');
    expect(payment, 'a curated, user-facing 5xx message is fine and stays')
      .toContain('Payments are temporarily unavailable.');
  });

  it('the door itself still strips what it promises to strip', () => {
    // Guarding the fix means guarding what it relies on. If the redactor stopped working, routing
    // through it would be a false sense of safety — so the promise is asserted here too.
    expect(toSafeClientMessage('Cashfree said https://api.example.com/x failed'))
      .not.toContain('https://api.example.com');
    expect(toSafeClientMessage('anthropic rate limit')).not.toMatch(/anthropic/i);
    expect(toSafeClientMessage('api_key sk-abcdef123456 is bad')).not.toContain('sk-abcdef123456');
    expect(toSafeClientMessage('')).toBe('Something went wrong. Please try again.');
    expect(typeof sendSafeError).toBe('function');
  });
});
