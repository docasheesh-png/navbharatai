// Reads the permissions out of a finished .aab and stops the release if one is on Google Play's restricted
// list (Q-749). Run by .github/workflows/android-aab.yml after the build, before the Play upload:
//   npx tsx scripts/checkBundlePermissions.ts android/app/build/outputs/bundle/release/app-release.aab
// Exit 1 only when a restricted permission was read; an unreadable bundle is a warning (see bundlePermissions.ts).

import { readFileSync, appendFileSync } from 'node:fs';
import JSZip from 'jszip';
import { bundlePermissionVerdict } from '../src/server/lib/bundlePermissions';

async function main(): Promise<number> {
  const path = process.argv[2];
  if (!path) {
    console.log('::error title=checkBundlePermissions::usage: checkBundlePermissions.ts <app-release.aab>');
    return 1;
  }
  const zip = await JSZip.loadAsync(readFileSync(path));
  const entry = zip.file('base/manifest/AndroidManifest.xml');
  const verdict = bundlePermissionVerdict(entry ? await entry.async('uint8array') : null);
  for (const line of verdict.annotations) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict.summary}\n\n`);
  return verdict.ok ? 0 : 1;
}

main().then((code) => process.exit(code));
