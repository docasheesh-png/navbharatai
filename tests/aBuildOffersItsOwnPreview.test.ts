// A BUILD OFFERS ITS OWN PREVIEW — THE PLATFORM SAYS IT BUILT, NOT THE MODEL (admin 2026-10-11, Q-781).
//
// Five chat buttons waited for markers (`__VIEW_PREVIEW__`, `__DEPLOY_ACTIONS__`, `__SWITCH_TO_BUILD__`,
// `__URGENT_BUILD__`, `__AUTO_PLAN__`) that nothing ever told the model to print, so none could appear — a
// build that worked offered no way to open its preview. THE CLASS: UI waiting on a signal nothing produces.
// The decision: View preview and deploy are offered by the platform under a reply whose code really landed,
// and the other three branches are deleted with their buttons. A sibling of the same class went with it: a
// deploy panel state nothing could ever open.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chatBuildMeta, chatBuildView } from '../src/lib/chatBuildMeta';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the record', () => {
  it('🔒 a reply whose code landed is marked built and carries its files', () => {
    const meta = chatBuildMeta({ suggestions: ['x'] }, { 'index.html': '<h1>hi</h1>' });
    expect(meta).toEqual({ suggestions: ['x'], built: true, deployFiles: { 'index.html': '<h1>hi</h1>' } });
    expect(chatBuildView(meta)).toEqual({ built: true, deployFiles: { 'index.html': '<h1>hi</h1>' } });
  });

  it('a reply that built nothing offers nothing', () => {
    expect(chatBuildView(undefined)).toEqual({ built: false, deployFiles: null });
    expect(chatBuildView({ deployFiles: { 'a.js': '' } })).toEqual({ built: false, deployFiles: null });
    expect(chatBuildView({ built: true, deployFiles: {} })).toEqual({ built: true, deployFiles: null });
  });
});

describe('🔒 the wiring', () => {
  it('the engine marks the reply when its code lands — the platform, not a marker', () => {
    const engine = code('src/hooks/useChatEngine.ts');
    expect(engine).toContain('meta: chatBuildMeta(m.meta, newFiles)');
    expect(engine).toContain('replyMsgId = aiMessage.id;');
  });

  it('the chat reads the record, and no button waits on a marker', () => {
    const chat = code('src/components/ide/AIChat.tsx');
    for (const m of ['__VIEW_PREVIEW__', '__DEPLOY_ACTIONS__', '__SWITCH_TO_BUILD__', '__URGENT_BUILD__', '__AUTO_PLAN__']) {
      expect(chat, m).not.toContain(`includes('${m}')`);
    }
    expect(chat).toContain('{build.built && onPreviewClick && (');
    expect(chat).toContain('{build.built && deployFiles && onDownloadZip && (');
    // a button that sent a command nothing answers is not kept
    expect(chat).not.toContain("onSendSuggestion('/code-review')");
    expect(chat).not.toContain("onSendSuggestion('__CONFIRM_AUTO_BUILD__')");
  });

  it('the free chat is handed the real download, and the panel nothing could open is gone', () => {
    expect(code('src/components/panels/NBIChatPanel.tsx')).toContain('onDownloadZip={onDownloadZip}');
    const app = code('src/App.tsx');
    expect(app).toContain('onDownloadZip={downloadAppZip}');
    expect(app).not.toContain('showDeployPanel');
  });
});
