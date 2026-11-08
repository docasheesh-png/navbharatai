import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ComposerShell, COMPOSER_TEXTAREA_CLASS, COMPOSER_SEND_CLASS } from './ComposerShell';

function render(position?: 'text' | 'bottom-right', controls: React.ReactNode = <button>Attach</button>, loading = false) {
  return renderToStaticMarkup(<ComposerShell sendPosition={position} controls={controls}
    send={loading ? <><button>Queue</button><button>Stop</button></> : <button className={COMPOSER_SEND_CLASS} disabled>Send</button>}>
    <textarea rows={1} className={COMPOSER_TEXTAREA_CLASS} />
  </ComposerShell>);
}

describe('ordinary chat lower-right send opt-in', () => {
  it('moves just one send slot after text and tools, preserving disabled state', () => {
    const html = render('bottom-right');
    expect(html).toContain('data-composer-send-position="bottom-right"');
    expect(html.indexOf('data-composer-toolbar')).toBeLessThan(html.indexOf('nb-composer-send-slot'));
    expect(html.match(/nb-composer-send-slot/g)).toHaveLength(1);
    expect(html).toContain('disabled=""');
  });
  it('reserves the bottom row even without tools and keeps Queue/Stop together', () => {
    expect(render('bottom-right', null)).toContain('data-composer-toolbar');
    const html = render('bottom-right', undefined, true);
    expect(html).toContain('>Queue</button><button>Stop</button>');
    expect(html.match(/nb-composer-send-slot/g)).toHaveLength(1);
  });
  it('leaves the default layout used by other screens unchanged', () => {
    const html = render();
    expect(html).not.toContain('data-composer-send-position');
    expect(html.indexOf('nb-composer-send-slot')).toBeLessThan(html.indexOf('data-composer-toolbar'));
    expect(render(undefined, null)).not.toContain('data-composer-toolbar');
  });
  it('ordinary chat alone opts in; AIChat forwards presentation without changing handlers', () => {
    const panel = readFileSync('src/components/panels/NBIChatPanel.tsx', 'utf8');
    const chat = readFileSync('src/components/ide/AIChat.tsx', 'utf8');
    expect(panel).toContain('composerSendPosition="bottom-right"');
    expect(chat).toContain('sendPosition={composerSendPosition}');
    expect(chat).toContain('enterShouldSend({');
    expect(chat).toContain('onSendOnEnterChange={setSendOnEnter}');
    expect(chat).toContain('onClick={() => onStop?.()}');
    expect(chat).toContain('onClick={() => onQueueQuestion()}');
  });
});
