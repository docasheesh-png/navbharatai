/**
 * Print the weekly game bench's job summary (Markdown) from the newest result file in a directory.
 *   tsx scripts/game-bench-summary.ts <results-dir>
 * Used by .github/workflows/game-bench-weekly.yml. When the bench wrote no file (it stopped before its
 * first checkpoint), it says exactly that — it never prints numbers it did not read.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { gameBenchMarkdown } from '../src/server/AgentV3/reliability/gameBench';
import type { BenchResultFile } from '../src/server/AgentV3/reliability/benchHarness';

const dir = process.argv[2];
if (!dir) { console.error('usage: tsx scripts/game-bench-summary.ts <results-dir>'); process.exit(1); }
let files: string[] = [];
try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)); } catch { files = []; }
if (!files.length) {
  console.log('## Weekly game bench\n\nNo result file was written: the run stopped before its first checkpoint, so no build was submitted. See the job log.');
} else {
  const newest = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  console.log(gameBenchMarkdown(JSON.parse(readFileSync(newest, 'utf8')) as BenchResultFile));
}
