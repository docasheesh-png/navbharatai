/**
 * EMAIL DELIVERY FOR MONITOR ALERTS — the part that reaches the admin when they are not looking.
 *
 * WHY IT EXISTS. Alerts already reach the in-app notification bell, which is only seen when someone
 * opens the app. If the platform breaks at 2am, that is a morning discovery. Email is the difference
 * between "monitoring" and "monitoring you will actually notice".
 *
 * NO NEW DEPENDENCY. This posts to the provider's HTTP API with the runtime's own `fetch`, rather than
 * pulling in a mail SDK. A monitoring path should not be able to break a build by adding a package,
 * and the request is four lines of JSON.
 *
 * NOT CONFIGURED IS A REAL, VISIBLE STATE. With no API key or no verified sender, this reports
 * `configured: false` with the reason, and the Monitor SAYS so. It never silently no-ops and never
 * reports an email as sent that was not — an alert that claims to have emailed you and did not is
 * strictly worse than no alert, because you stop watching the bell as well.
 *
 * WHAT THE ADMIN HAS TO DO. Create a provider account (Resend's free tier is far larger than this
 * needs), verify a sending domain or use their test sender, then set in Cloud Run:
 *   ALERT_EMAIL_API_KEY   — the provider key
 *   ALERT_EMAIL_FROM      — a verified sender, e.g. "NavBharatAI Monitor <alerts@yourdomain.com>"
 *   ALERT_EMAIL_TO        — optional; defaults to the admin list
 * Nothing else changes: the moment those exist, the same alerts that already reach the bell start
 * reaching the inbox too.
 */
import { adminEmailList } from './adminEmails';

/** Where the request goes. Env-tunable so another provider with a compatible shape can be used. */
export const DEFAULT_EMAIL_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailConfig {
  configured: boolean;
  /** Plain-language reason when it is NOT configured — this is what the Monitor shows the admin. */
  reason: string;
  apiKey: string;
  from: string;
  to: string[];
  endpoint: string;
}

/**
 * Work out whether email alerts can actually be sent, and say plainly why not. Pure.
 *
 * Every missing piece produces its OWN message. "Email is not set up" would leave the admin guessing
 * which of three things to fix, and guessing at a config screen is how a feature stays off for months.
 */
export function resolveEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
  admins: string[] = adminEmailList(),
): EmailConfig {
  const apiKey = String(env.ALERT_EMAIL_API_KEY || env.RESEND_API_KEY || '').trim();
  const from = String(env.ALERT_EMAIL_FROM || '').trim();
  const endpoint = String(env.ALERT_EMAIL_ENDPOINT || '').trim() || DEFAULT_EMAIL_ENDPOINT;
  const to = String(env.ALERT_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const recipients = to.length > 0 ? to : admins;

  const base = { apiKey, from, to: recipients, endpoint };
  if (!apiKey) {
    return { ...base, configured: false, reason: 'No email key set — add ALERT_EMAIL_API_KEY to send alerts by email.' };
  }
  if (!from) {
    // A provider rejects a send from an unverified address, so without this the key would look
    // configured and every send would fail — the worst of both states.
    return { ...base, configured: false, reason: 'No sender set — add ALERT_EMAIL_FROM (a verified sender address).' };
  }
  if (recipients.length === 0) {
    return { ...base, configured: false, reason: 'No recipient — set ALERT_EMAIL_TO, or add an admin address.' };
  }
  return { ...base, configured: true, reason: '' };
}

export interface SendResult {
  sent: boolean;
  /** The real reason a send failed. Never swallowed — a silent failure is how alerting rots. */
  error?: string;
}

/**
 * A short, scannable subject. The whole point is the phone lock screen: the first few words have to
 * say whether this needs waking up for. Pure.
 */
export function alertSubject(message: string): string {
  const critical = message.includes('🔴');
  const resolved = message.includes('🟢');
  const prefix = resolved ? 'Resolved' : critical ? 'ALERT' : 'Warning';
  // Strip the emoji + our own banner so the subject leads with the actual condition.
  const body = message
    .replace(/[🔴🟡🟢]\s*/g, '')
    .replace(/^NavBharatAI Monitor\s*—\s*/, '')
    .split('(measured over')[0]
    .trim();
  const trimmed = body.length > 90 ? `${body.slice(0, 87)}…` : body;
  return `[NavBharatAI] ${prefix}: ${trimmed}`;
}

export interface SendDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Send one alert email. Never throws — a monitoring path must not be able to take the sweep down, and
 * the bell notification has already been delivered by the time this runs.
 */
export async function sendAlertEmail(
  cfg: EmailConfig,
  message: string,
  deps: SendDeps = {},
): Promise<SendResult> {
  if (!cfg.configured) return { sent: false, error: cfg.reason };
  const doFetch = deps.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof doFetch !== 'function') return { sent: false, error: 'No fetch available in this runtime.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, deps.timeoutMs ?? 10_000));
  try {
    const res = await doFetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: cfg.to,
        subject: alertSubject(message),
        text: `${message}\n\n— NavBharatAI Monitor\nOpen Admin → Monitor for the live charts.`,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // The status is the actionable part: 401 means the key, 403 usually means an unverified sender.
      const detail = await res.text().catch(() => '');
      return { sent: false, error: `Email provider returned ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}` };
    }
    return { sent: true };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'Email provider timed out.' : String(err?.message || err);
    return { sent: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
