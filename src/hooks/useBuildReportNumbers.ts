import { useEffect, useState } from 'react';
import { loadBuildReportNumbers, unavailableReportNumbers, type NumberedReportReference } from '../lib/loadBuildReportNumbers';

const EMPTY: never[] = [];
/** Browsing never waits for numbering. A newer page/filter/token owns the next response. */
export function useBuildReportNumbers<T extends NumberedReportReference>(
  source: T[] | undefined, cohort: 'latest' | 'failed', token: string,
): T[] {
  const rows = source ?? EMPTY;
  const [result, setResult] = useState<{ source: T[]; token: string; rows: T[] } | null>(null);
  useEffect(() => {
    if (!rows.length) return;
    const controller = new AbortController();
    void loadBuildReportNumbers(cohort, rows, token, controller.signal).then(numbered => {
      if (!controller.signal.aborted) setResult({ source: rows, token, rows: numbered });
    }, () => {
      if (!controller.signal.aborted) setResult({ source: rows, token, rows: unavailableReportNumbers(rows) });
    });
    return () => controller.abort();
  }, [rows, cohort, token]);
  return result?.source === rows && result.token === token ? result.rows : rows;
}
