import { afterEach, describe, expect, it } from 'vitest';
import { isLongRunningCommand, isNodeServerCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { __resetDevServerLaunchLog, lastDevServerLaunch, recordDevServerLaunch } from '../src/server/AgentV3/devServerLaunchLog';

// 6af23429: the direct server launch stayed in foreground until the 300.003s command deadline;
// the later collision is historical evidence, not a live process replay. These strings are never run.
const launches = [
  'npx tsx server/index.ts',
  'tsx server/index.ts',
  'npx tsx "server/index.ts"',
  'npx --yes tsx server.ts',
  'npx --no-install tsx server.ts',
  'pnpm exec tsx server/index.ts',
  'npm exec -- tsx server/index.ts',
  'npx ts-node server/index.ts',
  'node dist/server.js',
  'NODE_ENV=production node dist/server.js',
  'NODE_ENV="production" node server.js',
  'env "NODE_ENV=production" node server.js',
  'env PORT=3000 tsx server/index.ts',
  'nohup npx tsx server/index.ts > /tmp/server.log 2>&1 &',
  'exec npx tsx server/index.ts',
  'cross-env NODE_ENV=development tsx server/index.ts',
  'node --loader ts-node/esm server/index.ts',
  'tsx --tsconfig tsconfig.json server/index.ts',
  'ts-node --project tsconfig.json api/main.ts',
  'cd backend && npx tsx server/index.ts',
  '(cd backend && npx tsx server/index.ts)',
  'npx tsx server/index.ts && echo ready',
  'timeout 120 npx tsx server/index.ts',
  'timeout --foreground 120 npx tsx server/index.ts',
  'timeout --signal=TERM 120 npx tsx server/index.ts',
  'timeout -k 2 120 npx tsx server/index.ts',
  'printf "%s" "hint; harmless" && npx tsx server/index.ts',
  'printf "%s" "hint && harmless"; node server.js',
  'printf "%s" "hint || harmless" || tsx server/index.ts',
  'printf "%s" "$(printf \'%s\' \'hint; npx tsx server/index.ts; harmless\')" && node server.js',
];
const notLaunches = [
  'npx tsx scripts/seed.ts',
  'node scripts/build.ts',
  'npx tsx server/build.ts',
  'npx tsx --help',
  'npx tsx server/index.ts --help',
  'npx tsx --version server/index.ts',
  'nodemon --help server.js',
  'ts-node-dev --help server.ts',
  'node --test server.test.js',
  'tsx --test server.test.ts',
  'node --check server.js',
  'node -e "console.log(\'server\')"',
  'npx tsx -e "console.log(\'server\')"',
  'npx tsx scripts/seed.ts --label server',
  'echo "npx tsx server/index.ts"',
  'printf "%s" "npx tsx server/index.ts"',
  'cat package.json | grep "tsx server/index.ts"',
  "cat > notes.md <<'EOF'\nnpx tsx server/index.ts\nEOF",
  'timeout 5 npx tsx server/index.ts',
  'npm run build && node scripts/seed.ts',
  'git log --oneline -- server/index.ts',
  'printf "%s" "hint; npx tsx server/index.ts"',
  'printf "%s" "hint && npx tsx server/index.ts"',
  'printf "%s" "hint || npx tsx server/index.ts"',
  'node -e "console.log(\'example; npx tsx server/index.ts\')"',
  'npx tsx scripts/seed.ts --label "a; node server.js"',
  'npx tsx scripts/seed.ts --label "a && node server.js"',
  'printf hint\\; npx tsx server/index.ts',
  'timeout --help 120 npx tsx server/index.ts',
  'timeout --version 120 node server.js',
  'timeout --unknown-option 120 node server.js',
  'npx tsx "server/index.ts',
  'npx tsx server/index.ts"',
  'printf "%s" "hint; npx tsx server/index.ts; harmless"',
  'printf "%s" "$(echo \"hint; npx tsx server/index.ts; harmless\")"',
  '"NODE_ENV=production" npx tsx server/index.ts',
  'NODE_ENV\\=production npx tsx server/index.ts',
  'nohup NODE_ENV=production npx tsx server/index.ts',
  'timeout 120 NODE_ENV=production npx tsx server/index.ts',
  '# example; npx tsx server/index.ts',
  'printf "%s" done # example; npx tsx server/index.ts',
];

describe('a direct Node server receives the managed process lifecycle', () => {
  it.each(launches)('manages %s', (command) => {
    // Existing host/port policy already identifies this server family. Lifecycle must agree.
    expect(isNodeServerCommand(command)).toBe(true);
    expect(isLongRunningCommand(command)).toBe(true);
  });
  it.each(notLaunches)('does not turn a one-shot or data-only command into a server: %s', (command) => {
    expect(isLongRunningCommand(command)).toBe(false);
  });
  it('retains the watched-server and named-server-script controls', () => {
    expect(isLongRunningCommand('npx tsx watch server/index.ts')).toBe(true);
    expect(isLongRunningCommand('npm run server')).toBe(true);
    expect(isLongRunningCommand('node --watch server/index.ts')).toBe(true);
  });
});

describe('the managed server revival record shares the direct-launch boundary', () => {
  afterEach(__resetDevServerLaunchLog);

  it('records the direct server entry for later revival', () => {
    recordDevServerLaunch('q2162-direct-record', 'npx tsx server/index.ts', 3000);
    expect(lastDevServerLaunch('q2162-direct-record')).toMatchObject({ command: 'npx tsx server/index.ts', port: 3000 });
  });

  it('does not persist an inert quoted fragment as a revival command', () => {
    recordDevServerLaunch('q2162-data-record', 'printf "%s" "hint; npx tsx server/index.ts; harmless"', 3000);
    expect(lastDevServerLaunch('q2162-data-record')).toBeNull();
  });

  it('records the real later launch after quoted data containing a fake launch', () => {
    recordDevServerLaunch('q2162-chain-record', 'printf "%s" "hint; npx tsx server/index.ts; harmless" && node server.js', 3000);
    expect(lastDevServerLaunch('q2162-chain-record')).toMatchObject({ command: 'node server.js', port: 3000 });
  });

  it('keeps quoted newlines and ampersands as server arguments while dropping real probes', () => {
    const command = 'npx tsx server/index.ts --label "first\nsecond & third"';
    recordDevServerLaunch('q2162-background-record', `${command} &\necho ready`, 3000);
    expect(lastDevServerLaunch('q2162-background-record')).toMatchObject({ command, port: 3000 });
  });

  it('does not promote a substitution’s quoted text into the revival recipe', () => {
    const data = 'printf "%s" "$(printf \'%s\' \'hint; npx tsx server/index.ts; harmless\')"';
    recordDevServerLaunch('q2162-substitution-record', `${data} && node server.js`, 3000);
    expect(lastDevServerLaunch('q2162-substitution-record')).toMatchObject({ command: 'node server.js', port: 3000 });
  });

  it('does not promote a heredoc body or a comment into the revival recipe', () => {
    recordDevServerLaunch('q2162-heredoc-record', "cat > notes.md <<'EOF'\nhint; npx tsx server/index.ts; harmless\nEOF", 3000);
    expect(lastDevServerLaunch('q2162-heredoc-record')).toBeNull();
    recordDevServerLaunch('q2162-comment-record', '# example; npx tsx server/index.ts', 3000);
    expect(lastDevServerLaunch('q2162-comment-record')).toBeNull();
  });
});
