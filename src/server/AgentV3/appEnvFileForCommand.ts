/**
 * THE APP'S OWN SCRIPT SEES THE APP'S OWN `.env` (queue Q-153).
 *
 * The dev server is started with the project's `.env` loaded (E2BActuator), and `envLoading.ts` wires
 * `dotenv` into a server entry that needs it. A command the AGENT runs got neither: `node scripts/seed.js`
 * reading `process.env.DATABASE_URL` without dotenv crashed on `undefined` although `.env` held the value,
 * and the agent then spent turns "fixing" a script that was right.
 *
 * WHY ONLY THESE SHAPES, AND WHY NODE'S OWN FLAG. Loading `.env` into EVERY command is the tempting fix and
 * a wrong one: a `.env` holding `NODE_ENV=production` would make the agent's own `npm install` skip
 * devDependencies and break the build. So this touches two shapes, each the WHOLE command:
 *   • `node <file>` / `tsx <file>` running the app's own script;
 *   • `npm run <task>` for a task that is not the app's build, dev server, tests or install hooks — npm
 *     itself is started under `node --env-file`, so the task inherits the values (`npm run seed`).
 * Node's `--env-file` reads the file with dotenv's syntax (not the shell's) and never overrides a variable
 * the environment already sets. Anything else (pipes, `&&`, installs, a flag already given) is returned
 * untouched, and every rewrite falls back to the original command when `.env` is absent — or, for npm,
 * when npm is not the plain Node script this relies on. Kill switch: `AGENTV3_AGENT_CMD_ENV_FILE=off`. PURE.
 */

const SCRIPT = String.raw`[\w@./-]+\.(?:c|m)?(?:j|t)sx?`;
const ARGS = String.raw`(?:\s+[\w@./:=,+-]+)*`;
/** `node <file> [simple args]`, `tsx <file>`, `npx tsx <file>` — and nothing else. */
const ONE_SCRIPT = new RegExp(String.raw`^(node|tsx|npx\s+tsx|npx\s+--yes\s+tsx)\s+(${SCRIPT})(${ARGS})\s*$`);

/** `npm run <task> [-- simple args]` */
const NPM_RUN = new RegExp(String.raw`^npm\s+run(?:-script)?\s+([\w:.-]+)((?:\s+--)?${ARGS})\s*$`);
/** Tasks that build, serve, test or install — the ones a `.env` value like NODE_ENV could change. */
const NPM_TASKS_LEFT_ALONE = /^(?:build|dev|start|serve|preview|watch|test|lint|typecheck|type-check|format|install|preinstall|postinstall|prepare|prepublish|clean)(?::|$)/;

export function appEnvFileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_AGENT_CMD_ENV_FILE ?? '').trim().toLowerCase() !== 'off';
}

export function withAppEnvFile(command: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!appEnvFileEnabled(env)) return command;
  const npm = NPM_RUN.exec(command.trim());
  if (npm) {
    if (NPM_TASKS_LEFT_ALONE.test(npm[1]) || /--env-file/.test(npm[2])) return command;
    return `if [ -f .env ] && NB_NPM="$(readlink -f "$(command -v npm)")" && [ "\${NB_NPM##*/}" = npm-cli.js ]; then node --env-file=.env "$NB_NPM" run ${npm[1]}${npm[2]}; else ${command.trim()}; fi`;
  }
  const m = ONE_SCRIPT.exec(command.trim());
  if (!m) return command;
  const [, runner, script, args] = m;
  if (/(?:^|\s)--env-file/.test(args)) return command;
  const flagged = `${runner} --env-file=.env ${script}${args}`;
  return `if [ -f .env ]; then ${flagged}; else ${command.trim()}; fi`;
}
