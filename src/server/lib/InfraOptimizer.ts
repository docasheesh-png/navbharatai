// GA-15 (IaC engines) — infrastructure OPTIMIZER / static analyzer.
//
// The IaC GENERATORS emit Dockerfiles / K8s manifests / Terraform; this is the read-and-report half: it scans
// infra files ALREADY in the workspace (hand-written or imported, not only ours) and flags real, high-signal
// anti-patterns that ship "working" but are insecure, unpinned, or wasteful — a base image on :latest, a
// container running as root, a secret baked into an image layer, a K8s pod with no resource limits or running
// privileged, a public (allUsers) Cloud Run binding.
//
// PURE + dependency-free — deterministic line/block regex over the file text (no YAML/HCL parser dependency,
// so it can never throw on malformed input). Same discipline as VulnScanner/IaCGenerator. Read-and-report
// via the `optimize_infra` tool; honest when there is no infra to scan (never a fake all-clear).

export type InfraSeverity = 'error' | 'warning' | 'info';

export interface InfraFinding {
  file: string;
  line?: number;
  severity: InfraSeverity;
  rule: string;
  message: string;
  fix: string;
}

export interface InfraOptimizeResult {
  scanned: string[];
  findings: InfraFinding[];
}

const BASENAME = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const KNOWN_BASE = /^(node|alpine|ubuntu|debian|python|golang|go|nginx|redis|postgres|mysql|mongo|busybox|openjdk|eclipse-temurin|maven|gradle|ruby|php|httpd|amazonlinux)\b/i;
const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|_KEY|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY)/i;

/** Classify an infra file by name + a content sniff. null when it is not infra. */
export function classifyInfraFile(path: string, content: string): 'dockerfile' | 'k8s' | 'terraform' | null {
  if (typeof path !== 'string' || typeof content !== 'string') return null;
  const base = BASENAME(path).toLowerCase();
  if (base === 'dockerfile' || base.endsWith('.dockerfile') || base.startsWith('dockerfile.')) return 'dockerfile';
  if (path.toLowerCase().endsWith('.tf')) return 'terraform';
  if (/^\s*FROM\s+\S/im.test(content)) return 'dockerfile';
  if (/(^|\n)\s*resource\s+"/.test(content)) return 'terraform';
  if (/(^|\n)\s*kind:\s*\S/.test(content) && /(^|\n)\s*apiVersion:\s*\S/.test(content)) return 'k8s';
  return null;
}

function lineOf(content: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++;
  return n;
}

/** High-confidence Dockerfile anti-patterns. Pure. */
export function analyzeDockerfile(path: string, content: string): InfraFinding[] {
  const out: InfraFinding[] = [];
  const lines = content.split(/\r?\n/);
  let hasUser = false, hasHealthcheck = false, hasFrom = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '');
    const ln = i + 1;
    const from = line.match(/^\s*FROM\s+(\S+)/i);
    if (from) {
      hasFrom = true;
      const img = from[1].replace(/\s+AS\s+\S+$/i, '');
      if (/:latest$/i.test(img)) out.push({ file: path, line: ln, severity: 'warning', rule: 'docker-latest-tag', message: `Base image '${img}' uses ':latest' — builds are non-reproducible and can break silently on an upstream push.`, fix: 'Pin an explicit version tag (or a digest), e.g. node:20-alpine.' });
      else if (!img.includes(':') && !img.includes('$') && (img.includes('/') || KNOWN_BASE.test(img))) out.push({ file: path, line: ln, severity: 'warning', rule: 'docker-untagged', message: `Base image '${img}' has no tag — defaults to :latest (non-reproducible).`, fix: 'Add an explicit version tag.' });
    }
    if (/^\s*USER\s+\S/i.test(line)) hasUser = true;
    if (/^\s*HEALTHCHECK\s/i.test(line)) hasHealthcheck = true;
    const secret = line.match(/^\s*(?:ENV|ARG)\s+([A-Za-z0-9_]+)\s*[= ]\s*(\S.*)$/i);
    if (secret && SECRET_NAME.test(secret[1]) && secret[2].trim() && !/^\$\{?\w+\}?$/.test(secret[2].trim())) {
      out.push({ file: path, line: ln, severity: 'error', rule: 'docker-baked-secret', message: `'${secret[1]}' is a secret-looking value baked into an image layer — it is readable by anyone who pulls the image.`, fix: 'Pass secrets at runtime (--env / a secret mount), never ENV/ARG with a literal value.' });
    }
    const add = line.match(/^\s*ADD\s+(\S+)/i);
    if (add && !/^https?:\/\//i.test(add[1]) && !/\.(tar|tar\.gz|tgz|tar\.bz2|tar\.xz)$/i.test(add[1])) {
      out.push({ file: path, line: ln, severity: 'warning', rule: 'docker-add-over-copy', message: `ADD '${add[1]}' for a local path — ADD has surprising auto-extract/remote behavior.`, fix: 'Use COPY for local files; reserve ADD for remote URLs / tar auto-extraction.' });
    }
    if (/apt-get\s+install/i.test(line) && !/--no-install-recommends/i.test(line)) {
      out.push({ file: path, line: ln, severity: 'warning', rule: 'docker-apt-bloat', message: `apt-get install without --no-install-recommends pulls extra packages (bigger, slower image).`, fix: 'Add --no-install-recommends and clean apt lists in the same RUN.' });
    }
  });
  if (hasFrom && !hasUser) out.push({ file: path, severity: 'error', rule: 'docker-root-user', message: `No USER instruction — the container runs as root, so a container escape has host-level privileges.`, fix: 'Add a non-root USER (e.g. USER node) before the CMD.' });
  if (hasFrom && !hasHealthcheck) out.push({ file: path, severity: 'info', rule: 'docker-no-healthcheck', message: `No HEALTHCHECK — the orchestrator can't tell a hung container from a healthy one.`, fix: 'Add a HEALTHCHECK that probes the app\'s /health or port.' });
  return out;
}

