/**
 * AN EMPTY PREVIEW OPENS — IT DOES NOT SIT THERE DISABLED (admin 2026-09-24).
 *
 * *"home page par, jab preview me kuch nahi hai, tab agar preview press kiya jaye, to kuch bhi nahi
 * hota hai. … jab preview me kuch na ho, aur preview par click kiya jaye, to khali preview open ho jaye!"*
 *
 * The mobile footer's Preview button was `disabled` until a workspace or generated code existed, and the
 * desktop sidebar's Preview row was disabled until generated code existed (a STRICTER rule than the
 * footer's — one screen, two doors, two rules). Either way a tap on the home page did nothing at all.
 *
 * The screen they now open is not new: PreviewSurface already answers "nothing built yet" with its
 * welcome screen ("Your app will appear here"). With no workspace the auto-load never runs, so nothing
 * sets an error, and `previewEmptyKind` returns 'no-app-yet' — asserted below, so a later change that
 * made the empty state an error would fail here rather than greet the user with one.
 *
 * The door facts are SOURCE facts about wiring no behavioural test here renders, so they are asserted
 * against the source with comments stripped — a note quoting the old gate cannot satisfy them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { previewEmptyKind, WELCOME_HEADLINE } from '../src/components/agentv3/previewWelcome';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const app = stripComments(read('src/App.tsx'));
const sidebar = stripComments(read('src/components/panels/SidebarNav.tsx'));
const surface = stripComments(read('src/components/agentv3/PreviewSurface.tsx'));

describe('every door to Preview opens it, app or no app', () => {
  it('the mobile footer no longer disables Preview', () => {
    expect(app).not.toMatch(/id === 'preview' && !\(v3Preview\.workspaceId \|\| hasGeneratedCode\)/);
    const footer = app.slice(app.indexOf("{ id: 'preview' as ViewType,"));
    const button = footer.slice(0, footer.indexOf('</button>'));
    expect(button).toContain('onClick={() => toggleTab(id)}');
    expect(button).not.toMatch(/disabled=/);
  });

  it('the desktop sidebar no longer disables Preview (only Files keeps its gate)', () => {
    expect(sidebar).not.toMatch(/isPreview \|\| item\.id === 'files'/);
    expect(sidebar).toContain("const isDisabled = item.id === 'files' && !hasGeneratedCode;");
  });

  it('the stripper does not simply blank the files (a guard against a vacuous pass)', () => {
    expect(app).toContain("{ id: 'preview' as ViewType,");
    expect(sidebar).toContain("const isPreview = item.id === 'preview';");
  });
});

describe('what an empty preview shows is the welcome screen, not an error', () => {
  it('with nothing built, nothing loading and no error, the state is "no app yet"', () => {
    expect(previewEmptyKind({ knownEmpty: false, loading: false, error: '', everRendered: false })).toBe('no-app-yet');
  });

  it('with no workspace the surface never starts a load that could turn into an error', () => {
    expect(surface).toContain("if (mode === 'inbrowser' && !html && !loading && workspaceId) { void loadInBrowser(); }");
    expect(surface).toMatch(/disabled=\{loading \|\| !workspaceId\}/);
  });

  it('that screen is the one headed "Your app will appear here"', () => {
    expect(WELCOME_HEADLINE).toBe('Your app will appear here');
    expect(surface).toContain('<PreviewWelcome checking={loading} slow={loadSeconds >= 4} />');
  });
});
