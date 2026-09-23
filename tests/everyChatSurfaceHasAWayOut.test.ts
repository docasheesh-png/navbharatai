// EVERY CHAT SURFACE OFFERS A WAY TO ANOTHER MODE — and nothing here can be checked by tsc.
//
// The ask (admin 2026-09-21): *"navbharatai free chat me mode selector show hota hai, par jab ek bar
// mode badal diya jaye to, dusre professionals me mode select ka option hi nahi hai … jisse kabhi bhi
// kisi bhi mode me se kisi bhi mode me jaya ja sake."*
//
// 🔴 WHY THIS IS A SOURCE-LEVEL TEST, which is the unusual part. The prop is OPTIONAL — it has to be,
// because `undefined` is what hides the button on a phone where the bottom bar already carries Mode.
// That makes every failure here INVISIBLE to the compiler: a call site that simply does not pass it
// type-checks perfectly and renders a surface with no way out. `App.tsx` alone has 73 expert chats;
// one missed line would strand exactly one expert, and nothing anywhere would say so.
//
// ⚠️ It is also why the button must stay ONE component. Five inline copies would each drift, and a
// test that greps for markup would pass while the fifth copy quietly used the wrong sheet.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Comments quote the rules verbatim, so a needle would match its own explanation. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const app = codeOnly(read('src/App.tsx'));

describe('the opener is decided ONCE', () => {
  it('App.tsx derives it from the bottom-bar condition, in one place', () => {
    expect(app).toContain('const modePickerOpener = showsGlobalMobileNav ? undefined : () => setShowModePicker(true)');
  });

  it('no surface re-derives the device question for itself', () => {
    // A second `showsGlobalMobileNav ? undefined :` would be a second answer to one question — the
    // exact shape that lets two surfaces disagree about whether a phone shows two Mode controls.
    const occurrences = app.split('showsGlobalMobileNav ? undefined').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('EXACTLY ONE Mode control, on every device — never two, never none', () => {
  // The admin asked outright: "mobile me kaam karega???" It does, and not through this button — the
  // bottom bar has carried Mode since 2026-08-25. The two are complementary BY CONSTRUCTION, and that
  // is the property worth pinning: the bar renders only when `showsGlobalMobileNav` is true, and the
  // composer's opener is `undefined` in exactly that case. Break either half and a real user is left
  // with two Mode buttons stacked on a phone, or a chat with no way out at all — and nothing else in
  // this repo would notice, because both halves type-check perfectly either way.

  it('the bottom bar offers Mode on the same surfaces this button serves', () => {
    // One list decides both: `isModeSurface` names the free chat, the hub, Doctor AI, the image
    // studio and every expert, and it is what the footer branches on.
    expect(app).toContain('isModeSurface(activeView) ?');
    expect(app).toMatch(/key: 'mode',[^\n]*label: 'Mode'/);
    expect(app).toContain("if (key === 'mode') { setShowModePicker(true); return; }");
  });

  it('the bar and the button are gated on the SAME condition, in opposite directions', () => {
    // The bar: rendered while the condition holds.
    expect(app).toContain('{showsGlobalMobileNav && (\n        <nav');
    // The button: available while it does NOT.
    expect(app).toContain('const modePickerOpener = showsGlobalMobileNav ? undefined : () => setShowModePicker(true)');
  });

  it('both doors open the one picker — there is no second mode state anywhere', () => {
    expect(app.match(/const \[showModePicker, setShowModePicker\] = useState/g)?.length).toBe(1);
    expect(app.match(/<ModePickerSheet/g)?.length).toBe(1);
  });
});

describe('every surface that renders a chat composer receives it', () => {
  it('every expert chat gets the opener — through the ONE render site all 70+ experts share', () => {
    // 73 hand-written `activeView === 'x_ai'` blocks became one map over the open conversation windows
    // (2026-09-21). One site is strictly better for this rule: a prop cannot be missed on a block that
    // does not exist. But it is ALSO the reason this must stay a source-level check — the component is
    // lazy-loaded (`_lz`), so a missing prop here is invisible to the compiler.
    const total = (app.match(/<ProfessionalChat\b/g) ?? []).length;
    expect(total).toBe(1);
    expect(app).toMatch(/openChats\.map\(\(win\) => \{[\s\S]{0,800}?<ProfessionalChat[^>]*onOpenModePicker=\{modePickerOpener\}/);
    // …and the window it renders is told WHICH conversation it is (the isolation the admin asked for).
    expect(app).toMatch(/<ProfessionalChat[^>]*conversationId=\{win\.id\}/);
    expect(app).toMatch(/<div key=\{win\.id\}/);
  });

  it('Doctor AI, the free chat and the image studio get it too', () => {
    expect(app).toMatch(/<SDAChat[^>]*onOpenModePicker=\{modePickerOpener\}/);
    expect(app).toMatch(/<ViewPanels[\s\S]{0,200}?onOpenModePicker=\{modePickerOpener\}/);
    // The free chat reaches AIChat through NBIChatPanel.
    expect(app).toMatch(/onOpenModePicker=\{modePickerOpener\}/);
  });

  it('the image generator receives it and renders the button', () => {
    const panels = codeOnly(read('src/components/panels/ViewPanels.tsx'));
    expect(panels).toMatch(/<AIImageGenerator[^>]*onOpenModePicker=\{onOpenModePicker\}/);
    const gen = codeOnly(read('src/components/ide/AIImageGenerator.tsx'));
    // It actually hands it to the shared shell (which renders the button), rather than merely
    // accepting the prop.
    expect(gen).toContain('onOpenMode={onOpenModePicker}');
  });

  it('each composer renders the SHARED button, never its own copy', () => {
    for (const file of [
      'src/components/professionals/ProfessionalChat.tsx',
      'src/components/sda/SDAChat.tsx',
      'src/components/ide/AIImageGenerator.tsx',
      'src/components/ide/AIChat.tsx',
    ]) {
      const src = codeOnly(read(file));
      // Since 2026-09-23 every composer is the shared ComposerShell, which renders the shared button.
      expect(src, file).toContain('<ComposerShell');
      expect(src, file).toMatch(/onOpenMode=\{/);
      // The retired inline markup: a second copy would reintroduce the drift this replaced.
      expect(src, file).not.toContain('aria-label="Choose AI mode"');
    }
    expect(codeOnly(read('src/components/chat/ComposerShell.tsx'))).toContain('<ModeButton onOpen={onOpenMode} size="rail" />');
  });
});

describe('the button itself', () => {
  const btn = read('src/components/chat/ModeButton.tsx');

  it('renders NOTHING without an opener, rather than something inert', () => {
    // "Built but not really working" is the state this app does not have (second absolute rule), and
    // a Mode button that opens no picker is exactly that.
    expect(codeOnly(btn)).toContain('if (!onOpen) return null;');
  });

  it('opens the ONE picker and holds no list of its own', () => {
    const code = codeOnly(btn);
    expect(code).not.toContain('PROFESSIONAL_CHATS');
    expect(code).not.toContain('modePickerEntries');
  });

  it('is themed, not painted with literals', () => {
    // A new file's colour-ratchet baseline is zero, so this would fail CI anyway — it is asserted
    // here too because the reason is a rule, not an accident of which test ran first.
    const code = codeOnly(btn);
    expect(code).not.toMatch(/text-white|bg-\[#|text-gray-\d/);
  });
});
