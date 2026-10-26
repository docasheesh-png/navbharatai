import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../../lib/copy';
import { HomeView } from '../home/HomeView';
import { NBIChatPanel } from '../panels/NBIChatPanel';
import { ModeButton } from './ModeButton';
import { ModePickerSheet } from './ModePickerSheet';
import { activeModeId, FREE_MODE_ID, modePickerEntries, recentTargetFromId } from './modePicker';
import { DEFAULT_VIEW_WINDOW } from '../../lib/chatWindows';

const homeButtons = vi.hoisted(() => new Map<string, () => void>());
vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: (_, tag: string) => ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }: any) => {
    if (tag === 'button' && props['aria-label']) homeButtons.set(props['aria-label'], props.onClick);
    return createElement(tag, props, children);
  } }),
}));
vi.mock('../../lib/mobileNative', () => ({ isNativeApp: () => false, openExternalUrl: vi.fn() }));
vi.mock('../ads/SponsoredAd', () => ({ SponsoredBanner: () => null }));
vi.mock('../ide/AIChat', () => ({ AIChat: () => null }));
vi.mock('./FreeAnswerStatusBadge', () => ({ FreeAnswerStatusBadge: () => null }));
afterEach(() => { homeButtons.clear(); vi.clearAllMocks(); });

const html = (node: ReactNode) => renderToStaticMarkup(node);
const obsoleteName = /\b(?:free\s+chat|navbharatai\s+free)\b/i;

describe('AI chat is presentation, not a new mode or entitlement', () => {
  it.each([null, { uid: 'fixture-user' }])('Home names the same chat for guest and signed-in users (%j)', (user) => {
    const onStartChat = vi.fn(); const onStartProChat = vi.fn(); const onShowLogin = vi.fn();
    const markup = html(<HomeView user={user} onStartChat={onStartChat} onStartProChat={onStartProChat} onShowLogin={onShowLogin} />);
    expect(COPY.branding.aiChatName).toBe('AI chat');
    expect(markup).toContain('aria-label="NavBharatAI Chat — AI chat"');
    expect(markup).toContain('>Start AI chat</span>');
    expect(markup).toContain('>AI chat</span>');
    expect(markup).not.toMatch(obsoleteName);
    // Preserve the requested letter case in both responsive CTAs and the subtitle.
    expect(markup).not.toMatch(/<p class="[^"]*uppercase[^"]*">AI chat<\/p>/);
    expect(markup).not.toMatch(/<span class="[^"]*uppercase[^"]*">[^<]*AI chat<\/span>/);
    const open = homeButtons.get('NavBharatAI Chat — AI chat');
    expect(open).toBe(onStartChat);
    open?.(); open?.();
    expect(onStartChat).toHaveBeenCalledTimes(2);
    expect(onStartProChat).not.toHaveBeenCalled(); expect(onShowLogin).not.toHaveBeenCalled();
    // Existing pricing copy is not reinterpreted by this rename.
    expect(markup).toContain('Free Forever');
  });

  it.each(['inline', 'compact', 'rail'] as const)('Mode tooltip uses the shared name (%s)', (size) => {
    const markup = html(<ModeButton onOpen={() => {}} size={size} />);
    expect(markup).toContain('title="Choose AI mode — AI chat, Image Generator AI or any expert"');
    expect(markup).not.toMatch(obsoleteName);
  });

  it('chat header uses the same display name', () => {
    const markup = html(<NBIChatPanel {...({ sessions: [], messages: [] } as any)} />);
    expect(markup).toContain('>AI chat</span>');
  });

  it('new/recent windows and their accessible close labels keep stable identities', () => {
    const viewWindows = [
      { id: DEFAULT_VIEW_WINDOW, professionalId: 'nbi_chat' },
      { id: 'second', professionalId: 'nbi_chat' },
    ];
    const opts = { hideMedical: false, activeView: 'nbi_chat', openViews: ['nbi_chat'], openChats: [], viewWindows };
    const entries = modePickerEntries(opts).filter(e => e.kind === 'free' || e.view === 'nbi_chat');
    expect(entries.map(({ id, name, kind }) => ({ id, name, kind }))).toEqual([
      { id: 'recent:nbi_chat', name: 'AI chat (1)', kind: 'recent' },
      { id: 'recent:nbi_chat#second', name: 'AI chat (2)', kind: 'recent' },
      { id: 'free', name: 'AI chat', kind: 'free' },
    ]);
    expect(FREE_MODE_ID).toBe('free');
    expect(activeModeId('nbi_chat', null, 'second')).toBe('recent:nbi_chat#second');
    expect(recentTargetFromId(entries[1].id)).toEqual({ view: 'nbi_chat', conversationId: 'second' });
    const markup = html(<ModePickerSheet {...opts} activeViewWindowId="second" onPick={() => {}} onClose={() => {}} onCloseRecent={() => {}} />);
    for (const name of ['AI chat (1)', 'AI chat (2)']) {
      expect(markup).toContain(`aria-label="Close ${name}"`);
      expect(markup).toContain(`title="Close ${name}"`);
    }
    expect(markup).not.toMatch(obsoleteName);
    expect(markup).toContain('>AI chat</span>');
  });

  it('ordinary component display literals cannot reintroduce the retired product names', () => {
    const files = ['src/App.tsx'];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'admin' && !entry.name.startsWith('.tmp-')) visit(path); }
        else if (/\.tsx?$/.test(path) && !/\.test\./.test(path)) files.push(path);
      }
    };
    visit('src/components');
    const found: string[] = [];
    for (const path of files) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const scan = (node: any) => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) && obsoleteName.test(node.text)) {
          found.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, scan);
      };
      scan(source);
    }
    expect(found).toEqual([]);
  });
});
