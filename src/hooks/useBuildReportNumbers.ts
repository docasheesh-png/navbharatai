import { useEffect, useState } from 'react';
import { loadBuildReportNumbers, unavailableReportNumbers, type NumberedReportReference } from '../lib/loadBuildReportNumbers';

const EMPTY: never[] = [];
/** Browsing never waits for numbering. A newer page/filter/token owns the next response. */
export function useBuildReportNumbers<T extends NumberedReportReference>(
  source: T[] | undefined, cohort: 'latest' | 'failed', token: string,
): T[] {
  const rows = source ?? EMPTY;
  const [result, setResult] = useState<{ source: T[]; cohort: 'latest' | 'failed'; token: string; rows: T[] } | null>(null);
  useEffect(() => {
    if (!rows.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt: number) => {
      let numbered: T[];
      try { numbered = await loadBuildReportNumbers(cohort, rows, token, controller.signal); }
      catch { numbered = unavailableReportNumbers(rows, 'request_failed'); }
      if (controller.signal.aborted) return;
      setResult({ source: rows, cohort, token, rows: numbered });
      // The server coalesces scans and has a 30-second failure/miss cooldown. Retry only
      // transient unknowns, twice, without reloading report bodies or polling forever.
      const retryable = numbered.some(row => row.numbering?.ordinal === null &&
        !['invalid_timestamp', 'scan_limit'].includes(row.numbering.reason ?? ''));
      if (retryable && attempt < 2) timer = setTimeout(() => { void load(attempt + 1); }, 31_000);
    };
    void load(0);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [rows, cohort, token]);
  return result?.source === rows && result.cohort === cohort && result.token === token ? result.rows : rows;
}
