import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { surplusChat, SurplusError } from '../src/server/lib/surplusClient';

/** Explicit opt-in only: a real request may incur a provider charge. */
export async function runSurplusSmokeTest() {
  const response = await surplusChat('Reply with a short hello.');
  console.log(response.text);
  return response;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--send')) {
    console.error('No request sent. To make one potentially billable request, add --send.');
    process.exitCode = 1;
  } else {
    runSurplusSmokeTest().catch((error: unknown) => {
      console.error(error instanceof SurplusError ? error.message : 'Surplus smoke test failed.');
      process.exitCode = 1;
    });
  }
}
