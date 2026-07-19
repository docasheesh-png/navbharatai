import { describe, it, expect } from 'vitest';
import { generateSchedulerIntegration } from './SchedulerGenerator';

describe('generateSchedulerIntegration', () => {
  const c = generateSchedulerIntegration();
  const server = c.files['server/lib/scheduler.ts'];

  it('emits scheduleEvery + scheduleDailyUtc + msUntilDailyUtc, dependency-free and server-side', () => {
    expect(server).toContain('export function scheduleEvery(');
    expect(server).toContain('export function scheduleDailyUtc(');
    expect(server).toContain('export function msUntilDailyUtc(');
    expect(server).not.toContain('import ');
    expect(server).not.toContain('node-cron');
    expect(c.files['src/lib/scheduler.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('isolates errors so one thrown run never stops the schedule', () => {
    expect(server).toContain('async function runIsolated(');
    expect(server).toContain('catch (err)');
    expect(server).toContain("console.error('[scheduler] job failed:'");
  });

  it('the daily job recomputes its next run (no 24h-interval drift)', () => {
    expect(server).toContain('arm(); // recompute the next day from a fresh clock — no drift');
    expect(server).toContain('next.setUTCDate(next.getUTCDate() + 1)'); // rolls to tomorrow when past
  });

  it('validates inputs (positive interval, 0-23 hour, 0-59 minute)', () => {
    expect(server).toContain('intervalMs must be > 0');
    expect(server).toContain('hour must be 0-23');
    expect(server).toContain('minute must be 0-59');
  });

  it('is honest about scope (in-process only) and never writes .env.example', () => {
    expect(c.instructions.toLowerCase()).toContain('external scheduler');
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/scheduler.ts']);
  });
});
