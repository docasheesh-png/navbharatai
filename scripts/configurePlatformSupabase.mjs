// Prepare/apply only the existing Cloud Run service's configuration. Never creates/updates billing,
// copies connector credentials, or prints a token. The management token must already be in Secret Manager.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function prepareConfiguration(args) {
  const config = JSON.parse(readFileSync(new URL('../ops/default-supabase.json', import.meta.url), 'utf8'));
  const values = Object.fromEntries(args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => {
    const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)];
  }));
  const required = ['gcp-project', 'service', 'run-region', 'token-secret', 'secret-version', 'max-projects'];
  for (const key of required) {
    if (!values[key] || !/^[a-zA-Z0-9_-]+$/.test(values[key])) throw new Error(`Supply --${key}=VALUE (names only, never a token).`);
  }
  if (!/^[1-9]\d*$/.test(values['secret-version'])) throw new Error('Pin a numeric Secret Manager version.');
  const max = Number(values['max-projects']);
  if (!/^[1-9]\d{0,2}$/.test(values['max-projects'])) throw new Error('max-projects must be 1–999.');
  const baseline = 15 + 10 * max;
  const apply = args.includes('--apply');
  if (apply && (values['confirm-pro-org'] !== config.organizationId || values['approve-baseline-usd'] !== String(baseline))) {
    throw new Error(`Application requires confirmed Pro organization and approval of the $${baseline}/month baseline, plus usage/tax. See docs/DEFAULT_SUPABASE.md.`);
  }
  const env = {
    NAVBHARAT_SUPABASE_DEFAULT: 'on', NAVBHARAT_SUPABASE_ORG: config.organizationId,
    NAVBHARAT_SUPABASE_REGION: config.newProjectRegion,
    NAVBHARAT_SUPABASE_MAX_PROJECTS: String(max), NAVBHARAT_SUPABASE_PRODUCTION_APPROVED: 'on',
  };
  const command = ['run', 'services', 'update', values.service, '--project', values['gcp-project'], '--region', values['run-region'],
    '--update-env-vars', Object.entries(env).map(([k, v]) => `${k}=${v}`).join(','),
    '--update-secrets', `NAVBHARAT_SUPABASE_TOKEN=${values['token-secret']}:${values['secret-version']}`];
  return { apply, organizationId: config.organizationId, maxTotalProjects: max, estimatedBaselineUsdPerMonth: baseline, command };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const plan = prepareConfiguration(process.argv.slice(2));
    console.log(JSON.stringify({ ...plan, executable: 'gcloud', billingChanged: false }, null, 2));
    if (plan.apply) {
      const result = spawnSync('gcloud', plan.command, { stdio: 'inherit', shell: false });
      if (result.error || result.status !== 0) throw new Error('Cloud Run configuration did not complete. Verify service state before retrying.');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
