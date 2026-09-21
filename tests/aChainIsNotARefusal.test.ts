import { describe, it, expect } from 'vitest';
import {
  canPrefixEnv,
  prefixEnvOnChainedServer,
  startsADevServer,
  hasSeparatorInsideQuotes,
  isNodeServerCommand,
  pinDevServerPort,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

/**
 * A CHAIN IS NOT A REFUSAL (autopsy `bff0bf23`, 2026-09-21).
 *
 * The admin asked it directly: *"preview port 5000 par tha, navbharatai ne 3000 par chalaya is liye
 * nahi chala"* — and then, decisively, *"yeh repo dekho batao kon se port par chalegi?"*
 *
 * 🔑 THE ANSWER, MEASURED IN THEIR OWN REPOSITORY (`aashishcpmt093-ui/mitrify`, `server/index.ts:71`):
 *
 *     const port = parseInt(process.env.PORT || "5000", 10);
 *
 * and the dev script is `NODE_ENV=development tsx server/index.ts` — which takes no `--port` flag and
 * could not honour one if it were given. So the port is whatever `PORT` says, and 5000 when nothing
 * says anything.
 *
 * 🔴 WHAT WENT WRONG, AND IT WAS NOT THE PORT WE CHOSE. `canPrefixEnv` refuses `&&`/`;` because
 * `PORT=3000 cd x && npm run dev` gives the variable to `cd` — correct shell semantics, and a wrong
 * prefix is worse than none. But the refusal returned the command with NO port at all, and for this
 * app that is not neutral: it fell back to its own 5000, that port was held, and the health check
 * spent 94 seconds over two failed restarts. The guard was right and incomplete.
 *
 * `DevServerRecovery.ts`'s `conflictPort` field already records the same class from an earlier
 * mitrify report — *"an Express server ignoring the `--port` flag we appended and taking
 * `process.env.PORT || 5000`"* — so this is the second half of a fix that was started once.
 */

describe('the guard that was right and incomplete', () => {
  it('canPrefixEnv still refuses a chain — its reasoning is untouched', () => {
    // If this ever returns true, `PORT=3000` would land on `cd` and the fix below is unnecessary
    // for the wrong reason. The refusal IS correct; it just must not be the end of the story.
    const loose = (seg: string) => isNodeServerCommand(seg) || /(?:npm|pnpm|yarn|bun)\b/.test(seg);
    expect(canPrefixEnv('cd workspace/mitrify && npm run dev', loose)).toBe(false);
    expect(canPrefixEnv('npm run dev', loose)).toBe(true);
  });
});

describe('placing the prefix on the segment that starts the server', () => {
  it('the exact command from the report gets its port', () => {
    expect(prefixEnvOnChainedServer('cd workspace/mitrify && npm run dev', 'PORT=3000'))
      .toBe('cd workspace/mitrify && PORT=3000 npm run dev');
  });

  it('🔒 `npm install && npm run dev` puts the port on the SERVER, never on the install', () => {
    // The loose predicate the un-chained path uses matches `npm install` too. In a chain the wrong
    // choice is reachable, so the narrow predicate is what decides.
    expect(prefixEnvOnChainedServer('npm install && npm run dev', 'PORT=3000'))
      .toBe('npm install && PORT=3000 npm run dev');
  });

  it('handles `;` as well as `&&`, and keeps the separator spacing as written', () => {
    expect(prefixEnvOnChainedServer('cd api ; npm start', 'PORT=3000'))
      .toBe('cd api ; PORT=3000 npm start');
  });

  it('a tsx/node server segment is recognised without a package manager', () => {
    expect(prefixEnvOnChainedServer('cd app && tsx server/index.ts', 'PORT=3000'))
      .toBe('cd app && PORT=3000 tsx server/index.ts');
  });

  it('a pipeline inside the chosen segment keeps the prefix on the server', () => {
    expect(prefixEnvOnChainedServer('cd app && npm run dev | head -60', 'PORT=3000'))
      .toBe('cd app && PORT=3000 npm run dev | head -60');
  });

  it('returns null — today\'s behaviour — when there is no chain at all', () => {
    expect(prefixEnvOnChainedServer('npm run dev', 'PORT=3000')).toBeNull();
  });

  it('returns null when no segment starts a server, rather than guessing', () => {
    expect(prefixEnvOnChainedServer('cd app && ls -la', 'PORT=3000')).toBeNull();
    expect(prefixEnvOnChainedServer('npm install && npm ci', 'PORT=3000')).toBeNull();
  });

  it('never overrides a port the command already pins', () => {
    expect(prefixEnvOnChainedServer('cd app && PORT=8080 npm run dev', 'PORT=3000')).toBeNull();
  });

  it('🔒 stands down when a separator sits inside a quoted literal', () => {
    // Splitting this on text would cut the -e program in half. Refusing leaves today's behaviour.
    expect(prefixEnvOnChainedServer(`node -e 'a && b' && npm run dev`, 'PORT=3000')).toBeNull();
  });
});

describe('the quote scanner', () => {
  it('sees a separator inside single and double quotes', () => {
    expect(hasSeparatorInsideQuotes(`node -e 'a && b'`)).toBe(true);
    expect(hasSeparatorInsideQuotes('echo "a ; b"')).toBe(true);
  });

  it('does not fire on an ordinary chain, or on quotes without separators', () => {
    expect(hasSeparatorInsideQuotes('cd x && npm run dev')).toBe(false);
    expect(hasSeparatorInsideQuotes('echo "hello world" && npm run dev')).toBe(false);
    expect(hasSeparatorInsideQuotes('')).toBe(false);
  });
});

describe('which segment starts a dev server', () => {
  it('accepts the run forms a project really uses', () => {
    for (const c of ['npm run dev', 'npm start', 'pnpm dev', 'yarn serve', 'bun run dev', 'tsx server/index.ts']) {
      expect(startsADevServer(c), c).toBe(true);
    }
  });

  it('refuses the ones that install or test rather than serve', () => {
    for (const c of ['npm install', 'npm ci', 'npm i', 'npm audit fix', 'npm test', 'yarn add react', 'cd app', 'ls'] ) {
      expect(startsADevServer(c), c).toBe(false);
    }
  });
});

describe('end to end, through the real composer (pinDevServerPort)', () => {
  // The resolved script is what tells the composer this is a plain Node server rather than a Vite
  // dev CLI — exactly what `resolvePmScript` hands it in production.
  const NODE_SCRIPT = 'NODE_ENV=development tsx server/index.ts';

  it('a chained dev command now carries the port the preview is watching', () => {
    const out = pinDevServerPort('cd workspace/mitrify && npm run dev', 3000, undefined, NODE_SCRIPT);
    expect(out).toBe('cd workspace/mitrify && PORT=3000 npm run dev');
  });

  it('🔒 an UNCHAINED command is byte-identical to before', () => {
    expect(pinDevServerPort('npm run dev', 3000, undefined, NODE_SCRIPT)).toBe('PORT=3000 npm run dev');
  });

  it('🔒 a chained command with no server segment is returned untouched', () => {
    expect(pinDevServerPort('cd app && ls -la', 3000, undefined, NODE_SCRIPT)).toBe('cd app && ls -la');
  });
});
