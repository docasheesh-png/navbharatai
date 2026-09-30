// Autopsy 33812996 (2026-09-30, "Circle to Search"). The app "recognised" a song by picking one at random
// from a mock database, "translated" by echoing `[Translated to X]: text`, and wrote its search results and
// AI overviews into the code. The summary called every one a working feature, and the authenticity scan
// found nothing: it knew made-up PEOPLE (autopsy f15a9bcc), not made-up RESULTS. Lines below are verbatim
// from the report's generated files.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  scanAuthenticity, simulatedResultIssues, simulatedResultNotice, simulatedDataIssues, fakeResultWriteNote,
} from '../src/server/AgentV3/AuthenticityAnalysis';
import { NO_FAKE_RESULTS_RULE } from '../src/server/AgentV3/noEvalRule';

const kinds = (content: string, file = 'src/utils/x.ts') => scanAuthenticity(file, content).map((i) => i.kind);

describe('🔴 the report\'s own lines are caught', () => {
  it.each([
    '  // Mock Song Database for demonstration',
    '  const MOCK_DB: SongInfo[] = [',
    '        const detectedSong = MOCK_DB[detectedIndex];',
    'const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.mockcircletosearch.com/v1";',
    '          translatedText: `[Translated to ${targetLang}]: ${text}`,',
    '      // Simulated results based on engine',
    '      // Simulate AI Overview generation (only for Google)',
    '    // Mock translation service',
    '  // Simulate AI Summary',
  ])('%s', (line) => {
    expect(kinds(line)).toContain('simulated-result');
  });
});

describe('what is not a made-up result', () => {
  it.each([
    '      // In a real app, this would call the API service',
    '      await new Promise(resolve => setTimeout(resolve, 800)); // simulate network delay',
    '        // Simulate processing delay',
    'function simulateStep(dt: number) { world.step(dt); }',
    'const mockBattle = startBattle(player, enemy);',
    'export function detectFakeNews(text: string): Verdict {',
    '// fake review detection using the store API',
    'const [simulatedScanning, setSimulatedScanning] = useState(false);',
    '<h1>Fake currency scanner</h1>',
  ])('%s', (line) => {
    expect(kinds(line)).not.toContain('simulated-result');
  });
  it('a mocks/ folder and a test file are never scanned for it', () => {
    expect(simulatedResultIssues({ 'src/mocks/handlers.ts': 'const MOCK_DB = [];' })).toHaveLength(0);
    expect(simulatedResultIssues({ 'src/App.test.tsx': 'const MOCK_DB = [];' })).toHaveLength(0);
  });
  it('made-up PEOPLE keep their own kind and their own notice', () => {
    expect(simulatedDataIssues({ 'src/a.ts': 'const mockUsers = generateSimulatedVendors();' })).toHaveLength(1);
    expect(simulatedResultIssues({ 'src/a.ts': 'const mockUsers = generateSimulatedVendors();' })).toHaveLength(0);
  });
});

describe('what the user and the builder are told', () => {
  const files = { 'src/components/MusicRecognition.tsx': '  const MOCK_DB: SongInfo[] = [];\n' };
  it('the user: one plain paragraph, no engine name', () => {
    const n = simulatedResultNotice(simulatedResultIssues(files));
    expect(n).toMatch(/demo results, not real ones/);
    expect(n).toMatch(/MusicRecognition\.tsx/);
    expect(n).not.toMatch(/\b(GLM|Kimi|Claude|Gemini|Grok)\b/i);
    expect(simulatedResultNotice([])).toBe('');
  });
  it('the builder: at write time, with the line', () => {
    const note = fakeResultWriteNote('src/components/MusicRecognition.tsx', files['src/components/MusicRecognition.tsx']);
    expect(note).toMatch(/MusicRecognition\.tsx:1/);
    expect(note).toMatch(/honest "connect X to turn this on"/);
    expect(fakeResultWriteNote('src/App.tsx', 'export default () => null;')).toBe('');
  });
});

describe('both halves are wired', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('prevention: both lanes carry the rule', () => {
    expect(NO_FAKE_RESULTS_RULE).toMatch(/random song/);
    expect(read('src/server/AgentV3/systemPrompt.ts')).toMatch(/\n\s+NO_FAKE_RESULTS_RULE,\n/);
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).toMatch(/\n\s+NO_FAKE_RESULTS_RULE,\n/);
  });
  it('detection: write time and end of build', () => {
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('security += fakeResultWriteNote(p, files[p]);');
    expect(read('src/server/routes/agentv3.ts')).toContain("code: 'SIMULATED_RESULT_SHIPPED'");
  });
});

describe('our own templates never trip it — or every build would carry a false disclosure', () => {
  it('every golden scaffold scans clean', async () => {
    const { GOLDEN_SCAFFOLDS } = await import('../src/server/AgentV3/goldenScaffolds/registry');
    const sources = (GOLDEN_SCAFFOLDS as unknown as Array<{ id: string; appTsx: string }>).map((g) => g.appTsx);
    expect(sources.filter((s) => typeof s === 'string' && s.length > 200).length).toBeGreaterThan(10); // really read
    const hits = (GOLDEN_SCAFFOLDS as unknown as Array<{ id: string; appTsx: string }>)
      .flatMap((g) => scanAuthenticity('src/App.tsx', g.appTsx).filter((i) => i.kind === 'simulated-result').map((i) => `${g.id}:${i.line}`));
    expect(hits).toEqual([]);
  });
});
