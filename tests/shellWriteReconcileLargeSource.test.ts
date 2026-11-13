import { describe, expect, it } from 'vitest';
import { changedFilesCommand, MAX_RECONCILED_BYTES, parseChangedFiles, shellMayWriteOpaquely } from '../src/server/AgentV3/shellWriteReconcile';

describe('opaque shell write reconciliation for large generated source (BR #2342)', () => {
  it('does not silently exclude a 646 KB generated JavaScript file', () => {
    expect(MAX_RECONCILED_BYTES).toBeGreaterThan(646_123);
    expect(changedFilesCommand()).toContain(`-size -${MAX_RECONCILED_BYTES}c`);
    expect(parseChangedFiles('./js/08-game-main.js\n')).toEqual(['js/08-game-main.js']);
  });

  it('detects script-driven rewrites whose targets are dynamic', () => {
    expect(shellMayWriteOpaquely('node -e "fs.writeFileSync(f, content)"')).toBe(true);
  });

  it('does not duplicate paths already recorded by the tool dispatcher', () => {
    expect(parseChangedFiles('./js/08-game-main.js\n', ['js/08-game-main.js'])).toEqual([]);
  });
});
