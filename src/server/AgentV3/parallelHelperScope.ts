/**
 * TWO ENGINEERS, ONE `src/lib` — SAY WHO OWNS WHAT BEFORE THEY BOTH WRITE IT (autopsy 8e124182).
 *
 * A browser-only stock app got a Frontend AND a Backend engineer in parallel. There was no server
 * (FE_BE_PARTITION: 0 backend files), so both wrote service code into `src/lib`, and the app shipped with
 * two `exportToExcel` modules (`excel.ts`, `export.ts`) and two `generateId` functions — the reviewer
 * noted both, and nothing could fix it on a working app. Neither engineer was told the other existed.
 *
 * A note added to each engineer's context, never a refusal: the architect's decision to split the work
 * stands; each side is told its lane and to reuse before it creates. PURE.
 */
import { frameworkRunsInBrowser } from '../../lib/frameworkDetect';

export function parallelHelperScopeNote(role: string, framework: string | null | undefined): string {
  const browserOnly = frameworkRunsInBrowser(String(framework || 'vite-react'));
  if (role === 'backend' && browserOnly) {
    return 'SCOPE — this project runs in the browser; there is no server. Your part is the data and service modules '
      + '(src/lib or src/services), not screens. A Frontend engineer is building the screens at the same time: before '
      + 'you create any helper, list src/lib and reuse what is there. Never create a second module that does the job '
      + 'of one that exists (a second Excel export, a second id generator).';
  }
  if (role === 'frontend' || role === 'backend') {
    return 'SCOPE — another engineer may be writing shared helpers at the same time. Before you create a helper in '
      + 'src/lib, src/utils or src/services, list that folder and import what already exists; never create a second '
      + 'module that does the same job.';
  }
  return '';
}
