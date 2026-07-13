// P-CGE.9 — Dockerfile + CI/CD Pipeline Generators (for generated apps).
//
// Pure, dependency-free generators that emit deployment artifacts for a generated app:
//   • generateDockerfile     — a production Dockerfile (alpine, multi-stage, non-root user)
//   • generateDockerCompose  — a docker-compose.yml for local run
//   • generateCiWorkflow     — a GitHub Actions workflow (install → lint → test → build)
//
// HONESTY: the artifacts only contain steps the input declares. A CI workflow with no lint
// command simply omits the lint step — no placeholder step that would fail or no-op silently.

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

export interface DockerOptions {
  nodeVersion?: string;     // e.g. '20' (ignored for bun, which uses the oven/bun image)
  port?: number;            // exposed port
  installCmd?: string;      // default: the manager's frozen-lockfile install
  buildCmd?: string;        // e.g. npm run build (omitted if empty)
  startCmd?: string;        // default: `<manager> start`
  /** Multi-stage build (build stage + slim runtime). Default true. */
  multiStage?: boolean;
  /** Project package manager (default 'npm') — drives base image, lockfile COPY, install + start. */
  packageManager?: PackageManager;
}

/** Default `<manager> start` runtime command per package manager. */
const PM_START: Record<PackageManager, string> = {
  npm: 'npm start', yarn: 'yarn start', pnpm: 'pnpm start', bun: 'bun start',
};

/** The COPY line that brings in the manifest + the manager's lockfile (glob-tolerant so a missing lock still builds). */
function pmLockCopy(pm: PackageManager): string {
  switch (pm) {
    case 'yarn': return 'COPY package.json yarn.lock* ./';
    case 'pnpm': return 'COPY package.json pnpm-lock.yaml* ./';
    case 'bun': return 'COPY package.json bun.lock* bun.lockb* ./';
    default: return 'COPY package*.json ./';
  }
}

/** Generate a production Dockerfile (alpine, non-root, optional multi-stage), correct for the manager. */
export function generateDockerfile(opts: DockerOptions = {}): string {
  const pm: PackageManager = opts.packageManager && opts.packageManager in PM_INSTALL ? opts.packageManager : 'npm';
  const node = clean(opts.nodeVersion) || '20';
  const port = typeof opts.port === 'number' && opts.port > 0 ? opts.port : 8080;
  const install = clean(opts.installCmd) || PM_INSTALL[pm];
  const build = clean(opts.buildCmd);
  const start = clean(opts.startCmd) || PM_START[pm];
  // Bun ships its own runtime image; npm/yarn/pnpm run on node. pnpm & yarn are provided via corepack
  // (bundled with node) which must be enabled in EACH stage that uses the manager.
  const base = pm === 'bun' ? `oven/bun:1-alpine` : `node:${node}-alpine`;
  const user = pm === 'bun' ? 'bun' : 'node';
  const corepack = pm === 'pnpm' || pm === 'yarn';
  const lockCopy = pmLockCopy(pm);
  const installRun = corepack ? `RUN corepack enable && ${install}` : `RUN ${install}`;
  const lines: string[] = [];

  if (opts.multiStage !== false) {
    lines.push(
      `# syntax=docker/dockerfile:1`,
      `FROM ${base} AS build`,
      `WORKDIR /app`,
      lockCopy,
      installRun,
      `COPY . .`,
      ...(build ? [`RUN ${build}`] : []),
      ``,
      `FROM ${base} AS runtime`,
      `WORKDIR /app`,
      `ENV NODE_ENV=production`,
      `COPY --from=build /app ./`,
      // The runtime CMD is `<manager> start`, so pnpm/yarn must be available here too.
      ...(corepack ? [`RUN corepack enable`] : []),
      `# Run as a non-root user for security`,
      `USER ${user}`,
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(start.split(/\s+/))}`,
    );
  } else {
    lines.push(
      `FROM ${base}`,
      `WORKDIR /app`,
      `ENV NODE_ENV=production`,
      lockCopy,
      installRun,
      `COPY . .`,
      ...(build ? [`RUN ${build}`] : []),
      `USER ${user}`,
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(start.split(/\s+/))}`,
    );
  }
  return lines.join('\n') + '\n';
}

