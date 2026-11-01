// Build monitoring is read-only and safe to retry. Dispatch is not: a lost response can mean the
// workflow already started. Only an explicit indexing rejection may be retried, never a timeout/5xx.
import axios, { type AxiosRequestConfig } from 'axios';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(err: unknown, attempt: number): number | null {
  const response = (err as { response?: { status?: number; headers?: Record<string, unknown> } })?.response;
  const status = response?.status;
  const retryAfter = response?.headers?.['retry-after'];
  const rateLimited = status === 429 || (status === 403 && retryAfter != null);
  if (status != null && !rateLimited && status !== 408 && status < 500) return null;
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(retryAfter)) - Date.now();
    // Do not occupy an HTTP request through a long rate limit, or retry before GitHub allows it.
    if (!Number.isFinite(ms) || ms > 2000) return null;
    return Math.max(0, ms);
  }
  return 500 * 2 ** attempt;
}

/** Three bounded attempts for transient failures; permission/not-found errors return immediately. */
export async function githubBuildGet<T = any>(url: string, config: AxiosRequestConfig = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.get<T>(url, { ...config, timeout: config.timeout ?? 10_000 });
    } catch (err) {
      const delay = retryDelay(err, attempt);
      if (attempt >= 2 || delay === null) throw err;
      await pause(delay);
    }
  }
}

/** GitHub can take a few seconds to register a workflow just committed by mobileSetup. */
export async function dispatchGithubBuild(url: string, body: unknown, config: AxiosRequestConfig) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.post(url, body, { ...config, timeout: 15_000 });
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
      const indexingRejected = response?.status === 404 || (response?.status === 422
        && /does not have.*workflow_dispatch/i.test(response.data?.message || ''));
      if (attempt >= 2 || !indexingRejected) throw err;
      await pause(1000 * (attempt + 1));
    }
  }
}
