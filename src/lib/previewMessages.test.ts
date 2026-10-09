import { describe, expect, it } from 'vitest';
import { frameUrlSharesPageOrigin, isFromOurPreviewFrame, previewPostMessageTarget } from './previewMessages';

describe('isFromOurPreviewFrame', () => {
  const ours = {} as Window;
  const stranger = {} as Window;

  it('accepts a message whose source is one of our frames', () => {
    expect(isFromOurPreviewFrame({ source: ours }, [null, ours, undefined])).toBe(true);
  });

  it('rejects a null source', () => {
    expect(isFromOurPreviewFrame({ source: null }, [ours])).toBe(false);
  });

  it('rejects a different window', () => {
    expect(isFromOurPreviewFrame({ source: stranger }, [ours])).toBe(false);
    expect(isFromOurPreviewFrame({ source: ours }, [])).toBe(false);
  });
});

describe('frameUrlSharesPageOrigin', () => {
  const page = 'https://navbharatai.com';

  it('is true only for an absolute URL on the page origin', () => {
    expect(frameUrlSharesPageOrigin('https://navbharatai.com/app', page)).toBe(true);
    expect(frameUrlSharesPageOrigin('https://site--sn-abc.web.app/', page)).toBe(false);
    expect(frameUrlSharesPageOrigin('https://3000-sandbox.e2b.app/', page)).toBe(false);
    expect(frameUrlSharesPageOrigin('/api/agentv3/preview-door', page)).toBe(false);
    expect(frameUrlSharesPageOrigin('', page)).toBe(false);
  });
});

describe('previewPostMessageTarget', () => {
  const page = 'https://navbharatai.com';

  it('names the preview host when the in-browser frame is cross-origin', () => {
    expect(previewPostMessageTarget({
      kind: 'inbrowser',
      previewSandboxUrl: 'https://preview.navbharatai.com/preview-sandbox.html?parent=1',
      pageOrigin: page,
    })).toBe('https://preview.navbharatai.com');
  });

  it('uses the page origin for the DEV same-origin srcDoc, and * for an opaque one', () => {
    expect(previewPostMessageTarget({
      kind: 'inbrowser', pageOrigin: page, devSameOriginSrcDoc: true,
    })).toBe(page);
    expect(previewPostMessageTarget({
      kind: 'inbrowser', pageOrigin: page, devSameOriginSrcDoc: false,
    })).toBe('*');
  });

  it('names a live frame on another host, and keeps * for the door whose 302 hides the final origin', () => {
    expect(previewPostMessageTarget({
      kind: 'live', frameSrc: 'https://site--sn-abc.web.app/index.html', pageOrigin: page,
    })).toBe('https://site--sn-abc.web.app');
    expect(previewPostMessageTarget({
      kind: 'live', frameSrc: 'https://navbharatai.com/api/agentv3/preview-door?w=1', pageOrigin: page,
    })).toBe('*');
    expect(previewPostMessageTarget({ kind: 'live', frameSrc: '', pageOrigin: page })).toBe('*');
  });
});
