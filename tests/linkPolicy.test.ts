import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LINK_POLICY } from '../src/server/lib/prompts';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * REAL LINKS ON EVERY AI (admin 2026-08-25: "har ek ai ko"). The feature has two halves, and either
 * half alone leaves the user with nothing: the PROMPT must ask for links, and the SURFACE must be
 * able to render one. These tests pin both, on all four surfaces.
 */
describe('the link policy asks for real links and forbids invented ones', () => {
  it('requires markdown links and a Sources line', () => {
    expect(LINK_POLICY).toMatch(/markdown/i);
    expect(LINK_POLICY).toContain('Sources:');
  });

  it('🔒 forbids composing a URL — the rule that keeps a link an honest claim', () => {
    expect(LINK_POLICY).toMatch(/NEVER build a URL by guessing/i);
    expect(LINK_POLICY).toMatch(/appears verbatim in the live results/i);
    // Not certain ⇒ name the site in words instead of linking.
    expect(LINK_POLICY).toMatch(/NAME the site/i);
  });

  it('refuses the shapes a scam link takes', () => {
    expect(LINK_POLICY).toMatch(/login, payment or password/i);
  });
});

describe('every chat surface carries the policy', () => {
  it('Free chat, Professionals, Doctor AI and the v5 chat all include LINK_POLICY', () => {
    expect(read('src/server/routes/chat.ts')).toContain('LINK_POLICY');
    expect(read('src/server/professionals/engine.ts')).toContain('LINK_POLICY');
    expect(read('src/server/routes/sda.ts')).toContain('LINK_POLICY');
    expect(read('src/server/routes/agentv3.ts')).toContain('LINK_POLICY');
  });

  it('the live-search block no longer SUPPRESSES citations — that line was the reported bug', () => {
    const live = read('src/server/lib/liveSearchContext.ts');
    expect(live).not.toContain('Do not mention that you searched the web');
    expect(live).toContain('CITE THEM');
    // Anonymity is about WHICH AI ran, never about where a fact came from — both must be stated.
    expect(live).toMatch(/Do not name any AI model or provider/i);
    expect(live).toMatch(/naming the WEBSITE a fact came from is expected/i);
  });
});

describe('every chat surface can RENDER a link (the half that made the prompt useless)', () => {
  it('Professionals bubbles are linkified — 74 experts rendered dead text before', () => {
    const chat = read('src/components/professionals/ProfessionalChat.tsx');
    expect(chat).toContain('LinkedText');
    expect(chat).not.toContain('\n              {m.content}\n');
  });

  it('the v5 chat is linkified through its one shared message body', () => {
    expect(read('src/components/agentv3/FoldableMessage.tsx')).toContain('<LinkedText text={text} />');
  });

  // Since 2026-10-13 Doctor AI and the Free chat render their markdown through ONE renderer
  // (chat/ChatMarkdown.tsx), so the anchor rule is asserted there and each surface is held to it.
  it('Doctor AI opens links in a NEW tab — the default anchor navigated the app away', () => {
    expect(read('src/components/sda/SDAChat.tsx')).toContain('<ChatMarkdown');
    const renderer = read('src/components/chat/ChatMarkdown.tsx');
    expect(renderer).toContain('isSafeHttpUrl');
    expect(renderer).toContain("target=\"_blank\"");
    expect(renderer).toContain('rel="noopener noreferrer"');
  });

  it('the Free chat keeps its markdown anchors opening in a new tab', () => {
    expect(read('src/components/ide/AIChat.tsx')).toContain('<ChatMarkdown');
    expect(read('src/components/chat/ChatMarkdown.tsx')).toContain('target="_blank" rel="noopener noreferrer"');
  });
});
