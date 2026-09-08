import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  scopeControl, saveScope, scopeSentence, secretOwnerLabel, shortAppName,
} from '../src/lib/secretScope';

/**
 * WHICH APP IS THIS KEY FOR? (admin 2026-09-08, from a v5 screenshot.)
 *
 * The vault showed one dropdown of EVERY app at both doors. In Settings that is the job. Inside a v5
 * build it asks a question the user answered by opening the sheet — and its list of OTHER apps is a
 * one-tap route to saving a key into the wrong app's `.env`, with nothing anywhere to say so: the key
 * is saved, the key is valid, it is simply somewhere else, and the build in front of the user cannot
 * see it.
 */
describe('scopeControl — the control follows where the screen was opened from', () => {
  it('opened from inside an app ⇒ that app is FIXED', () => {
    expect(scopeControl('ws-1', 0)).toBe('fixed');
    expect(scopeControl('ws-1', 12)).toBe('fixed');
  });

  it('opened from Settings with apps ⇒ the full picker, unchanged', () => {
    expect(scopeControl(null, 3)).toBe('picker');
    expect(scopeControl('', 3)).toBe('picker');
    expect(scopeControl('   ', 3)).toBe('picker');
  });

  it('nothing to choose between ⇒ no control at all', () => {
    // Nobody should be asked to choose between one thing, or between nothing.
    expect(scopeControl(null, 0)).toBe('none');
  });

  it('🔒 the trigger is the APP, not `embedded` — which the vault states is about chrome only', () => {
    // A future embedded surface opened without an app must still get the picker.
    expect(scopeControl(undefined, 2)).toBe('picker');
  });
});

describe('saveScope — where the key actually goes', () => {
  it('🔒 IN FIXED MODE THE KEY CANNOT REACH ANOTHER APP — the foot-gun is unrepresentable', () => {
    // This is the property that kills the bug by construction rather than by carefulness: there is no
    // code path from this screen to a different app's .env, whatever the stale picker state says.
    expect(saveScope({ control: 'fixed', defaultAppId: 'ws-1', pickerValue: 'ws-OTHER' })).toBe('ws-1');
    expect(saveScope({ control: 'fixed', defaultAppId: 'ws-1', pickerValue: 'ws-OTHER', shareWithAll: true })).toBeNull();
  });

  it('the checkbox is the ONE surviving choice: this app, or all apps', () => {
    expect(saveScope({ control: 'fixed', defaultAppId: 'ws-1', shareWithAll: false })).toBe('ws-1');
    expect(saveScope({ control: 'fixed', defaultAppId: 'ws-1', shareWithAll: true })).toBeNull();
  });

  it('picker mode is unchanged — the dropdown decides, and "" means shared', () => {
    expect(saveScope({ control: 'picker', pickerValue: 'ws-9' })).toBe('ws-9');
    expect(saveScope({ control: 'picker', pickerValue: '' })).toBeNull();
    expect(saveScope({ control: 'picker' })).toBeNull();
  });

  it('with no control, a key is shared — the same behaviour every pre-scoping key already has', () => {
    expect(saveScope({ control: 'none', defaultAppId: 'ws-1' })).toBeNull();
  });

  it('a blank app id never produces a blank scope string', () => {
    expect(saveScope({ control: 'fixed', defaultAppId: '  ' })).toBeNull();
  });
});

describe('shortAppName — an unnamed app\'s "name" is its whole opening prompt', () => {
  const prompt = 'Import this app from my GitHub repository and give me a short survey of what it does';

  it('clamps a run-on title instead of letting it overflow the control', () => {
    const out = shortAppName(prompt);
    expect(out.length).toBeLessThanOrEqual(42);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves a real app name completely alone', () => {
    expect(shortAppName('Survey Buddy')).toBe('Survey Buddy');
  });

  it('collapses whitespace, and an empty name stays empty rather than becoming "…"', () => {
    expect(shortAppName('  My   App  ')).toBe('My App');
    expect(shortAppName('')).toBe('');
    expect(shortAppName(null)).toBe('');
    expect(shortAppName(undefined)).toBe('');
  });
});

