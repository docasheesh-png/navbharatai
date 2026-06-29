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
  nodeVersion?: string;     // e.g. '20'
  port?: number;            // exposed port
  installCmd?: string;      // default: npm ci
  buildCmd?: string;        // e.g. npm run build (omitted if empty)
  startCmd?: string;        // default: npm start
  /** Multi-stage build (build stage + slim runtime). Default true. */
  multiStage?: boolean;
}

/** Generate a production Dockerfile (alpine, non-root, optional multi-stage). */
export function generateDockerfile(opts: DockerOptions = {}): string {
  const node = clean(opts.nodeVersion) || '20';
  const port = typeof opts.port === 'number' && opts.port > 0 ? opts.port : 8080;
  const install = clean(opts.installCmd) || 'npm ci';
  const build = clean(opts.buildCmd);
  const start = clean(opts.startCmd) || 'npm start';
  const base = `node:${node}-alpine`;
  const lines: string[] = [];

  if (opts.multiStage !== false) {
    lines.push(
      `# syntax=docker/dockerfile:1`,
      `FROM ${base} AS build`,
      `WORKDIR /app`,
      `COPY package*.json ./`,
      `RUN ${install}`,
      `COPY . .`,
      ...(build ? [`RUN ${build}`] : []),
      ``,
      `FROM ${base} AS runtime`,
      `WORKDIR /app`,
      `ENV NODE_ENV=production`,
      `COPY --from=build /app ./`,
      `# Run as a non-root user for security`,
      `USER node`,
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(start.split(/\s+/))}`,
    );
  } else {
    lines.push(
      `FROM ${base}`,
      `WORKDIR /app`,
      `ENV NODE_ENV=production`,
      `COPY package*.json ./`,
      `RUN ${install}`,
      `COPY . .`,
      ...(build ? [`RUN ${build}`] : []),
      `USER node`,
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
}

/** Generate a docker-compose.yml for local run. */
export function generateDockerCompose(opts: ComposeOptions = {}): string {
  const name = (clean(opts.serviceName) || 'app').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'app';
  const port = typeof opts.port === 'number' && opts.port > 0 ? opts.port : 8080;
  const env = (opts.env || []).map(clean).filter(Boolean);
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
  lines.push(`    restart: unless-stopped`);
  return lines.join('\n') + '\n';
}

export interface CiOptions {
  nodeVersion?: string;
  installCmd?: string;
  lintCmd?: string;
  testCmd?: string;
  buildCmd?: string;
}

/** Generate a GitHub Actions CI workflow (install → lint → test → build, steps as declared). */
export function generateCiWorkflow(opts: CiOptions = {}): string {
  const node = clean(opts.nodeVersion) || '20';
  const install = clean(opts.installCmd) || 'npm ci';
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
    `      - uses: actions/setup-node@v4`,
    `        with:`,
    `          node-version: '${node}'`,
    `          cache: 'npm'`,
  ];
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

export interface DeployArtifactOutput {
  dockerfile?: string;
  dockerCompose?: string;
  ciWorkflow?: string;
}

/** Generate whatever deployment artifacts the input requests. Pure. */
export function generateDeployArtifacts(input: DeployArtifactInput): DeployArtifactOutput {
  const out: DeployArtifactOutput = {};
  if (input.docker) out.dockerfile = generateDockerfile(input.docker);
  if (input.compose) out.dockerCompose = generateDockerCompose(input.compose);
  if (input.ci) out.ciWorkflow = generateCiWorkflow(input.ci);
  return out;
}
