import { isInferenceExecutorTimeout } from './executor';
import { gatewayRetryAfterUntil } from './retryAfter';
/** Single-dispatch reviewed Free vision transport. No catalog, retry or budget authority.
 * Sources: https://docs.z.ai/guides/vlm/glm-4.6v and https://docs.z.ai/guides/overview/pricing
 * https://ai.google.dev/gemini-api/docs/document-processing and https://ai.google.dev/gemini-api/docs/pricing
 * Gemini API account/model eligibility must be reviewed separately from Vertex lifecycle.
 * PDF pages are NOT locally counted: 1000 is a conservative provider-enforced page ceiling.
 * Paid admission reserves the full documented input context and bounded output/thinking.
 * PNG/JPEG decoded byte/dimension limits are application safeguards, not provider quota claims.
 */
import { createHash } from 'node:crypto';
import { isCount, isIdentifier, isPositiveCount, supportsCapability } from './capabilities';
import { evidenceBinding, profileRejection, withoutEvidence } from './profiles';
import type { ProviderProfile, RoutingRequest } from './types';
import type { DispatchClaim, AuthenticatedRejection } from './executor';
import { gatewayTextCredentialBinding, GatewayTextTransportError, type GatewayTextResponse, type GatewayTextUsage, type GatewayTextCostAnomaly, type GatewayTextConservativeUsage, type GatewayTransportHealth } from './textTransport';
export interface GatewayVisionAttachment {
    readonly mimeType: 'image/png' | 'image/jpeg' | 'application/pdf';
    readonly data: string;
}
export interface GatewayVisionPayload {
    readonly kind: 'vision-pdf';
    readonly prompt: string;
    readonly systemPrompt?: string;
    readonly attachments: readonly GatewayVisionAttachment[];
    readonly streaming: false;
}
export interface GatewayVisionTransportConfig {
    readonly kind: 'vision-pdf';
    readonly provider: 'GLM' | 'GEMINI';
    readonly model: 'glm-4.6v-flash' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
    readonly credentialEnv: string;
    readonly credentialBinding: string;
    readonly timeoutMs: number;
    readonly maxOutputTokens: number;
    readonly maxImages: number;
    readonly maxImageBytes: number;
    readonly maxTotalBytes: number;
    readonly maxDimension: number;
    readonly maxPixels: number;
    /** Required for Gemini's metered door. Reviewed maxima, never invoice rates. */
    readonly rateCard?: {
        readonly version: string;
        readonly inputNanoUsdPerMillion: number;
        readonly outputNanoUsdPerMillion: number;
        readonly verifiedAtMs: number;
        readonly expiresAtMs: number;
    };
}
export interface GatewayVisionAuthorization {
    readonly profile: ProviderProfile;
    readonly request: RoutingRequest;
    readonly claim: DispatchClaim;
    readonly transport: GatewayVisionTransportConfig;
}
export interface GatewayVisionInput extends GatewayVisionAuthorization {
    readonly payload: GatewayVisionPayload;
    readonly signal: AbortSignal;
    readonly authorizeClaim: (a: GatewayVisionAuthorization) => Promise<boolean>;
    readonly assertDispatchPolicy: () => void;
    readonly markOutputVisible: () => Promise<void>;
    readonly reportCostAnomaly: (error: GatewayTextTransportError) => Promise<void>;
}
const health = new WeakMap<object, { claim: string; proof: GatewayTransportHealth }>();
export function readGatewayVisionHealth(error: unknown, claim: DispatchClaim): GatewayTransportHealth | undefined {
    const record = error && typeof error === 'object' ? health.get(error) : undefined;
    return record?.claim === evidenceBinding(claim) ? record.proof : undefined;
}
const ceilings = new WeakMap<object, {
    claim: string;
    usage: GatewayTextConservativeUsage;
}>();
export function readGatewayVisionConservativeUsage(result: unknown, claim: DispatchClaim): GatewayTextConservativeUsage | undefined {
    const proof = result && typeof result === 'object' ? ceilings.get(result) : undefined;
    return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
}
const completedCalls = new WeakMap<object, { claim: string; receivedAtMs: number }>();
export function readGatewayVisionCompletion(value: unknown, claim: DispatchClaim): { receivedAtMs: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const proof = completedCalls.get(value); return proof?.claim === evidenceBinding(claim) ? { receivedAtMs: proof.receivedAtMs } : undefined;
}
const measured = new WeakMap<object, {
    claim: string;
    usage: GatewayTextUsage;
}>();
const rejected = new WeakMap<object, {
    claim: string;
    proof: Omit<AuthenticatedRejection, 'evidenceRef'>;
}>();
const anomalies = new WeakMap<object, {
    claim: string;
    proof: GatewayTextCostAnomaly;
}>();
export function readGatewayVisionUsage(result: unknown, claim: DispatchClaim): GatewayTextUsage | undefined {
    const proof = result && typeof result === 'object' ? measured.get(result) : undefined;
    return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
}
export function readGatewayVisionRejection(error: unknown, claim: DispatchClaim): Omit<AuthenticatedRejection, 'evidenceRef'> | undefined {
    const proof = error && typeof error === 'object' ? rejected.get(error) : undefined;
    return proof?.claim === evidenceBinding(claim) ? proof.proof : undefined;
}
export function readGatewayVisionCostAnomaly(error: unknown, claim: DispatchClaim): GatewayTextCostAnomaly | undefined {
    const proof = error && typeof error === 'object' ? anomalies.get(error) : undefined;
    return proof?.claim === evidenceBinding(claim) ? proof.proof : undefined;
}
export function gatewayVisionPayloadDigest(payload: GatewayVisionPayload): string {
    return createHash('sha256').update(evidenceBinding({ kind: payload.kind, prompt: payload.prompt,
        systemPrompt: payload.systemPrompt ?? null, attachments: payload.attachments, streaming: payload.streaming })).digest('hex');
}
function fail(code: ConstructorParameters<typeof GatewayTextTransportError>[0]): never { throw new GatewayTextTransportError(code); }
function immutable<T>(value: T): T {
    const result = JSON.parse(evidenceBinding(value)) as T;
    const freeze = (v: unknown): void => { if (v && typeof v === 'object') {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
    } };
    freeze(result);
    return result;
}
/** Header inspection is an admission bound, not an image decoder or content-safety verdict. */
export function inspectGatewayImage(attachment: GatewayVisionAttachment): {
    bytes: number;
    width: number;
    height: number;
} {
    if (!attachment || !['image/png', 'image/jpeg'].includes(attachment.mimeType) || typeof attachment.data !== 'string'
        || !attachment.data.length || attachment.data.length > 7000000 || attachment.data.length % 4 !== 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.data))
        fail('INVALID_REQUEST');
    const bytes = Buffer.from(attachment.data, 'base64');
    if (bytes.toString('base64') !== attachment.data)
        fail('INVALID_REQUEST');
    let width = 0;
    let height = 0;
    if (attachment.mimeType === 'image/png') {
        if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')
            fail('INVALID_REQUEST');
        width = bytes.readUInt32BE(16);
        height = bytes.readUInt32BE(20);
    }
    else {
        if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
            fail('INVALID_REQUEST');
        let offset = 2;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset++] !== 255)
                fail('INVALID_REQUEST');
            while (bytes[offset] === 255)
                offset++;
            const marker = bytes[offset++];
            if (marker === 218 || marker === 217)
                break;
            if (marker === 0 || marker === 216 || marker === 1 || (marker >= 208 && marker <= 215))
                fail('INVALID_REQUEST');
            if (offset + 2 > bytes.length)
                fail('INVALID_REQUEST');
            const length = bytes.readUInt16BE(offset);
            if (length < 2 || offset + length > bytes.length)
                fail('INVALID_REQUEST');
            if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
                if (length < 8)
                    fail('INVALID_REQUEST');
                height = bytes.readUInt16BE(offset + 3);
                width = bytes.readUInt16BE(offset + 5);
                break;
            }
            offset += length;
        }
    }
    if (!isPositiveCount(width) || !isPositiveCount(height) || !isPositiveCount(width * height))
        fail('INVALID_REQUEST');
    return { bytes: bytes.length, width, height };
}
function validate(a: GatewayVisionAuthorization, payload: GatewayVisionPayload): void {
    const { profile: p, request: r, claim: c, transport: t } = a;
    const keys = ['kind', 'provider', 'model', 'credentialEnv', 'credentialBinding', 'timeoutMs', 'maxOutputTokens', 'maxImages', 'maxImageBytes', 'maxTotalBytes', 'maxDimension', 'maxPixels', 'rateCard'];
    if (!t || Object.keys(t).some(k => !keys.includes(k)) || t.kind !== 'vision-pdf' || !((t.provider === 'GLM' && t.model === 'glm-4.6v-flash') || (t.provider === 'GEMINI' && ['gemini-2.5-flash', 'gemini-2.5-pro'].includes(t.model)))
        || !/^[A-Z][A-Z0-9_]{0,79}$/.test(t.credentialEnv) || !/^[a-f0-9]{64}$/.test(t.credentialBinding)
        || ![t.timeoutMs, t.maxOutputTokens, t.maxImages, t.maxImageBytes, t.maxTotalBytes, t.maxDimension, t.maxPixels].every(isPositiveCount)
        || t.timeoutMs > 120000 || t.maxOutputTokens > 8192 || t.maxImages > 8 || t.maxImageBytes > 5000000
        || t.maxTotalBytes > 20000000 || t.maxDimension > 6000 || t.maxPixels > 36000000)
        fail('CONFIGURATION');
    if (!r || !p || !c?.binding || !isIdentifier(c.id) || !isIdentifier(c.claimId) || c.intentBinding !== evidenceBinding(c.binding)
        || profileRejection(p, r) || !['chat', 'professional'].includes(r.surface) || r.cancellation.cancelled || r.outputVisible
        || Date.now() >= r.deadlineAtMs || p.providerId !== t.provider || p.modelId !== t.model || p.adapterId !== 'gateway-vision-v1'
        || r.capability.kind !== 'vision-pdf'
        || r.capability.streaming || !p.capabilities.some(cap => supportsCapability(r.capability, cap)))
        fail('POLICY_BLOCKED');
    const b = c.binding;
    if (b.profileId !== p.id || b.profileVersion !== p.version || b.providerId !== p.providerId || b.modelId !== p.modelId
        || b.modelRevision !== p.modelRevision || b.adapterId !== p.adapterId || b.key.logicalRequestId !== r.logicalRequestId
        || b.key.principalId !== r.principalId || b.key.tenantId !== r.tenantId || b.key.payloadDigest !== r.payloadDigest
        || b.physicalAttemptId !== r.nextPhysicalAttemptId || b.budgetScopeId !== r.budgetScopeId
        || evidenceBinding(b.payer) !== evidenceBinding(r.payer) || b.profileBinding !== evidenceBinding(withoutEvidence(p))
        || b.requestBinding !== evidenceBinding(withoutEvidence(r)) || r.payloadDigest !== gatewayVisionPayloadDigest(payload))
        fail('POLICY_BLOCKED');
    if (payload.kind !== 'vision-pdf' || payload.streaming !== false || typeof payload.prompt !== 'string' || !payload.prompt.trim()
        || (payload.systemPrompt !== undefined && typeof payload.systemPrompt !== 'string') || !Array.isArray(payload.attachments)
        || !payload.attachments.length || payload.attachments.length > t.maxImages || r.capability.imageCount !== payload.attachments.filter(att => att.mimeType !== 'application/pdf').length
        || r.capability.systemPrompt !== !!payload.systemPrompt || r.capability.outputTokens > t.maxOutputTokens
        || (t.provider === 'GLM' && r.capability.inputTokens + r.capability.outputTokens > 131072)
        || Buffer.byteLength(payload.prompt + (payload.systemPrompt ?? ''), 'utf8') > r.capability.inputTokens)
        fail('INVALID_REQUEST');
    if (t.provider === 'GLM') {
        if (p.charging !== 'verified-free-no-overage' || t.rateCard !== undefined || b.budget !== undefined || r.capability.pdfPages !== 0)
            fail('POLICY_BLOCKED');
    }
    else {
        const rate = t.rateCard;
        const now = Date.now();
        if (p.charging !== 'metered' || r.mode === 'strict-free' || r.capability.inputTokens > 1048576 || r.capability.outputTokens < 256
            || !rate || !isIdentifier(rate.version) || !isCount(rate.verifiedAtMs) || rate.verifiedAtMs > now || rate.expiresAtMs <= now
            || !isPositiveCount(rate.inputNanoUsdPerMillion) || !isPositiveCount(rate.outputNanoUsdPerMillion)
            || rate.inputNanoUsdPerMillion < (t.model === 'gemini-2.5-pro' ? 2500000000 : 300000000)
            || rate.outputNanoUsdPerMillion < (t.model === 'gemini-2.5-pro' ? 15000000000 : 2500000000)
            || !b.budget || b.budget.rateCardVersion !== rate.version || b.budget.amountNanoUsd < visionMaximumCost(1048576, r.capability.outputTokens, rate))
            fail('POLICY_BLOCKED');
        const pdfCount = payload.attachments.filter(att => att.mimeType === 'application/pdf').length;
        // Provider-enforced maximum, deliberately NOT an invented local page count.
        if (r.capability.pdfPages !== (pdfCount ? 1000 : 0) || pdfCount > 1 || (pdfCount > 0 && r.capability.inputTokens !== 1048576))
            fail('INVALID_REQUEST');
    }
    let total = 0;
    for (const attachment of payload.attachments) {
        if (attachment.mimeType === 'application/pdf') {
            if (t.provider !== 'GEMINI' || !r.capability.formats.includes('application/pdf'))
                fail('INVALID_REQUEST');
            const bytes = pdfBytes(attachment.data);
            total += bytes;
            if (bytes > t.maxImageBytes || total > t.maxTotalBytes)
                fail('INVALID_REQUEST');
            continue;
        }
        const meta = inspectGatewayImage(attachment);
        total += meta.bytes;
        if (!r.capability.formats.includes(attachment.mimeType) || meta.bytes > t.maxImageBytes || total > t.maxTotalBytes
            || meta.width > t.maxDimension || meta.height > t.maxDimension || meta.width * meta.height > t.maxPixels)
            fail('INVALID_REQUEST');
    }
}
export function visionMaximumCost(input: number, output: number, rate: NonNullable<GatewayVisionTransportConfig['rateCard']>): number {
    const value = (BigInt(input) * BigInt(rate.inputNanoUsdPerMillion) + BigInt(output) * BigInt(rate.outputNanoUsdPerMillion) + 999999n) / 1000000n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
        fail('CONFIGURATION');
    return Number(value);
}
function pdfBytes(base64: string): number {
    if (typeof base64 !== 'string' || !base64.length || base64.length > 7000000 || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
        fail('INVALID_REQUEST');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64 || !bytes.subarray(0, 8).toString('ascii').match(/^%PDF-[12]\.[0-9]/) || !bytes.subarray(Math.max(0, bytes.length - 1024)).toString('ascii').includes('%%EOF'))
        fail('INVALID_REQUEST');
    return bytes.length;
}
const safety = new Set(['content_filter', 'safety', 'safety_violation', 'safety_refusal', 'sensitive', 'prohibited_content', '1301']);
function envelope(body: any): {
    safety: boolean;
    ambiguous: boolean;
    charged: boolean;
} {
    const result = { safety: false, ambiguous: false, charged: false };
    for (let depth = 0; depth < 8 && body && typeof body === 'object'; depth++, body = body.error) {
        result.safety ||= [body.code, body.type, body.status].some(v => safety.has(String(v).toLowerCase()));
        result.ambiguous ||= ['choices', 'usage', 'candidates', 'usageMetadata', 'promptFeedback'].some(key => Object.hasOwn(body, key));
        result.safety ||= !!body.promptFeedback?.blockReason || (Array.isArray(body.candidates) && body.candidates.some((c: any) => ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(c?.finishReason)));
        if (body.usage && Object.hasOwn(body.usage, 'cost'))
            result.charged ||= !['0', '0.0', '0.00'].includes(String(body.usage.cost));
        if (Array.isArray(body.choices))
            result.safety ||= body.choices.some((c: any) => c?.message?.refusal || c?.delta?.refusal || safety.has(String(c?.finish_reason).toLowerCase()));
    }
    return result;
}
/** A bounded single POST with final durable authorization immediately before network dispatch. */
export async function executeGatewayVision(input: GatewayVisionInput): Promise<GatewayTextResponse> {
    const started = Date.now();
    let visible = false;
    let original: unknown;
    let dispatchedClaim: DispatchClaim | undefined;
    let terminalReceivedAtMs: number | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted)
        abort();
    const timer = setTimeout(abort, Math.max(0, Math.min(input.transport?.timeoutMs ?? 0, input.request?.attemptTimeoutMs ?? 0, (input.request?.deadlineAtMs ?? 0) - Date.now())));
    const active = () => { if (controller.signal.aborted)
        fail(input.signal?.aborted ? 'ABORTED' : 'TIMEOUT'); };
    const bounded = async <T>(promise: Promise<T>): Promise<T> => {
        void promise.catch(() => { });
        active();
        let listener: (() => void) | undefined;
        try {
            return await Promise.race([promise, new Promise<never>((_, reject) => { listener = () => reject(new GatewayTextTransportError(input.signal.aborted ? 'ABORTED' : 'TIMEOUT')); controller.signal.addEventListener('abort', listener, { once: true }); if (controller.signal.aborted)
                    listener(); })]);
        }
        finally {
            if (listener)
                controller.signal.removeEventListener('abort', listener);
        }
    };
    try {
        if (!input.signal || typeof input.authorizeClaim !== 'function' || typeof input.assertDispatchPolicy !== 'function'
            || typeof input.markOutputVisible !== 'function' || typeof input.reportCostAnomaly !== 'function')
            fail('CONFIGURATION');
        const a = immutable({ profile: input.profile, request: input.request, claim: input.claim, transport: input.transport });
        const payload: GatewayVisionPayload = immutable({ kind: input.payload.kind, prompt: input.payload.prompt,
            ...(input.payload.systemPrompt !== undefined ? { systemPrompt: input.payload.systemPrompt } : {}),
            attachments: input.payload.attachments, streaming: input.payload.streaming });
        validate(a, payload);
        active();
        input.assertDispatchPolicy();
        const credential = process.env[a.transport.credentialEnv]?.trim();
        if (!credential || credential.includes(',') || gatewayTextCredentialBinding(credential) !== a.transport.credentialBinding)
            fail('CONFIGURATION');
        const glmBody = { model: a.transport.model, stream: false, max_tokens: a.request.capability.kind === 'vision-pdf' ? a.request.capability.outputTokens : 0,
            thinking: { type: 'disabled' }, tools: [], messages: [...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []), { role: 'user', content: [{ type: 'text', text: payload.prompt }, ...payload.attachments.map(att => ({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.data}` } }))] }] };
        const geminiBody = { contents: [{ role: 'user', parts: [{ text: payload.prompt }, ...payload.attachments.map(att => ({ inlineData: { mimeType: att.mimeType, data: att.data } }))] }], ...(payload.systemPrompt ? { systemInstruction: { parts: [{ text: payload.systemPrompt }] } } : {}), generationConfig: { maxOutputTokens: a.request.capability.kind === 'vision-pdf' ? a.request.capability.outputTokens - 128 : 0, thinkingConfig: { thinkingBudget: a.transport.model === 'gemini-2.5-pro' ? 128 : 0 } }, tools: [] };
        const body = JSON.stringify(a.transport.provider === 'GLM' ? glmBody : geminiBody);
        if (await bounded(input.authorizeClaim(a)) !== true)
            fail('POLICY_BLOCKED');
        validate(a, payload);
        active();
        input.assertDispatchPolicy();
        if (process.env[a.transport.credentialEnv]?.trim() !== credential)
            fail('POLICY_BLOCKED');
        const endpoint = a.transport.provider === 'GLM' ? 'https://api.z.ai/api/paas/v4/chat/completions' : `https://generativelanguage.googleapis.com/v1beta/models/${a.transport.model}:generateContent`;
        const headers: Record<string, string> = a.transport.provider === 'GLM' ? { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' } : { 'x-goog-api-key': credential, 'Content-Type': 'application/json' };
        dispatchedClaim = a.claim;
        const response = await bounded(fetch(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers, body }));
        if (!response.body)
            fail('NETWORK');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const next = await bounded(reader.read());
                if (next.done)
                    break;
                size += next.value.byteLength;
                if (size > 2000000)
                    fail('NETWORK');
                chunks.push(next.value);
            }
        }
        finally {
            void reader.cancel().catch(() => { });
        }
        let data: any;
        try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        catch {
            fail('NETWORK');
        }
        const flags = envelope(data);
        const reported = data?.usageMetadata ?? data?.error?.usageMetadata;
        const exceedsPaidBound = a.transport.provider === 'GEMINI' && a.request.capability.kind === 'vision-pdf' && reported && (
            (isCount(reported.promptTokenCount) && reported.promptTokenCount > 1048576)
            || (isCount(reported.candidatesTokenCount) && reported.candidatesTokenCount > a.request.capability.outputTokens)
            || (isCount(reported.thoughtsTokenCount) && reported.thoughtsTokenCount > a.request.capability.outputTokens)
            || (isCount(reported.candidatesTokenCount) && isCount(reported.thoughtsTokenCount) && reported.candidatesTokenCount + reported.thoughtsTokenCount > a.request.capability.outputTokens));
        if (flags.charged || exceedsPaidBound) {
            const error = new GatewayTextTransportError('POLICY_BLOCKED');
            anomalies.set(error, { claim: evidenceBinding(a.claim), proof: immutable({ binding: a.claim.binding, kind: a.transport.provider === 'GLM' ? 'free-cost-contradiction' : 'paid-liability-contradiction', receivedAtMs: Date.now() }) });
            original = error;
            await bounded(input.reportCostAnomaly(error));
            throw error;
        }
        if (flags.safety) {
            const error = new GatewayTextTransportError('SAFETY_REFUSAL');
            const choice = data?.choices?.[0];
            if (response.ok && a.transport.provider === 'GLM' && data?.model === a.transport.model
                && data.choices.length === 1 && typeof choice?.finish_reason === 'string'
                && (safety.has(choice.finish_reason.toLowerCase()) || ['stop', 'length'].includes(choice.finish_reason)))
                completedCalls.set(error, { claim: evidenceBinding(a.claim), receivedAtMs: Date.now() });
            throw error;
        }
        if (!response.ok) {
            const quotaCode = ['1113', '1308', '1310', '1313'].includes(String(data?.error?.code));
            const error = new GatewayTextTransportError(response.status === 429 ? (quotaCode ? 'QUOTA_EXHAUSTED' : 'RATE_LIMIT') : response.status === 401 || response.status === 403 ? 'AUTH' : response.status >= 500 ? 'SERVER' : 'INVALID_REQUEST', response.status);
            const receivedAtMs = Date.now();
            const cooldownUntilMs = gatewayRetryAfterUntil(response.headers?.get('retry-after'), receivedAtMs);
            if (response.status === 429 && error.code === 'RATE_LIMIT' && !flags.ambiguous && cooldownUntilMs !== null)
                rejected.set(error, { claim: evidenceBinding(a.claim), proof: immutable({ binding: a.claim.binding, kind: 'http-rejected', status: 429, generationRejected: true, outputVisible: false, receivedAtMs, ...(cooldownUntilMs !== undefined ? { cooldownUntilMs } : {}) }) });
            if (response.status === 429 && error.code === 'RATE_LIMIT' && !flags.ambiguous && cooldownUntilMs === null)
                health.set(error, { claim: evidenceBinding(a.claim), proof: immutable({ binding: a.claim.binding, kind: 'cooldown-unavailable', receivedAtMs }) });
            throw error;
        }
        if (a.transport.provider === 'GEMINI') {
            if (data?.promptFeedback?.blockReason || data?.candidates?.some((c: any) => ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(c.finishReason)))
                fail('SAFETY_REFUSAL');
            const candidate = data?.candidates?.[0];
            if (data?.modelVersion !== a.transport.model && data?.modelVersion !== a.profile.modelRevision)
                fail('NETWORK');
            if (!Array.isArray(data?.candidates) || data.candidates.length !== 1 || !['STOP', 'MAX_TOKENS'].includes(candidate?.finishReason) || !Array.isArray(candidate?.content?.parts) || candidate.content.parts.some((p: any) => typeof p.text !== 'string' || p.functionCall || p.inlineData))
                fail('NETWORK');
            const content = candidate.content.parts.filter((p: any) => p.thought !== true).map((p: any) => p.text).join('');
            if (!content.trim())
                fail('EMPTY_RESPONSE');
            const u = data.usageMetadata;
            const inputTokens = u?.promptTokenCount;
            const outputTokens = (u?.candidatesTokenCount ?? NaN) + (u?.thoughtsTokenCount ?? 0);
            const reasoningComplete = (a.transport.model !== 'gemini-2.5-pro' && !candidate.content.parts.some((p: any) => p.thought === true)) || isCount(u?.thoughtsTokenCount);
            const complete = reasoningComplete && isPositiveCount(inputTokens) && isPositiveCount(u?.candidatesTokenCount) && isCount(u?.thoughtsTokenCount ?? 0) && isCount(u?.totalTokenCount) && u.totalTokenCount === inputTokens + outputTokens && isCount(u.toolUsePromptTokenCount ?? 0) && !(u.toolUsePromptTokenCount > 0) && isCount(u.cachedContentTokenCount ?? 0) && (u.cachedContentTokenCount ?? 0) <= inputTokens && inputTokens <= 1048576 && a.request.capability.kind === 'vision-pdf' && outputTokens <= a.request.capability.outputTokens;
            await bounded(input.markOutputVisible());
            visible = true;
            active();
            const result: GatewayTextResponse = { content, provider: 'GEMINI', model: a.transport.model, latencyMs: Date.now() - started, completeUsage: complete, finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'length', outputVisible: true, ...(complete ? { usage: { inputTokens, outputTokens } } : {}) };
            const rate = a.transport.rateCard;
            if (complete && rate && rate.expiresAtMs > Date.now())
                ceilings.set(result, { claim: evidenceBinding(a.claim), usage: immutable({ binding: a.claim.binding, final: true, outcome: { kind: 'completed' }, outputVisible: true, inputTokens, outputTokens, chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: visionMaximumCost(inputTokens, outputTokens, rate), rateCardVersion: rate.version }) });
            return result;
        }
        const choice = data?.choices?.[0];
        const content = choice?.message?.content;
        if (data?.error || data?.model !== a.transport.model || !Array.isArray(data.choices) || data.choices.length !== 1 || typeof content !== 'string'
            || !['stop', 'length'].includes(choice.finish_reason) || choice.message.tool_calls?.length)
            fail('NETWORK');
        terminalReceivedAtMs = Date.now();
        if (!content.trim()) fail('EMPTY_RESPONSE');
        const usage = data.usage;
        const complete = usage && isPositiveCount(usage.prompt_tokens) && isPositiveCount(usage.completion_tokens)
            && isPositiveCount(usage.total_tokens) && usage.total_tokens === usage.prompt_tokens + usage.completion_tokens
            && a.request.capability.kind === 'vision-pdf' && usage.prompt_tokens <= a.request.capability.inputTokens && usage.completion_tokens <= a.request.capability.outputTokens;
        await bounded(input.markOutputVisible());
        visible = true;
        active();
        const result: GatewayTextResponse = { content, provider: 'GLM', model: a.transport.model, latencyMs: Date.now() - started, completeUsage: !!complete, finishReason: choice.finish_reason, outputVisible: visible,
            ...(complete ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } } : {}) };
        if (complete)
            measured.set(result, { claim: evidenceBinding(a.claim), usage: immutable({ binding: a.claim.binding, final: true, outcome: { kind: 'completed' }, outputVisible: visible, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, actualNanoUsd: 0 }) });
        completedCalls.set(result, { claim: evidenceBinding(a.claim), receivedAtMs: Date.now() });
        return result;
    }
    catch (error) {
        const executorTimeout = input.signal?.aborted && isInferenceExecutorTimeout(input.signal.reason);
        const safe = controller.signal.aborted ? new GatewayTextTransportError(input.signal?.aborted && !executorTimeout ? 'ABORTED' : 'TIMEOUT') : error instanceof GatewayTextTransportError ? error : new GatewayTextTransportError('NETWORK');
        const completion = error && typeof error === 'object' ? completedCalls.get(error) : undefined;
        if (completion) completedCalls.set(safe, completion);
        else if (terminalReceivedAtMs !== undefined && dispatchedClaim) completedCalls.set(safe, { claim: evidenceBinding(dispatchedClaim), receivedAtMs: terminalReceivedAtMs });
        if (original && typeof original === 'object') {
            const proof = anomalies.get(original);
            if (proof)
                anomalies.set(safe, proof);
        }
        if (error && typeof error === 'object' && health.has(error)) health.set(safe, health.get(error)!);
        if (dispatchedClaim && (!input.signal?.aborted || executorTimeout) && !anomalies.has(safe)
            && ['AUTH', 'SERVER', 'NETWORK', 'TIMEOUT'].includes(safe.code)) {
            health.set(safe, { claim: evidenceBinding(dispatchedClaim), proof: immutable({
                binding: dispatchedClaim.binding, kind: safe.code === 'AUTH' ? 'auth' : 'transient', receivedAtMs: Date.now(),
            }) });
        }
        throw safe;
    }
    finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abort);
    }
}
