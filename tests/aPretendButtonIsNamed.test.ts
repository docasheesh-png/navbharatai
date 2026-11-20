/**
 * failedbr #2030 (2026-11-08): an image-search app shipped a Download button whose handler admitted it was pretend —
 * `// For demo purposes, we'll just show an alert` → `alert("… will be downloaded in a real application")`. Neither the
 * authenticity scan nor fakeFeatureScan named it, so a fake button shipped. The admission is the signal.
 */
import { describe, expect, it } from 'vitest';
import { scanAuthenticity } from '../src/server/AgentV3/AuthenticityAnalysis';

const kinds = (content: string): string[] => scanAuthenticity('src/components/ResultDisplay.tsx', content).map((i) => i.kind);

const REPORT = `const handleDownload = (url: string, filename: string) => {
  // In a real app, you would download the actual file
  // For demo purposes, we'll just show an alert
  alert(\`"\${filename}" will be downloaded in a real application\`);
  console.log('Download triggered for:', url);
};`;

describe('a handler that admits it is pretend is a HIGH authenticity finding', () => {
  it('the report\'s own handler', () => {
    expect(kinds(REPORT).filter((k) => k === 'demo-stand-in')).toHaveLength(2);
  });
  it.each([
    "toast('Payment would be processed in a real app');",
    '// For demonstration purposes, I will simply log it',
    'setStatus("Uploaded (for demo purposes)");',
  ])('%s', (line) => {
    expect(kinds(line)).toContain('demo-stand-in');
  });
  it.each([
    '// In a real app you would also rate-limit this endpoint',
    "const label = 'Real application form';",
    "<p className=\"demo\">Demo login — add GOOGLE_CLIENT_ID in ⋮ More → Keys & Secrets to make it real (in a real app this signs you in)</p>",
  ])('not flagged: %s', (line) => {
    expect(kinds(line)).not.toContain('demo-stand-in');
  });
});
