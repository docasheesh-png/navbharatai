import { describe, it, expect } from 'vitest';
import { BackendScaffolder } from '../src/server/EngineerAI/BackendScaffolder';
import type { IEngineerActuator } from '../src/server/EngineerAI/actuators/IEngineerActuator';
import type { DbProviderConfig } from '../src/server/EngineerAI/EngineerAITypes';

function makeActuator(): IEngineerActuator & { files: Record<string, string> } {
  const files: Record<string, string> = {};
  return {
    files,
    writeFile: async (_ws: string, path: string, content: string) => { files[path] = content; },
    readFile: async (_ws: string, path: string) => files[path] ?? '',
  } as any;
}

describe('BackendScaffolder.scaffold', () => {
  const scaffolder = new BackendScaffolder();

  it('supabase: writes src/lib/supabase.ts and .env', async () => {
    const act = makeActuator();
    const result = await scaffolder.scaffold('ws-1', { provider: 'supabase', credentials: { url: 'https://x.supabase.co', anonKey: 'anon123' } }, act);
    expect(result.filesWritten).toContain('src/lib/supabase.ts');
    expect(act.files['src/lib/supabase.ts']).toContain('createClient');
  });

  it('firebase: writes src/lib/firebase.ts and includes initializeApp', async () => {
    const act = makeActuator();
    const cfg: DbProviderConfig = { provider: 'firebase', credentials: { apiKey: 'abc', projectId: 'my-proj' } };
    const result = await scaffolder.scaffold('ws-1', cfg, act);
    expect(act.files['src/lib/firebase.ts']).toContain('initializeApp');
    expect(result.npmPackages).toContain('firebase');
  });

  it('mongodb: writes src/lib/mongodb.ts', async () => {
    const act = makeActuator();
    const result = await scaffolder.scaffold('ws-1', { provider: 'mongodb', credentials: { uri: 'mongodb+srv://...' } }, act);
    expect(act.files['src/lib/mongodb.ts']).toContain('MongoClient');
    expect(result.npmPackages).toContain('mongodb');
  });

  it('neon: writes src/lib/db.ts with neon serverless import', async () => {
    const act = makeActuator();
    const result = await scaffolder.scaffold('ws-1', { provider: 'neon', credentials: { connectionString: 'postgres://...' } }, act);
    expect(act.files['src/lib/db.ts']).toContain('@neondatabase/serverless');
  });

  it('appwrite: writes src/lib/appwrite.ts', async () => {
    const act = makeActuator();
    const result = await scaffolder.scaffold('ws-1', { provider: 'appwrite', credentials: { endpoint: 'https://x.appwrite.io', projectId: 'proj1' } }, act);
    expect(act.files['src/lib/appwrite.ts']).toContain('appwrite');
  });

  it('other: writes only .env (no SDK file)', async () => {
    const act = makeActuator();
    const result = await scaffolder.scaffold('ws-1', { provider: 'other', credentials: { apiKey: 'my-custom-key' } }, act);
    expect(result.filesWritten).toContain('.env');
    expect(result.npmPackages).toHaveLength(0);
  });

  it('appends to existing .env without overwriting', async () => {
    const act = makeActuator();
    act.files['.env'] = 'EXISTING_VAR=hello\n';
    await scaffolder.scaffold('ws-1', { provider: 'neon', credentials: { connectionString: 'pg://...' } }, act);
    expect(act.files['.env']).toContain('EXISTING_VAR=hello');
    expect(act.files['.env']).toContain('DATABASE_URL=pg://...');
  });
});