/** High-confidence Kubernetes workload anti-patterns (per document). Pure. */
export function analyzeK8sManifest(path: string, content: string): InfraFinding[] {
  const out: InfraFinding[] = [];
  const docs = content.split(/^---\s*$/m);
  const WORKLOAD = /kind:\s*(Deployment|StatefulSet|DaemonSet|Pod|Job|CronJob|ReplicaSet)\b/;
  let offset = 0;
  for (const doc of docs) {
    const base = offset; offset += doc.length + 4;
    if (!WORKLOAD.test(doc)) continue;
    const at = (re: RegExp): number | undefined => { const m = re.exec(doc); return m ? lineOf(content, base + m.index) : undefined; };
    if (/privileged:\s*true/.test(doc)) out.push({ file: path, line: at(/privileged:\s*true/), severity: 'error', rule: 'k8s-privileged', message: `A container runs 'privileged: true' — full host access; a compromise owns the node.`, fix: 'Remove privileged; grant only the specific capabilities needed.' });
    if (/allowPrivilegeEscalation:\s*true/.test(doc)) out.push({ file: path, line: at(/allowPrivilegeEscalation:\s*true/), severity: 'error', rule: 'k8s-privesc', message: `allowPrivilegeEscalation: true lets a process gain more privileges than its parent.`, fix: 'Set allowPrivilegeEscalation: false in the container securityContext.' });
    if (!/resources:\s*[\s\S]*?(limits|requests):/.test(doc)) out.push({ file: path, line: at(WORKLOAD), severity: 'warning', rule: 'k8s-no-resources', message: `No resources.limits/requests — one pod can starve the node (noisy-neighbor / OOM).`, fix: 'Set resources.requests and resources.limits (cpu + memory) per container.' });
    if (!/livenessProbe:/.test(doc)) out.push({ file: path, line: at(WORKLOAD), severity: 'warning', rule: 'k8s-no-liveness', message: `No livenessProbe — a hung container is never restarted.`, fix: 'Add a livenessProbe (httpGet / tcpSocket).' });
    if (!/readinessProbe:/.test(doc)) out.push({ file: path, line: at(WORKLOAD), severity: 'warning', rule: 'k8s-no-readiness', message: `No readinessProbe — traffic is routed to a pod before it is ready.`, fix: 'Add a readinessProbe.' });
    if (!/runAsNonRoot:\s*true/.test(doc)) out.push({ file: path, line: at(WORKLOAD), severity: 'warning', rule: 'k8s-run-as-root', message: `securityContext.runAsNonRoot is not true — the pod may run as root.`, fix: 'Set securityContext.runAsNonRoot: true.' });
    const img = /image:\s*["']?(\S+?)["']?\s*$/m.exec(doc);
    if (img && (/:latest$/i.test(img[1]) || !img[1].includes(':'))) out.push({ file: path, line: at(/image:/), severity: 'warning', rule: 'k8s-latest-image', message: `Container image '${img[1]}' is on :latest / untagged — a rollout can silently pull different code.`, fix: 'Pin an explicit image tag or digest.' });
  }
  return out;
}

/** Terraform anti-patterns (conservative, info-level). Pure. */
export function analyzeTerraform(path: string, content: string): InfraFinding[] {
  const out: InfraFinding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$|\/\/.*$/, '');
    const ln = i + 1;
    if (/member\s*=\s*"allUsers"/.test(line)) out.push({ file: path, line: ln, severity: 'warning', rule: 'tf-public-iam', message: `An IAM binding grants "allUsers" — this resource is PUBLIC to the whole internet.`, fix: 'Restrict the member to a specific principal/group, or confirm public access is intended.' });
    if (/member\s*=\s*"allAuthenticatedUsers"/.test(line)) out.push({ file: path, line: ln, severity: 'info', rule: 'tf-broad-iam', message: `"allAuthenticatedUsers" grants access to anyone with a Google account.`, fix: 'Scope to a specific group if broad access is not intended.' });
  });
  // provider block with no version constraint.
  const provider = /provider\s+"[^"]+"\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = provider.exec(content)) !== null) {
    if (!/version\s*=/.test(m[1])) out.push({ file: path, line: lineOf(content, m.index), severity: 'info', rule: 'tf-unpinned-provider', message: `A provider block has no version constraint — a provider upgrade can change behavior unexpectedly.`, fix: 'Add a version = "~> X.Y" constraint (or required_providers).' });
  }
  return out;
}

