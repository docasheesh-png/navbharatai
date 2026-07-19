import { describe, it, expect } from 'vitest';
import { generateDateTimeIntegration } from './DateTimeGenerator';

describe('generateDateTimeIntegration', () => {
  const c = generateDateTimeIntegration();
  const server = c.files['server/lib/datetime.ts'];

  it('emits the IST formatters + relativeTime, dependency-free and server-side', () => {
    expect(server).toContain('export function formatIstDate(');
    expect(server).toContain('export function formatIstTime(');
    expect(server).toContain('export function formatIstDateTime(');
    expect(server).toContain('export function relativeTime(');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/datetime.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('pins the timezone to IST explicitly (fixes the UTC-server bug)', () => {
    expect(server).toContain("const TZ = 'Asia/Kolkata'");
    expect(server).toContain('timeZone: TZ');
  });

  it('guards invalid dates instead of rendering "Invalid Date"', () => {
    expect(server).toContain('Number.isNaN(d.getTime())');
    expect(server).toContain("return ''");
  });

  it('relativeTime is deterministic (accepts an injectable now) and uses Intl.RelativeTimeFormat', () => {
    expect(server).toContain('Intl.RelativeTimeFormat');
    expect(server).toContain('now: Date | string | number = new Date()');
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/datetime.ts']);
    expect(c.instructions.toLowerCase()).toContain('ist');
  });
});