describe('scopeSentence — where the key goes is stated in every mode', () => {
  it('fixed: names the app, and says the other apps will NOT get it', () => {
    const s = scopeSentence({ control: 'fixed', appName: 'Survey Buddy' });
    expect(s).toContain('Survey Buddy');
    expect(s).toMatch(/other apps will not receive it/i);
  });

  it('fixed + shared: says the opposite, so the checkbox is never ambiguous', () => {
    const s = scopeSentence({ control: 'fixed', appName: 'Survey Buddy', shareWithAll: true });
    expect(s).toMatch(/every app you build/i);
    expect(s).not.toMatch(/will not receive/i);
  });

  it('fixed with no usable name still says something true rather than an empty quote', () => {
    expect(scopeSentence({ control: 'fixed', appName: '' })).toContain('this app');
    expect(scopeSentence({ control: 'fixed', appName: '' })).not.toContain('““');
  });

  it('the sentence clamps a run-on name too — it used to repeat the whole prompt in quotes', () => {
    const s = scopeSentence({ control: 'fixed', appName: 'Import this app from my GitHub repository and give me a short survey of what it does' });
    expect(s).toContain('…');
    expect(s.length).toBeLessThan(140);
  });

  it('picker and none modes keep their existing wording', () => {
    expect(scopeSentence({ control: 'picker', pickerTitle: 'Shop' })).toContain('“Shop”');
    expect(scopeSentence({ control: 'picker', pickerTitle: '', hasApps: true })).toMatch(/Pick an app above/);
    expect(scopeSentence({ control: 'none' })).toBe('A key you add now goes to every app you build.');
  });
});

describe('secretOwnerLabel — who receives a key already saved', () => {
  const titleOf = (id: string) => ({ 'ws-1': 'Survey Buddy' } as Record<string, string>)[id];

  it('"All apps" is the fact most worth knowing about a payment secret', () => {
    expect(secretOwnerLabel({ workspaceId: null })).toBe('All apps');
    expect(secretOwnerLabel({ workspaceId: '' })).toBe('All apps');
  });

  it('names the app when the name is known', () => {
    expect(secretOwnerLabel({ workspaceId: 'ws-1', titleOf })).toBe('Survey Buddy');
  });

  it('🔒 with NO app list it states the relationship rather than inventing a name', () => {
    // The v5 sheet can render with a failed app-list request; a blank badge there would hide the one
    // distinction that matters (shared vs not).
    expect(secretOwnerLabel({ workspaceId: 'ws-9', currentAppId: 'ws-9' })).toBe('This app');
    expect(secretOwnerLabel({ workspaceId: 'ws-9', currentAppId: 'ws-1' })).toBe('Another app');
  });
});

describe('🔒 the wiring — both doors, one decision', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'SecretManager.tsx'), 'utf8');
  const panel = readFileSync(join(__dirname, '..', 'src', 'components', 'agentv3', 'AgentV3Panel.tsx'), 'utf8');

  it('the save uses the DERIVED scope, never the raw picker state', () => {
    expect(src).toContain('await saveSecret(userId, savedName, value.trim(), effectiveScope);');
    expect(src).not.toMatch(/saveSecret\([^)]*scope \|\| null\)/);
  });

  it('🔒 the app dropdown is rendered ONLY in picker mode', () => {
    // The whole defect was this control appearing where the app is already decided.
    const selectAt = src.indexOf('id="secret-scope"');
    expect(selectAt).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, selectAt - 400), selectAt)).toContain("control === 'picker'");
  });

  it('the scope follows the app if it changes under a mounted sheet', () => {
    // useState reads its argument once, so without this a sheet left open across a switch would keep
    // writing into the previous app — the same wrong-app write, by another route.
    expect(src).toMatch(/useEffect\(\(\) => \{\s*setScope\(defaultAppId \?\? ''\);/);
  });

  it('v5 hands the sheet the app name it already displays', () => {
    expect(panel).toContain('defaultAppName={appName}');
  });

  it('Settings still opens on "All apps" — that door is unchanged', () => {
    expect(scopeControl(undefined, 5)).toBe('picker');
    expect(saveScope({ control: 'picker', pickerValue: '' })).toBeNull();
  });
});
