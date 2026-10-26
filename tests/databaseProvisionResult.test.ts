import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { databaseProvisionResult, DATABASE_PROVISION_RECOVERY } from '../src/lib/databaseProvisionResult';

const connected = { ok: true, projectRef: 'test-project', url: 'https://test-project.supabase.co', schemaApplied: true };

describe('database provisioning acknowledges readiness, not just HTTP acceptance', () => {
  it.each([
    { error: 'The project is still starting.', failure: 'timeout', projectRef: 'test-project' },
    { error: 'Its credentials could not be read yet.', projectRef: 'test-project' },
    connected, null,
  ])('never promotes a 202 to a connected database (%j)', (body) => {
    const result = databaseProvisionResult(202, body);
    expect(new Response(null, { status: 202 }).ok).toBe(true); // the old callers' false-success guard
    expect(result).toMatchObject({ kind: 'pending' });
    expect('message' in result && result.message).toContain(DATABASE_PROVISION_RECOVERY);
    expect('database' in result).toBe(false);
  });

  it.each([true, false, null])('keeps connection and schema readiness separate (%s)', (schemaApplied) => {
    const body = { ...connected, schemaApplied };
    expect(databaseProvisionResult(200, body)).toEqual({ kind: 'connected', database: body });
  });

  it('preserves reuse and sleeping-database warnings without claiming a new project', () => {
    const body = { ...connected, schemaApplied: null, reused: true, reusedNote: 'Uses your existing project.', asleepNote: 'Wake this project first.' };
    expect(databaseProvisionResult(200, body)).toEqual({ kind: 'connected', database: body });
  });

  it.each([null, {}, [], { ...connected, ok: false }, { ...connected, projectRef: '' },
    { ...connected, url: undefined }, { ...connected, schemaApplied: undefined },
    { ...connected, reused: 'true' }, { ...connected, schemaNote: {} },
  ])('fails closed on a malformed success without inviting a duplicate create (%j)', (body) => {
    expect(databaseProvisionResult(200, body)).toMatchObject({ kind: 'unconfirmed' });
  });

  it.each([400, 401, 403, 409, 429])('preserves a real pre-create HTTP %s refusal', (status) => {
    expect(databaseProvisionResult(status, { error: 'Reconnect your account.' }))
      .toEqual({ kind: 'failed', message: 'Reconnect your account.' });
  });

  it.each([
    [500, { projectRef: 'existing-project', error: 'Database created, but its keys could not be saved.' }],
    [502, { error: 'The creation acknowledgement could not be read.', failure: 'api-error' }],
    [503, null],
    [409, { projectRef: 'existing-project', error: 'A project already exists.' }],
  ])('locks uncertain/resource-bearing HTTP %s responses against another create', (status, body) => {
    expect(databaseProvisionResult(Number(status), body)).toMatchObject({ kind: 'unconfirmed' });
  });
});

describe('every database-provision UI caller uses the same result and duplicate-action boundary', () => {
  it('Publish keeps schema/reuse feedback visible after connection and preserves a sleeping-project warning', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/agentv3/HostingChooser.tsx'), 'utf8');
    expect(source).toContain('dataGate?.connected && (dbNote || dbBusy)');
    expect(source).toContain("data.asleepNote || 'You can publish now.'");
    expect(source).toContain('migrations on this existing database before publishing');
  });

  it('finds every client caller so a new sibling cannot bypass the result check', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'server' ? [] : walk(path);
      return /\.(ts|tsx)$/.test(path) && !path.includes('.test.') ? [path] : [];
    });
    const callers = walk('src').filter((file) => readFileSync(file, 'utf8').includes("'/api/integrations/supabase/provision'"));
    expect(callers.sort()).toEqual([
      'src/components/agentv3/HostingChooser.tsx',
      'src/components/settings/SupabaseConnectCard.tsx',
    ]);
    for (const file of callers) expect(readFileSync(file, 'utf8')).toContain('databaseProvisionResult(res.status,');
  });

  for (const [file, latch, success] of [
    ['src/components/agentv3/HostingChooser.tsx', 'dbCreateInFlight', 'setDataGate((g)'],
    ['src/components/settings/SupabaseConnectCard.tsx', 'createInFlight', 'onProvisioned?.()'],
  ]) {
    it(file, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const start = source.indexOf('const createDatabase = async');
      const end = source.indexOf('\n  };', start);
      const handler = source.slice(start, end);
      expect(handler).toContain(`${latch}.current`);
      expect(handler.indexOf(`${latch}.current = true`)).toBeLessThan(handler.indexOf('await authedFetch('));
      expect(handler).toContain('databaseProvisionResult(res.status,');
      const guard = handler.indexOf("if (result.kind !== 'connected')");
      expect(guard).toBeGreaterThan(-1);
      expect(handler.indexOf('return;', guard)).toBeLessThan(handler.indexOf(success));
      expect(handler).toContain(`${latch}.current = !outcomeConfirmed`);
      expect(handler).toContain('DATABASE_PROVISION_UNCONFIRMED');
      expect(handler.match(/await authedFetch\(/g)).toHaveLength(1);
    });
  }
});
