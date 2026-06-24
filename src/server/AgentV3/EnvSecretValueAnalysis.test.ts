import { describe, it, expect } from 'vitest';
import { scanEnvTemplateSecrets, isEnvTemplateFile, envTemplateSecretSummary } from './EnvSecretValueAnalysis';

describe('isEnvTemplateFile', () => {
  it('matches env templates, not a real .env or code', () => {
    expect(isEnvTemplateFile('.env.example')).toBe(true);
    expect(isEnvTemplateFile('config/.env.sample')).toBe(true);
    expect(isEnvTemplateFile('.env.template')).toBe(true);
    expect(isEnvTemplateFile('.env')).toBe(false);
    expect(isEnvTemplateFile('src/config.ts')).toBe(false);
  });
});

describe('scanEnvTemplateSecrets', () => {
  it('flags a real OpenAI/Anthropic-style key committed in .env.example', () => {
    const issues = scanEnvTemplateSecrets('.env.example', 'OPENAI_API_KEY=sk-proj-AbCdEf0123456789ghIJklMNop');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'OPENAI_API_KEY', line: 1, kind: 'openai/anthropic key' });
  });

  it('flags AWS, GitHub, Google, Stripe, Slack and JWT formats', () => {
    const lines = [
      'AWS_KEY=AKIAZ4XY7QWERTY12345',
      'GH_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      'GOOGLE=AIzaSyA0123456789abcdefghijklmnopqrstuvw',
      'STRIPE=sk_live_0123456789abcdefghij',
      'SLACK=xoxb-0123456789-abcdefghij',
      'TOKEN=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4',
    ].join('\n');
    const issues = scanEnvTemplateSecrets('.env.example', lines);
    expect(issues.map((i) => i.key).sort()).toEqual(['AWS_KEY', 'GH_TOKEN', 'GOOGLE', 'SLACK', 'STRIPE', 'TOKEN']);
  });

  it('does NOT flag placeholder values', () => {
    const lines = [
      'OPENAI_API_KEY=your-openai-key-here',
      'AWS_KEY=<your-aws-key>',
      'TOKEN=changeme',
      'SECRET=xxxxxxxxxxxxxxxx',
      'URL=https://example.com',
      'EMPTY=',
      '# COMMENT=sk-realbutcommentedline123456',
    ].join('\n');
    expect(scanEnvTemplateSecrets('.env.example', lines)).toEqual([]);
  });

  it('does not scan a real .env (handled by the secret-leak check) or code files', () => {
    expect(scanEnvTemplateSecrets('.env', 'OPENAI_API_KEY=sk-proj-AbCdEf0123456789ghIJklMNop')).toEqual([]);
    expect(scanEnvTemplateSecrets('src/config.ts', 'const k = "sk-proj-AbCdEf0123456789ghIJklMNop";')).toEqual([]);
  });

  it('handles export prefix and quoted values', () => {
    expect(scanEnvTemplateSecrets('.env.example', 'export KEY="sk-proj-AbCdEf0123456789ghIJklMNop"')[0].key).toBe('KEY');
  });
});

describe('envTemplateSecretSummary', () => {
  it('renders the clean line and the warning line', () => {
    expect(envTemplateSecretSummary([])).toContain('✓');
    const out = envTemplateSecretSummary(scanEnvTemplateSecrets('.env.example', 'K=sk-proj-AbCdEf0123456789ghIJklMNop'));
    expect(out).toContain('REAL secret value');
    expect(out).toContain('.env.example:1');
  });
});
