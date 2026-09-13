/**
 * The ⓘ toggle and the one-line description (admin 2026-09-13).
 *
 *   *"yeh … discription hatao, yaha simple likho 'your keys And value save as incripted, no one can see,
 *    expect you.' (mai non techie — aap isko theek se 1 ya 1.5 line me likho bas) pura bada sa hata do!"*
 *   *"ek 'i' button ho har ek credidential ke starting me, jis par click karne se ek tick ✅ toggle dikhe,
 *    'apply for my all app' … aur us credentials ke niche chota chota likha ho 'for all app'"*
 *
 * Every one of these is an ARRANGEMENT — the component compiles and renders with any of them undone,
 * which is exactly the regression that reaches a user instead of CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const panel = readFileSync(join(__dirname, '..', 'src/components/SecretManager.tsx'), 'utf8');

/** Strip comments: a doc block explaining why something was REMOVED must not satisfy an absence check. */
const codeOnly = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const code = codeOnly(panel);

describe('the description is one line, in plain words', () => {
  it('says the thing the owner actually cares about: encrypted, and only you can see it', () => {
    expect(panel).toMatch(/encrypted/);
    expect(panel).toMatch(/nobody can see them except you/i);
  });

  it('THE LECTURE IS GONE — no variable-name examples, no build-time/git explanation', () => {
    expect(code).not.toMatch(/OPENAI_API_KEY[\s\S]{0,200}DATABASE_URL/);
    expect(code).not.toMatch(/never committed to git/);
    expect(code).not.toMatch(/Use the exact variable name your app reads/);
    expect(code).not.toMatch(/injected into your app automatically at build time/);
  });
});

describe('the ⓘ button and its toggle', () => {
  it('sits at the START of a row — before the name column', () => {
    const infoAt = code.indexOf('aria-label={`Settings for ${row.secret_name}`}');
    const nameAt = code.indexOf('aria-label={`Name of ${row.secret_name}`}');
    expect(infoAt, 'the ⓘ button is gone').toBeGreaterThan(-1);
    expect(nameAt).toBeGreaterThan(-1);
    expect(infoAt, 'the ⓘ button moved after the name').toBeLessThan(nameAt);
  });

  it('opens ONE row at a time, and the same tap closes it', () => {
    expect(code).toContain("setInfoOpen((cur) => (cur === row.id ? '' : row.id))");
  });

  it('the panel holds a real checkbox labelled "Apply to all my apps"', () => {
    expect(panel).toContain('Apply to all my apps');
    expect(code).toContain("type=\"checkbox\"");
    expect(code).toContain('void applyToAllApps(row.id, e.target.checked)');
  });

  it('the checkbox reflects the STORED scope, not a local guess', () => {
    // `isShared` is derived from the row's own workspace_id, so the tick can never disagree with the vault.
    expect(code).toContain('const isShared = !meta?.workspace_id;');
    expect(code).toContain('checked={isShared}');
  });

  it('it writes immediately — a switch that needed "Save and sync" would be a switch that does nothing', () => {
    expect(code).toContain('await setSecretScope(userId, id, unlock.ticket, target)');
  });

  it('UN-sharing is refused, with an explanation, when no app is selected to tie the key to', () => {
    // Viewing "All apps" names no app, so turning the switch off has no destination. It must say so
    // rather than fail silently or pick an app on the user's behalf.
    expect(code).toContain('const canUnshare = !!viewingAppId;');
    expect(code).toContain('disabled={scoping === row.id || (isShared && !canUnshare)}');
    expect(panel).toMatch(/Pick an app in the box at the bottom/);
  });

  it('re-reads the vault after a move, because the server may have retired a duplicate', () => {
    const at = code.indexOf('await setSecretScope');
    expect(code.slice(at, at + 400)).toContain('await load(true)');
  });

  it('an expired ticket re-locks rather than showing a dead panel', () => {
    const at = code.indexOf('const applyToAllApps');
    const body = code.slice(at, code.indexOf('const remove =', at));
    expect(body).toContain('if (e?.needsUnlock) { relock(); return; }');
  });
});

describe('every row says which apps it reaches', () => {
  it('a shared key is captioned "For all apps"', () => {
    expect(panel).toContain('For all apps');
  });

  it('an app-scoped key names its app — a blank caption is not a label', () => {
    expect(code).toContain('`Only ${ownerLabel(meta)}`');
  });
});