/** Classify + dispatch + dedupe across all infra files. Pure; never throws. */
export function optimizeInfra(files: ReadonlyArray<{ path: string; content: string }>): InfraOptimizeResult {
  const scanned: string[] = [];
  const findings: InfraFinding[] = [];
  const seen = new Set<string>();
  for (const f of files || []) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') continue;
    let kind: ReturnType<typeof classifyInfraFile>;
    try { kind = classifyInfraFile(f.path, f.content); } catch { kind = null; }
    if (!kind) continue;
    scanned.push(f.path);
    let fs: InfraFinding[] = [];
    try {
      fs = kind === 'dockerfile' ? analyzeDockerfile(f.path, f.content)
        : kind === 'k8s' ? analyzeK8sManifest(f.path, f.content)
        : analyzeTerraform(f.path, f.content);
    } catch { fs = []; }
    for (const finding of fs) {
      const key = `${finding.file}:${finding.line ?? 0}:${finding.rule}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }
  const rank: Record<InfraSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { scanned: scanned.sort(), findings };
}

/** Honest report for the optimize_infra tool. Never a fake all-clear. Pure. */
export function infraOptimizeSummary(result: InfraOptimizeResult): string {
  if (!result || result.scanned.length === 0) return 'optimize_infra: no Dockerfile / Kubernetes manifest / Terraform files found to analyze.';
  if (result.findings.length === 0) return `optimize_infra: ${result.scanned.length} infra file(s) scanned — no anti-patterns found.`;
  const shown = result.findings.slice(0, 25).map((f) => `  ${f.severity === 'error' ? '❌' : f.severity === 'warning' ? '⚠️' : 'ℹ️'} ${f.file}${f.line ? `:${f.line}` : ''} [${f.rule}] — ${f.message}\n     ↳ Fix: ${f.fix}`);
  return `Infra optimizer — ${result.findings.length} issue(s) across ${result.scanned.length} file(s):\n${shown.join('\n')}${result.findings.length > 25 ? `\n  …and ${result.findings.length - 25} more` : ''}`;
}
