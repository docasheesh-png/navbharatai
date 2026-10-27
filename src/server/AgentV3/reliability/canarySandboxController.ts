/** Restricted sandbox preparation only. No production route constructs this controller. */
import { createHash } from 'node:crypto';
import { Sandbox, ALL_TRAFFIC, type SandboxOpts } from 'e2b';
import { CanaryReservationStore, type CanaryBinding } from './canarySpendGuard';
import { type CanarySandboxManifest } from './canarySandboxPolicy';
import { canaryWorkspaceId, runWithCanaryIsolation } from './canaryIsolation';

export type CanaryTool = { name: 'read_file' | 'list_files'; path: string }
  | { name: 'write_file'; path: string; content: string }
  | { name: 'build' | 'test' };
interface Handle {
  execute(payload: string, timeoutMs: number, signal: AbortSignal): Promise<string>;
  kill(): Promise<boolean>;
}
export interface CanarySandboxProvider {
  create(options: SandboxOpts): Promise<Handle>;
}
/** One physical create: SDK create retries=0 does not disable HTTP redirects.
 * The locked SDK's Node/e2b.app getSandboxUrl default is https://sandbox.e2b.app.
 * Constructor is local-only; command RPC still follows redirects, an activation blocker.
 */
async function createPinnedSandbox(options: SandboxOpts): Promise<Sandbox> {
  const timeoutMs = options.requestTimeoutMs;
  if (!options.apiKey || !Number.isSafeInteger(timeoutMs) || timeoutMs! <= 0 || timeoutMs! > 30_000
    || typeof options.template !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(options.template)
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs! <= 0 || options.timeoutMs! > 900_000) {
    throw new Error('Invalid restricted create envelope');
  }
  const apiKey = options.apiKey;
  const body = JSON.stringify({ templateID: options.template, envVars: {},
    timeout: Math.ceil(options.timeoutMs! / 1000), secure: true, allow_internet_access: false,
    network: { allowOut: [], denyOut: [ALL_TRAFFIC], allowPublicTraffic: false },
    autoPause: false, autoResume: { enabled: false },
  });
  const abort = new AbortController();
  const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Restricted create outcome unknown'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    timer = setTimeout(() => abort.abort(), timeoutMs);
  });
  try {
    return await Promise.race([stopped, (async () => {
      signal.throwIfAborted();
      const response = await fetch('https://api.e2b.app/sandboxes', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey }, body,
      });
      if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
      reader = response.body?.getReader();
      if (!response.ok || response.redirected || !reader) throw new Error('Restricted create response refused');
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const part = await reader.read(); signal.throwIfAborted();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 16_384) throw new Error('Restricted create response oversized');
        chunks.push(part.value);
      }
      let data: any;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('Restricted create response invalid'); }
      const token = (v: unknown) => typeof v === 'string' && /^[\x21-\x7e]{1,4096}$/.test(v);
      if (!data || typeof data.sandboxID !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(data.sandboxID)
        || typeof data.envdVersion !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(data.envdVersion)
        || (data.envdVersion.split('.').map(Number)[0] === 0 && data.envdVersion.split('.').map(Number)[1] < 1)
        || !token(data.envdAccessToken) || (data.domain != null && data.domain !== 'e2b.app')
        || (data.trafficAccessToken != null && !token(data.trafficAccessToken))) throw new Error('Restricted create identity invalid');
      signal.throwIfAborted();
      return new Sandbox({ apiKey, apiUrl: 'https://api.e2b.app', domain: 'e2b.app',
        sandboxUrl: 'https://sandbox.e2b.app', debug: false, retries: 0, apiHeaders: {}, headers: {},
        requestTimeoutMs: timeoutMs, sandboxId: data.sandboxID, sandboxDomain: 'e2b.app',
        envdVersion: data.envdVersion, envdAccessToken: data.envdAccessToken,
        trafficAccessToken: data.trafficAccessToken ?? undefined });
    })()]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    void reader?.cancel().catch(() => {});
  }
}
/** It exports neither the native ID nor any reconnect/TTL method. */
export const e2bCanaryProvider: CanarySandboxProvider = {
  async create(options) {
    const sandbox = await createPinnedSandbox(options);
    return {
      async execute(payload, timeoutMs, signal) {
        // The reviewed template must contain this immutable, unprivileged runner and its offline dependencies.
        // No caller-controlled shell fragments, environment, package manager or working directory.
        const result = await sandbox.commands.run(`/opt/nbai-canary/run ${payload}`, {
          timeoutMs, requestTimeoutMs: timeoutMs, signal, user: 'user', envs: {},
        });
        if (result.exitCode !== 0) throw new Error('Restricted sandbox operation failed');
        if (Buffer.byteLength(result.stdout) > 131_072 || Buffer.byteLength(result.stderr) > 8192) throw new Error('Restricted sandbox output exceeded its envelope');
        return result.stdout;
      },
      kill: () => sandbox.kill({ requestTimeoutMs: 5000 }),
    };
  },
};
function checkedTool(tool: CanaryTool): string {
  if (!tool || typeof tool !== 'object') throw new Error('Invalid restricted tool');
  const keys = Object.keys(tool).sort().join(',');
  if (tool.name === 'build' || tool.name === 'test') {
    if (keys !== 'name') throw new Error('Restricted command overrides are forbidden');
  } else {
    if (!('path' in tool) || !['read_file', 'list_files', 'write_file'].includes(tool.name)
      || keys !== (tool.name === 'write_file' ? 'content,name,path' : 'name,path')
      || typeof tool.path !== 'string' || !/^(?:src|public)(?:\/[A-Za-z0-9_.-]+)*$/.test(tool.path)
      || tool.path.split('/').some(p => p === '.' || p === '..')
      || (tool.name === 'write_file' && (typeof tool.content !== 'string' || Buffer.byteLength(tool.content) > 100_000))) {
      throw new Error('Restricted tool or path is outside the envelope');
    }
  }
  return Buffer.from(JSON.stringify(tool)).toString('base64');
}
export class CanarySandboxController {
  #handle?: Handle;
  #manifest?: CanarySandboxManifest;
  #started = false;
  #stopped = false;
  #operations = 0;
  #busy = false;
  #builtDigest?: string;
  #closing?: Promise<void>;
  #deadline?: ReturnType<typeof setTimeout>;
  #abort = new AbortController();
  constructor(private readonly authorityId: string, private readonly binding: CanaryBinding,
    private readonly store: CanaryReservationStore, private readonly provider: CanarySandboxProvider = e2bCanaryProvider,
    private readonly now = Date.now) {}
  async start(apiKey: string): Promise<void> {
    if (this.#started || this.#stopped) throw new Error('Restricted sandbox cannot restart');
    this.#started = true;
    try {
      if (!apiKey || /\s/.test(apiKey)) throw new Error('Missing restricted provider account');
      const manifest = await this.store.reserveSandbox(this.authorityId, this.binding, createHash('sha256').update(apiKey).digest('hex'));
      if (manifest.workspaceId !== canaryWorkspaceId(this.binding.uid, this.binding.requestId, this.binding.fixtureHash)) throw new Error('Restricted workspace provenance mismatch');
      this.#manifest = manifest;
      this.#assertActive();
      const remaining = manifest.expiresAtMs - this.now();
      this.#deadline = setTimeout(() => { void this.close(); }, remaining);
      this.#deadline.unref?.();
      const creation = this.provider.create({
        apiKey, apiUrl: 'https://api.e2b.app', domain: 'e2b.app', debug: false,
        template: manifest.templateId, timeoutMs: manifest.providerTtlMs,
        requestTimeoutMs: Math.min(manifest.requestTimeoutMs, remaining), retries: 0,
        signal: this.#abort.signal, secure: true, envs: {}, apiHeaders: {}, headers: {},
        allowInternetAccess: false, network: { allowOut: [], denyOut: [ALL_TRAFFIC], allowPublicTraffic: false },
        lifecycle: { onTimeout: 'kill', autoResume: false },
        metadata: { purpose: 'restricted-synthetic-canary', manifest: manifest.templateDigest },
      });
      // Abort cannot certify cancellation. Any late known handle gets a best-effort kill; holds remain.
      creation.then(handle => { if (this.#stopped) void handle.kill().catch(() => false); }, () => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        this.#handle = await Promise.race([creation, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Restricted sandbox create outcome unknown')), Math.min(manifest.requestTimeoutMs, remaining));
        })]);
      } finally { if (timer) clearTimeout(timer); }
      this.#assertActive();
    } catch (error) { await this.close(); throw error; }
  }
  #assertActive(): void {
    this.store.assertActive();
    if (this.#stopped || !this.#manifest || this.now() >= this.#manifest.expiresAtMs) throw new Error('Restricted job deadline reached');
  }
  async tool(tool: CanaryTool): Promise<string> {
    let payload = checkedTool(tool);
    if (tool.name === 'test') {
      if (!this.#builtDigest) throw new Error('Current source has no verified build');
      payload = Buffer.from(JSON.stringify({ name: 'test', expectedSourceDigest: this.#builtDigest })).toString('base64');
    }
    if (tool.name === 'write_file' || tool.name === 'build') this.#builtDigest = undefined;
    this.#assertActive();
    if (!this.#handle || this.#busy || this.#operations >= 128) throw new Error('Restricted tool execution unavailable');
    this.#busy = true; this.#operations++;
    const m = this.#manifest!;
    try {
      await this.store.assertSandboxLease(this.authorityId, this.binding, m);
      this.#assertActive();
      return await runWithCanaryIsolation({ uid: this.binding.uid, jobId: this.binding.requestId, fixtureHash: this.binding.fixtureHash, workspaceId: m.workspaceId }, async () => {
        const timeoutMs = Math.min(60_000, m.expiresAtMs - this.now());
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([this.#handle!.execute(payload, timeoutMs, this.#abort.signal), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Restricted tool outcome unknown')), timeoutMs);
          })]);
          this.#assertActive();
          if (typeof result !== 'string' || Buffer.byteLength(result) > 131_072) throw new Error('Restricted output exceeded its envelope');
          if (tool.name === 'build') {
            const receipt = JSON.parse(result) as { sourceDigest?: unknown };
            if (typeof receipt.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.sourceDigest)) throw new Error('Build provenance missing');
            this.#builtDigest = receipt.sourceDigest;
          }
          return result;
        } finally { if (timer) clearTimeout(timer); }
      });
    } catch (error) { await this.close(); throw error; }
    finally { this.#busy = false; }
  }
  /** No refund, retry, extension, reconnect or replacement. A failed kill is an unknown outcome. */
  async close(): Promise<void> {
    this.#stopped = true; this.#abort.abort();
    if (this.#deadline) clearTimeout(this.#deadline);
    if (!this.#closing) {
      // A hung durable halt must not delay the independent best-effort provider kill.
      const halt = this.store.halt(this.authorityId).catch(() => {});
      const kill = this.#handle ? this.#handle.kill().catch(() => false) : Promise.resolve(false);
      this.#closing = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([Promise.allSettled([halt, kill]), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
        } finally { if (timer) clearTimeout(timer); }
      })();
    }
    await this.#closing;
  }
}
