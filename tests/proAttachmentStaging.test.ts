import { describe, expect, it } from 'vitest';
import { stageAttachmentFiles, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES } from '../src/lib/attachmentLimits';

const f = (name: string, size = 10) => ({ name, size });
describe('Pro attachment staging', () => {
  it('never silently slices off files beyond the eighth', () => {
    const incoming = Array.from({ length: 10 }, (_, i) => f(`${i}.html`));
    const result = stageAttachmentFiles([], incoming);
    expect(result.accepted).toEqual(incoming.slice(0, 8));
    expect(result.rejected.map(r => r.file)).toEqual(incoming.slice(8));
    expect(result.rejected[0].reason).toContain('at most 8');
  });
  it('includes already staged files in both count and size limits', () => {
    const current = Array.from({ length: 8 }, (_, i) => f(`${i}.txt`));
    expect(stageAttachmentFiles(current, [f('new.html')]).accepted).toEqual([]);
    const result = stageAttachmentFiles([f('first', MAX_ATTACHMENT_BYTES)], [f('second', MAX_ATTACHMENT_BYTES)]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toContain('combined');
    expect(current).toHaveLength(8);
  });
  it('keeps valid files when another selection is too large', () => {
    const valid = f('small.html');
    const result = stageAttachmentFiles([], [f('large', MAX_ATTACHMENT_BYTES + 1), valid]);
    expect(result.accepted).toEqual([valid]);
    expect(result.rejected[0].reason).toContain('upload limit');
  });
  it('accepts exact boundaries and rejects one more byte', () => {
    const first = f('first', MAX_ATTACHMENT_BYTES);
    const second = f('second', MAX_TOTAL_ATTACHMENT_BYTES - MAX_ATTACHMENT_BYTES);
    const result = stageAttachmentFiles([first], [second, f('third', 1)]);
    expect(result.accepted).toEqual([second]);
    expect(result.rejected.map(r => r.file.name)).toEqual(['third']);
  });
});