export interface ComposeOptions {
  serviceName?: string;
  port?: number;
  env?: string[];
  /** Project dependency names — used to add the backing DB/cache services the app actually needs. */
  dependencies?: string[];
}

interface DbService {
  key: string;
  image: string;
  port: number;
  /** Connection env var the APP service gets so it can reach this service on the compose network. */
  appEnv: string;
  /** Env vars the DB service itself needs (credentials/db name). */
  env?: Record<string, string>;
  /** [namedVolume, mountPath] for durable data. */
  volume?: [string, string];
}

/** Map a dependency (npm driver) to the backing service its app needs. First match per service key wins. */
const DB_MATCHERS: Array<{ re: RegExp; make: () => DbService }> = [
  { re: /^(mongoose|mongodb)$/, make: () => ({ key: 'mongo', image: 'mongo:7', port: 27017, appEnv: 'MONGO_URL=mongodb://mongo:27017/app', volume: ['mongo-data', '/data/db'] }) },
  { re: /^(pg|postgres|postgresql)$/, make: () => ({ key: 'postgres', image: 'postgres:16-alpine', port: 5432, appEnv: 'DATABASE_URL=postgres://postgres:postgres@postgres:5432/app', env: { POSTGRES_PASSWORD: 'postgres', POSTGRES_DB: 'app' }, volume: ['postgres-data', '/var/lib/postgresql/data'] }) },
  { re: /^(mysql|mysql2)$/, make: () => ({ key: 'mysql', image: 'mysql:8', port: 3306, appEnv: 'DATABASE_URL=mysql://root:root@mysql:3306/app', env: { MYSQL_ROOT_PASSWORD: 'root', MYSQL_DATABASE: 'app' }, volume: ['mysql-data', '/var/lib/mysql'] }) },
  { re: /^(redis|ioredis)$/, make: () => ({ key: 'redis', image: 'redis:7-alpine', port: 6379, appEnv: 'REDIS_URL=redis://redis:6379' }) },
];

/** The distinct backing services the dependency list implies (deduped by service key). Pure. */
function detectDbServices(deps: ReadonlyArray<string>): DbService[] {
  const seen = new Set<string>();
  const out: DbService[] = [];
  for (const d of deps || []) {
    const name = clean(d).toLowerCase();
    for (const m of DB_MATCHERS) {
      if (m.re.test(name)) { const s = m.make(); if (!seen.has(s.key)) { seen.add(s.key); out.push(s); } }
    }
  }
  return out;
}

