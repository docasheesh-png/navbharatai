/**
 * Q-153: a command the agent ran — `node scripts/seed.js` — never saw the app's `.env`, so a script reading
 * `process.env.DATABASE_URL` without dotenv crashed although the value was right there, and the agent spent
 * turns "fixing" a correct script. The fix is deliberately narrow (see appEnvFileForCommand.ts): one shape,
 * Node's own `--env-file`, the environment always wins, and an install is never touched.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { withAppEnvFile } from '../src/server/AgentV3/appEnvFileForCommand';

const ON = {} as NodeJS.ProcessEnv;

describe('which commands get the app\'s .env', () => {
  it('one script, run by node or tsx', () => {
    for (const c of ['node scripts/seed.js', 'node seed.mjs --force', 'npx tsx src/db/migrate.ts', 'tsx scripts/import-data.ts users.csv']) {
      expect(withAppEnvFile(c, ON), c).toMatch(/^if \[ -f \.env \]; then (node|tsx|npx tsx) --env-file=\.env /);
    }
  });

  it('an npm task that is not a build, server, test or install hook — npm itself reads the file', () => {
    for (const c of ['npm run seed', 'npm run db:seed', 'npm run migrate -- --force', 'npm run import:users data.csv']) {
      expect(withAppEnvFile(c, ON), c).toMatch(/^if \[ -f \.env \] && NB_NPM=.* then node --env-file=\.env "\$NB_NPM" run /);
    }
    for (const c of ['npm run build', 'npm run dev', 'npm run start', 'npm run test', 'npm run test:e2e', 'npm run lint', 'npm run preview', 'npm run postinstall', 'npm run seed && npm run dev']) {
      expect(withAppEnvFile(c, ON), c).toBe(c);
    }
  });

  it('never an install, a pipeline, a chain, an inline program, or a script that already names a file', () => {
    for (const c of ['npm install', 'npm ci', 'npm i express', 'node -e "console.log(1)"', 'node seed.js && npm test',
      'node seed.js | tee log', 'node --env-file=.env seed.js', 'node seed.js --env-file=x', 'node seed.js &', 'cd server && node seed.js',
      'node $(echo seed.js)', 'npx prisma db push']) {
      expect(withAppEnvFile(c, ON), c).toBe(c);
    }
  });

  it('the kill switch returns every command untouched', () => {
    expect(withAppEnvFile('node seed.js', { AGENTV3_AGENT_CMD_ENV_FILE: 'off' } as NodeJS.ProcessEnv)).toBe('node seed.js');
  });

  it('the bash tool runs every command through it', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toContain('this.actuator.runCommand(this.workspaceId, withAppEnvFile(background.command))');
  });
});

describe('for real, in a shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nbai-envfile-'));
  writeFileSync(join(dir, 'seed.js'), 'console.log(JSON.stringify({ db: process.env.DATABASE_URL ?? null, env: process.env.NODE_ENV ?? null, keep: process.env.KEEP ?? null }))');
  const run = (cmd: string, extra: Record<string, string> = {}) => {
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extra };
    return JSON.parse(execFileSync('sh', ['-c', cmd], { cwd: dir, env, encoding: 'utf8' }).trim());
  };

  it('without a .env the script runs exactly as before', () => {
    expect(run(withAppEnvFile('node seed.js', ON))).toEqual({ db: null, env: null, keep: null });
  });

  it('with one, the script reads it — and a value the environment already sets wins', () => {
    writeFileSync(join(dir, '.env'), 'DATABASE_URL="postgres://u:p@localhost:5432/app"\nKEEP=from-file\n# a comment\n');
    expect(run(withAppEnvFile('node seed.js', ON))).toEqual({ db: 'postgres://u:p@localhost:5432/app', env: null, keep: 'from-file' });
    expect(run(withAppEnvFile('node seed.js', ON), { KEEP: 'from-sandbox' }).keep).toBe('from-sandbox');
  });

  it('an npm task gets the values too, and a value the environment already sets still wins', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: { seed: 'node seed.js' } }));
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://from-file\nNODE_ENV=production\nKEEP=from-file\n');
    const out = run(withAppEnvFile('npm run seed --silent', ON), { KEEP: 'from-sandbox' });
    expect(out).toEqual({ db: 'postgres://from-file', env: 'production', keep: 'from-sandbox' });
  });

  it('the exit code is the script\'s own', () => {
    writeFileSync(join(dir, 'fail.js'), 'process.exit(3)');
    let code = 0;
    try { execFileSync('sh', ['-c', withAppEnvFile('node fail.js', ON)], { cwd: dir }); } catch (e) { code = (e as { status: number }).status; }
    expect(code).toBe(3);
  });
});
