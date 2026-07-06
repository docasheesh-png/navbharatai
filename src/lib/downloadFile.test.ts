import { describe, it, expect } from 'vitest';
import { pickFileDeliveryStrategy } from './downloadFile';

describe('pickFileDeliveryStrategy — iOS-safe file delivery', () => {
  it('prefers the Web Share API when files can be shared (iOS Safari ignores <a download>)', () => {
    // The 2026-07-06 bug: on iPhone the "Build report" saved nothing because <a download> is ignored.
    expect(pickFileDeliveryStrategy({ canShareFiles: true })).toBe('share');
  });

  it('falls back to the classic anchor download when file-share is unavailable (desktop)', () => {
    expect(pickFileDeliveryStrategy({ canShareFiles: false })).toBe('anchor-download');
  });
});
