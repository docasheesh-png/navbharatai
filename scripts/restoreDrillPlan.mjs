// RESTORE DRILL — plan builder (go-live safety PR 7, audit 2026-10-13). PURE: no I/O, no gcloud.
//
// A backup that has never been restored is a hope, not a backup. The drill imports an existing export
// into a SCRATCH Firestore database whose id starts with `drill-`, counts documents in the money and
// identity collections, and deletes the scratch database. It NEVER targets production.

export const PRODUCTION_DATABASE_IDS = Object.freeze([
  '(default)',
  'navbharat-prod',
  'ai-studio-cc9cd998-d842-4462-9833-b44f49825878',
]);

export const DRILL_COLLECTIONS = Object.freeze([
  'user_token_wallets', 'payment_transactions', 'users', 'user_secrets', 'deployments',
]);

const SAFE = /^[A-Za-z0-9._:/@()-]+$/;

/** Validate inputs; returns { ok, errors }. PURE. */
export function validateDrill({ project, exportPrefix, targetDatabase, location }) {
  const errors = [];
  if (!project || !SAFE.test(project)) errors.push('project is missing or has unsafe characters');
  if (!exportPrefix || !/^gs:\/\/[a-z0-9._-]+\/.+/.test(exportPrefix) || !SAFE.test(exportPrefix)) errors.push('exportPrefix must be a gs://bucket/path export prefix');
  if (!targetDatabase || !/^drill-[a-z0-9-]{3,40}$/.test(targetDatabase)) errors.push('targetDatabase must match drill-<lowercase-id>');
  if (PRODUCTION_DATABASE_IDS.includes(String(targetDatabase))) errors.push('targetDatabase is a production database — refused');
  if (!location || !/^[a-z0-9-]+$/.test(location)) errors.push('location (e.g. asia-southeast1) is required');
  return { ok: errors.length === 0, errors };
}

/** The exact commands the drill would run, in order. PURE. */
export function buildDrillPlan({ project, exportPrefix, targetDatabase, location }) {
  const v = validateDrill({ project, exportPrefix, targetDatabase, location });
  if (!v.ok) return { ok: false, errors: v.errors, steps: [] };
  const db = `--project=${project} --database=${targetDatabase}`;
  return {
    ok: true,
    errors: [],
    steps: [
      { what: 'create scratch database', argv: ['gcloud', 'firestore', 'databases', 'create', `--database=${targetDatabase}`, `--location=${location}`, `--project=${project}`] },
      { what: 'import the export into the scratch database', argv: ['gcloud', 'firestore', 'import', exportPrefix, ...db.split(' ')] },
      ...DRILL_COLLECTIONS.map((c) => ({ what: `count ${c}`, count: { project, database: targetDatabase, collection: c } })),
      { what: 'delete scratch database', argv: ['gcloud', 'firestore', 'databases', 'delete', `--database=${targetDatabase}`, `--project=${project}`, '--quiet'] },
    ],
  };
}
