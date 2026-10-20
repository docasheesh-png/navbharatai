import { describe, it, expect } from 'vitest';
import * as moved from '../src/server/AgentV3/importPromptNotes';
import * as route from '../src/server/routes/agentv3';

describe('import prompt notes live in their own module (agentv3.ts split, item 5)', () => {
  it('the route re-exports the very same functions', () => {
    expect(route.failedImportPromptNote).toBe(moved.failedImportPromptNote);
    expect(route.importSurveyPromptNote).toBe(moved.importSurveyPromptNote);
    expect(route.importHonestySummaryPrefix).toBe(moved.importHonestySummaryPrefix);
    expect(route.IMPORT_HONESTY_PREFIX_MARK).toBe(moved.IMPORT_HONESTY_PREFIX_MARK);
  });
  it('behaviour is unchanged', () => {
    expect(moved.failedImportPromptNote(null)).toBe('');
    expect(moved.failedImportPromptNote({ url: 'u', reason: 'r' })).toContain('The user DID provide a repository URL: u');
    expect(moved.importHonestySummaryPrefix({ url: 'u', reason: 'r' }).startsWith(moved.IMPORT_HONESTY_PREFIX_MARK)).toBe(true);
    expect(moved.importSurveyPromptNote({ url: 'u', fileCount: 2, structure: 'src', keyFiles: { a: 'b' }, truncated: false })).toContain('----- a -----');
  });
});
