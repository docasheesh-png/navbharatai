// U-4 (verified recipe modules) — outgoing webhook sender (dependency-free, node:crypto).
//
// The other half of webhooks: an app that lets its own customers subscribe to events ("notify my URL when an
// order ships") must SEND signed webhooks. Two things are always gotten wrong. (1) No signature — the
// receiver can't tell a real event from a forged POST, so a serious integration can't trust it; the fix is to
// HMAC-sign the exact body the receiver will verify. (2) No timeout — a subscriber whose endpoint hangs ties
// up your sender (and, fanning out to many subscribers, exhausts it); the fix is an AbortController deadline.
// This recipe ships sendWebhook(): it signs the JSON body with HMAC-SHA256 in the SAME "sha256=<hex>" header
// the incoming-webhook recipe verifies (they interoperate), posts with a timeout, and returns an honest
// { ok, status } without throwing (a failed delivery is data, not a crash — retry it with the retry recipe).
// Dependency-free (node:crypto + fetch), no env keys. PURE builder; correct and complete — no TODO stubs.
// Unit-tested.

export interface WebhookSenderConfig {
  files: Record<string, string>;
  instructions: string;
}

const WEBHOOK_SENDER_SERVER = `import crypto from 'node:crypto';

export interface SendResult { ok: boolean; status: number; error?: string; }

// Send a signed webhook to a subscriber URL. The JSON body is HMAC-SHA256 signed with the subscriber's
// secret and sent as the "X-Webhook-Signature: sha256=<hex>" header, so the receiver can verify it came from
// you (this is the exact format the incoming-webhook verifier checks). A timeout (default 10s) means a slow
// or dead subscriber can never hang your server. Returns { ok, status } and never throws — on failure, retry
// it (see the retry recipe) or record it for later redelivery.
export async function sendWebhook(
  url: string,
  payload: unknown,
  secret: string,
  opts?: { timeoutMs?: number; event?: string },
): Promise<SendResult> {
  const body = JSON.stringify(payload ?? {});
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': String(Date.now()),
        ...(opts?.event ? { 'X-Webhook-Event': opts.event } : {}),
      },
      body,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return { ok: false, status: 0, error: timedOut ? 'timeout' : (err instanceof Error ? err.message : 'send failed') };
  } finally {
    clearTimeout(timer);
  }
}
`;

const INSTRUCTIONS =
  'Outgoing webhook sender wired at server/lib/webhookSender.ts (no dependency — node:crypto). When your app ' +
  'fires an event a customer subscribed to, call await sendWebhook(subscriberUrl, payload, subscriberSecret, ' +
  "{ event: 'order.shipped' }). It HMAC-SHA256 signs the JSON body as the \"X-Webhook-Signature: sha256=<hex>\" " +
  'header (the exact format the incoming-webhook recipe verifies, so your subscribers can confirm it is really ' +
  'you), enforces a timeout so a slow subscriber cannot hang your server, and returns { ok, status } without ' +
  'throwing. On !ok, retry it (see the retry recipe) or queue it for redelivery. No API key needed — the ' +
  'secret is the one you share with each subscriber.';

export function generateWebhookSenderIntegration(): WebhookSenderConfig {
  return {
    files: { 'server/lib/webhookSender.ts': WEBHOOK_SENDER_SERVER },
    instructions: INSTRUCTIONS,
  };
}
