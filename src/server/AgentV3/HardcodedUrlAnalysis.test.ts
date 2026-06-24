import { describe, it, expect } from 'vitest';
import { scanHardcodedUrls, hardcodedUrlSummary } from './HardcodedUrlAnalysis';

describe('scanHardcodedUrls', () => {
  it('flags a hardcoded localhost API URL', () => {
    const issues = scanHardcodedUrls('src/api.ts', "const API = 'http://localhost:3000/api';");
    expect(issues).toHaveLength(1);
    expect(issues[0].url).toBe('http://localhost:3000');
    expect(issues[0].line).toBe(1);
  });

  it('flags 127.0.0.1 too', () => {
    expect(scanHardcodedUrls('src/a.ts', "fetch('http://127.0.0.1:8080/x')")).toHaveLength(1);
  });

  it('does NOT flag an env-var fallback default', () => {
    const issues = scanHardcodedUrls('src/api.ts', "const API = process.env.API_URL || 'http://localhost:3000';");
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag import.meta.env fallbacks', () => {
    const issues = scanHardcodedUrls('src/a.ts', "const u = import.meta.env.VITE_API ?? 'http://localhost:5173';");
    expect(issues).toHaveLength(0);
  });

  it('ignores comments and non-code files', () => {
    expect(scanHardcodedUrls('src/a.ts', "// http://localhost:3000")).toHaveLength(0);
    expect(scanHardcodedUrls('README.md', "http://localhost:3000")).toHaveLength(0);
  });

  it('does not flag a real production URL', () => {
    expect(scanHardcodedUrls('src/a.ts', "const API = 'https://api.example.com';")).toHaveLength(0);
  });
});

describe('hardcodedUrlSummary', () => {
  it('renders a pass line when clean', () => {
    expect(hardcodedUrlSummary([])).toContain('✓');
  });
  it('lists the offending URLs', () => {
    const out = hardcodedUrlSummary(scanHardcodedUrls('src/a.ts', "const u = 'http://localhost:3000';"));
    expect(out).toContain('break in production');
    expect(out).toContain('localhost');
  });
});
