// Prints the Cloud Build config of a CREDENTIAL-LESS build (Q-706) — the SAME steps the server would send,
// read from containerBuild.ts, never a copy. Used by scripts/verifyCredentiallessBuild.sh in Cloud Shell:
//   npx tsx scripts/printCredentiallessBuild.ts <image> <projects/P/serviceAccounts/EMAIL>
import { credentiallessBuildConfig } from '../src/server/AgentV3/containerBuild';

const [image, serviceAccount] = process.argv.slice(2);
if (!image || !serviceAccount) {
  console.error('usage: printCredentiallessBuild.ts <image> <projects/P/serviceAccounts/EMAIL>');
  process.exit(2);
}
process.stdout.write(JSON.stringify(credentiallessBuildConfig(image, serviceAccount), null, 2));