/** Generate a docker-compose.yml for local run — including the backing DB/cache services the app needs. */
export function generateDockerCompose(opts: ComposeOptions = {}): string {
  const name = (clean(opts.serviceName) || 'app').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'app';
  const port = typeof opts.port === 'number' && opts.port > 0 ? opts.port : 8080;
  const dbs = detectDbServices(opts.dependencies || []);
  // The app's env: its declared env + a connection string for each detected backing service.
  const env = [...dbs.map((d) => d.appEnv), ...(opts.env || []).map(clean).filter(Boolean)];

  const lines: string[] = [
    `services:`,
    `  ${name}:`,
    `    build: .`,
    `    ports:`,
    `      - "${port}:${port}"`,
  ];
  if (env.length) {
    lines.push(`    environment:`);
    for (const e of env) lines.push(`      - ${e}`);
  }
  if (dbs.length) {
    lines.push(`    depends_on:`);
    for (const d of dbs) lines.push(`      - ${d.key}`);
  }
  lines.push(`    restart: unless-stopped`);

  // Each backing service.
  for (const d of dbs) {
    lines.push(`  ${d.key}:`, `    image: ${d.image}`, `    ports:`, `      - "${d.port}:${d.port}"`);
    if (d.env) {
      lines.push(`    environment:`);
      for (const [k, v] of Object.entries(d.env)) lines.push(`      ${k}: ${v}`);
    }
    if (d.volume) lines.push(`    volumes:`, `      - ${d.volume[0]}:${d.volume[1]}`);
    lines.push(`    restart: unless-stopped`);
  }

  // Top-level named volumes for the DBs that declared one.
  const volumes = dbs.map((d) => d.volume?.[0]).filter((v): v is string => !!v);
  if (volumes.length) {
    lines.push(`volumes:`);
    for (const v of volumes) lines.push(`  ${v}:`);
  }

  return lines.join('\n') + '\n';
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface CiOptions {
  nodeVersion?: string;
  installCmd?: string;
  lintCmd?: string;
  testCmd?: string;
  buildCmd?: string;
  /**
   * The project's package manager (default 'npm'). Drives the install command, the setup action, and
   * the dependency cache so the generated CI matches the project's lockfile — a pnpm/yarn/bun project no
   * longer gets a broken `npm ci` + `cache: 'npm'` workflow.
   */
  packageManager?: PackageManager;
}

/** The reproducible (lockfile-frozen) install command per manager — used when no explicit installCmd is given. */
const PM_INSTALL: Record<PackageManager, string> = {
  npm: 'npm ci',
  yarn: 'yarn install --frozen-lockfile',
  pnpm: 'pnpm install --frozen-lockfile',
  bun: 'bun install --frozen-lockfile',
};

/** Generate a GitHub Actions CI workflow (install → lint → test → build, steps as declared). */
export function generateCiWorkflow(opts: CiOptions = {}): string {
  const pm: PackageManager = opts.packageManager && opts.packageManager in PM_INSTALL ? opts.packageManager : 'npm';
  const node = clean(opts.nodeVersion) || '20';
  const install = clean(opts.installCmd) || PM_INSTALL[pm];
  const steps: Array<{ name: string; run: string }> = [{ name: 'Install', run: install }];
  if (clean(opts.lintCmd)) steps.push({ name: 'Lint', run: clean(opts.lintCmd) });
  if (clean(opts.testCmd)) steps.push({ name: 'Test', run: clean(opts.testCmd) });
  if (clean(opts.buildCmd)) steps.push({ name: 'Build', run: clean(opts.buildCmd) });

  const lines: string[] = [
    `name: CI`,
    `on:`,
    `  push:`,
    `    branches: [ main ]`,
    `  pull_request:`,
    `jobs:`,
    `  build:`,
    `    runs-on: ubuntu-latest`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
  ];
  if (pm === 'bun') {
    // Bun brings its own toolchain; setup-node's npm cache does not apply.
    lines.push(`      - uses: oven-sh/setup-bun@v2`);
  } else {
    // pnpm must be installed BEFORE setup-node so its 'pnpm' cache can resolve the store.
    if (pm === 'pnpm') {
      lines.push(`      - uses: pnpm/action-setup@v4`, `        with:`, `          version: 9`);
    }
    lines.push(
      `      - uses: actions/setup-node@v4`,
      `        with:`,
      `          node-version: '${node}'`,
      `          cache: '${pm}'`,
    );
  }
  for (const s of steps) {
    lines.push(`      - name: ${s.name}`, `        run: ${s.run}`);
  }
  return lines.join('\n') + '\n';
}

export interface DeployArtifactInput {
  docker?: DockerOptions;
  compose?: ComposeOptions;
  ci?: CiOptions;
}

/**
 * Generate a `.dockerignore`. Without it, the Dockerfile's `COPY . .` ships node_modules (huge, and
 * host-built native modules break in the image), .git, build output AND .env secrets into the image —
 * bloated, slow, and a secret-leak. `.env.example` is kept (it's a safe template). Pure + deterministic.
 */
export function generateDockerignore(): string {
  return [
    'node_modules',
    '.git',
    '.gitignore',
    'dist',
    'build',
    '.env',
    '.env.*',
    '!.env.example',
    '*.log',
    'npm-debug.log*',
    'coverage',
    '.DS_Store',
    '.vscode',
    '.idea',
    '.next',
    '.turbo',
    '*.tsbuildinfo',
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    '',
  ].join('\n');
}

export interface DeployArtifactOutput {
  dockerfile?: string;
  dockerignore?: string;
  dockerCompose?: string;
  ciWorkflow?: string;
}

/** Generate whatever deployment artifacts the input requests. Pure. */
export function generateDeployArtifacts(input: DeployArtifactInput): DeployArtifactOutput {
  const out: DeployArtifactOutput = {};
  // A Dockerfile without a .dockerignore copies node_modules/.git/.env into the image — always pair them.
  if (input.docker) { out.dockerfile = generateDockerfile(input.docker); out.dockerignore = generateDockerignore(); }
  if (input.compose) out.dockerCompose = generateDockerCompose(input.compose);
  if (input.ci) out.ciWorkflow = generateCiWorkflow(input.ci);
  return out;
}
