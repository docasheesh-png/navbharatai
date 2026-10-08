// AN IMAGE CARRIES DEBIAN'S SECURITY FIXES, AND A RED SCAN SAYS WHY (2026-10-08, Q-750).
//
// The nightly image scan went red on 2026-10-05 and stayed red for four nights. `node:22-slim` (Debian 12)
// still shipped perl-base 5.36.0-7+deb12u3, with three CRITICAL CVEs that Debian had already fixed in deb12u4.
// The image inherited whatever the base tag carried, so a patched CVE stayed in production until Docker Hub
// republished the tag. Nobody could see that: the findings went only to the job log, and the red X said
// "exit code 1". THE CLASS has two halves: a shipped image that does not take the OS's own security fixes, and
// a security gate whose failure carries no readable reason. Both are locked here, siblings included (the
// Dockerfile NavBharatAI generates for a user's Cloud Run backend).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { backendDeployConfig } from '../src/lib/backendDeployConfig';

/** The lines of a Dockerfile's FINAL stage — the one that ships. */
function finalStage(dockerfile: string): string[] {
  // A RUN continued over several lines (`\` at the end) is one instruction: join it before reading.
  const lines = dockerfile.replace(/\\\n/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const from = lines.map((l, i) => (/^FROM\s/i.test(l) ? i : -1)).filter((i) => i >= 0);
  return lines.slice(from[from.length - 1]);
}

const takesSecurityFixes = (stage: string[]): boolean => stage.some((l) => /^RUN\b.*apt-get update.*apt-get upgrade -y/.test(l));

/** Every Dockerfile that ships a Debian-based image: the repo's own, and every one NavBharatAI generates. */
function shippedDockerfiles(): Array<{ where: string; text: string }> {
  const own = readdirSync('.').filter((f) => /^Dockerfile/.test(f)).map((f) => ({ where: f, text: readFileSync(f, 'utf8') }));
  const generated = [
    { where: 'backendDeployConfig(cloud-run)', text: backendDeployConfig('cloud-run', {}).files['Dockerfile'] },
    { where: 'backendDeployConfig(cloud-run, build)', text: backendDeployConfig('cloud-run', { buildCommand: 'npm run build', nodeMajor: 22 }).files['Dockerfile'] },
  ];
  return [...own, ...generated];
}

describe('every shipped image takes the OS security fixes', () => {
  it('🔒 the final stage of every Debian-based Dockerfile runs apt-get update + upgrade', () => {
    const missing = shippedDockerfiles()
      .filter(({ text }) => /^FROM\s+node:/m.test(text))
      .filter(({ text }) => !takesSecurityFixes(finalStage(text)))
      .map(({ where }) => where);
    expect(missing).toEqual([]);
  });

  it('our runtime stage upgrades as root, before USER node and before the app is copied in', () => {
    const stage = finalStage(readFileSync('Dockerfile', 'utf8'));
    const upgrade = stage.findIndex((l) => /apt-get upgrade/.test(l));
    expect(upgrade).toBeGreaterThan(0);
    expect(upgrade).toBeLessThan(stage.indexOf('USER node'));
    expect(upgrade).toBeLessThan(stage.findIndex((l) => /^COPY --from=builder/.test(l)));
    expect(stage[upgrade]).toMatch(/rm -rf \/var\/lib\/apt\/lists/); // the package index is not shipped
  });
});

describe('a red image scan says why', () => {
  const wf = yaml.load(readFileSync('.github/workflows/image-scan.yml', 'utf8')) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
  };
  const step = Object.values(wf.jobs).flatMap((j) => j.steps).find((s) => s.name === 'Trivy scan — FAIL on CRITICAL')!;

  it('🔒 the CRITICAL scan writes JSON and turns every finding into an annotation and a summary line', () => {
    expect(step.run).toContain('--format json');
    expect(step.run).toContain('::error title=CRITICAL');
    expect(step.run).toContain('GITHUB_STEP_SUMMARY');
    expect(step.run).toMatch(/\[ "\$n" -eq 0 \]\s*$/); // still fails on any CRITICAL
    expect(spawnSync('bash', ['-n'], { input: step.run }).status).toBe(0);
  });

  it('its jq really turns a Trivy report into annotations (the real 2026-10-08 finding)', () => {
    const report = JSON.stringify({
      Results: [
        { Target: 'navbharatai:scan (debian 12.15)', Vulnerabilities: [
          { VulnerabilityID: 'CVE-2026-13221', PkgName: 'perl-base', InstalledVersion: '5.36.0-7+deb12u3', FixedVersion: '5.36.0-7+deb12u4', Title: 'perl: Incorrect regular expression processing' },
        ] },
        { Target: 'Node.js', Vulnerabilities: null },
      ],
    });
    const annotate = /jq -r '(\.Results\[\]\? \| \.Target as \$t \| \(\.Vulnerabilities \/\/ \[\]\)\[\] \| "::error[^']*)'/.exec(step.run!)?.[1];
    const count = /n=\$\(jq '([^']*)'/.exec(step.run!)?.[1];
    expect(annotate && count).toBeTruthy();
    const lines = spawnSync('jq', ['-r', annotate!], { input: report, encoding: 'utf8' }).stdout.trim().split('\n');
    expect(lines).toEqual(['::error title=CRITICAL CVE-2026-13221::perl-base 5.36.0-7+deb12u3, fixed in 5.36.0-7+deb12u4 (navbharatai:scan (debian 12.15)): perl: Incorrect regular expression processing']);
    expect(spawnSync('jq', [count!], { input: report, encoding: 'utf8' }).stdout.trim()).toBe('1');
    expect(spawnSync('jq', [count!], { input: JSON.stringify({ Results: [] }), encoding: 'utf8' }).stdout.trim()).toBe('0');
  });
});
