// Amazon Nova Sonic bidirectional streaming session (server side).
//
// Nova Sonic is a real-time SPEECH-TO-SPEECH model reached ONLY through Bedrock's
// bidirectional streaming API (InvokeModelWithBidirectionalStream) — NOT the OpenAI-
// compatible endpoint the GLM floor uses. This class owns ONE conversation: it opens the
// bidirectional stream, drives Nova Sonic's event protocol (session → prompt → system
// text → audio content), pushes the caller's mic audio in, and surfaces the model's audio
// and text back out via callbacks. Isolated under src/server/sonic/ so the whole
// experiment can be deleted in one folder if it isn't kept.
//
// NOTE: the audio path cannot be exercised without real AWS creds + a microphone, so this
// is verified for structure/typecheck/boot only; the real voice round-trip is tested on a
// deploy (see scripts/sonic-test.mjs for a standalone connection check).

import { randomUUID } from 'crypto';
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  type InvokeModelWithBidirectionalStreamInput,
} from '@aws-sdk/client-bedrock-runtime';
import { sonicModelId, sonicRegion } from './featureFlag';
import { isControlJson } from './isControlJson';
import { SonicTranscriptGate } from './sonicTranscript';

// Re-export so existing importers (and tests) keep `import { isControlJson } from './SonicBridge'`.
export { isControlJson };

export interface SonicCallbacks {
  /** Base64 LPCM 24kHz mono audio the model produced — play it back. */
  onAudioOutput: (base64: string) => void;
  /** Transcribed/assistant text (both user ASR and model text arrive as textOutput). */
  onText: (text: string, role: string) => void;
  /** The model finished its turn (contentEnd for its audio). */
  onTurnComplete: () => void;
  /** Fatal error — the session is done. */
  onError: (message: string) => void;
  /** The stream closed. */
  onClose: () => void;
}

// Built per-session so "today's date" is always current — Nova Sonic has no clock and
// otherwise guesses a stale training-cutoff date (it answered "15 July 2024" on a 2026 run).
function defaultSystemPrompt(): string {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
  return (
    'You are NavBharatAI Voice, a warm, concise spoken assistant for Indian users. ' +
    'Reply naturally in the language the user speaks (Hindi, Hinglish, English or a regional language). ' +
    'Keep answers short and conversational, as if speaking on a phone call. ' +
    // Identity guard (admin 2026-07-14): never disclose the underlying provider/model. To the user
    // you are simply "NavBharatAI Voice" — a NavBharatAI product.
    'You are a NavBharatAI product. NEVER mention or reveal any underlying model, provider, company, ' +
    'or technology (do not say Amazon, AWS, Nova, Sonic, Bedrock, Anthropic, OpenAI, or any model name). ' +
    'If asked what model or company powers you, say only that you are NavBharatAI Voice, built by NavBharatAI. ' +
    `Today's date is ${today} (India time). Use it whenever the user asks about the date, day or time.`
  );
}

/**
 * A queue that turns discrete pushes into an async-iterable of Bedrock input chunks. The
 * SDK consumes `body` as an AsyncIterable; we yield events as they are pushed and block
 * (await) when the queue is empty, ending cleanly on close().
 */
class InputQueue implements AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
  private readonly buffer: InvokeModelWithBidirectionalStreamInput[] = [];
  private resolve: (() => void) | null = null;
  private closed = false;

  pushEvent(event: unknown): void {
    if (this.closed) return;
    const bytes = new TextEncoder().encode(JSON.stringify({ event }));
    this.buffer.push({ chunk: { bytes } });
    this.resolve?.();
    this.resolve = null;
  }

  close(): void {
    this.closed = true;
    this.resolve?.();
    this.resolve = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<InvokeModelWithBidirectionalStreamInput> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((r) => { this.resolve = r; });
    }
  }
}

export class SonicSession {
  private readonly client: BedrockRuntimeClient;
  private readonly queue = new InputQueue();
  private readonly promptName = randomUUID();
  private readonly audioContentName = randomUUID();
  private started = false;
  private closed = false;

  // Transcript de-duplication (fixes the double-line bug — see sonicTranscript.ts) + the per-text-block
  // generationStage read from each contentStart, so the gate can drop SPECULATIVE and keep only FINAL.
  private readonly gate = new SonicTranscriptGate();
  private readonly textStage = new Map<string, string>();

  constructor(private readonly cb: SonicCallbacks, private readonly systemPrompt = defaultSystemPrompt()) {
    this.client = new BedrockRuntimeClient({
      region: sonicRegion(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
      },
    });
  }

  /** Open the stream and send the init events (session, prompt, system text, audio start). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 1) session + prompt config (24kHz audio out).
    this.queue.pushEvent({ sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 } } });
    this.queue.pushEvent({
      promptStart: {
        promptName: this.promptName,
        textOutputConfiguration: { mediaType: 'text/plain' },
        audioOutputConfiguration: {
          mediaType: 'audio/lpcm', sampleRateHertz: 24000, sampleSizeBits: 16,
          channelCount: 1, voiceId: process.env.SONIC_VOICE_ID || 'matthew', encoding: 'base64', audioType: 'SPEECH',
        },
      },
    });

    // 2) system prompt as a TEXT content block.
    const sysContent = randomUUID();
    this.queue.pushEvent({ contentStart: { promptName: this.promptName, contentName: sysContent, type: 'TEXT', interactive: true, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } });
    this.queue.pushEvent({ textInput: { promptName: this.promptName, contentName: sysContent, content: this.systemPrompt } });
    this.queue.pushEvent({ contentEnd: { promptName: this.promptName, contentName: sysContent } });

    // 3) open the USER audio content stream (16kHz mic in).
    this.queue.pushEvent({
      contentStart: {
        promptName: this.promptName, contentName: this.audioContentName, type: 'AUDIO', interactive: true, role: 'USER',
        audioInputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1, audioType: 'SPEECH', encoding: 'base64' },
      },
    });

    // Kick off the bidirectional call and pump responses (do not await — it runs until close).
    void this.pump();
  }

  /** Feed one base64 LPCM 16kHz mono audio chunk from the browser mic. */
  sendAudio(base64: string): void {
    if (!this.started || this.closed) return;
    this.queue.pushEvent({ audioInput: { promptName: this.promptName, contentName: this.audioContentName, content: base64 } });
  }

  /** Gracefully end the conversation (close audio content, prompt, session). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.queue.pushEvent({ contentEnd: { promptName: this.promptName, contentName: this.audioContentName } });
      this.queue.pushEvent({ promptEnd: { promptName: this.promptName } });
      this.queue.pushEvent({ sessionEnd: {} });
    } catch { /* already tearing down */ }
    this.queue.close();
  }

  private async pump(): Promise<void> {
    try {
      const command = new InvokeModelWithBidirectionalStreamCommand({ modelId: sonicModelId(), body: this.queue });
      const response = await this.client.send(command);
      if (!response.body) throw new Error('Nova Sonic returned no response stream.');
      for await (const item of response.body) {
        const bytes = item.chunk?.bytes;
        if (!bytes) continue;
        let parsed: { event?: Record<string, unknown> };
        try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { continue; }
        const event = parsed.event;
        if (!event) continue;
        if (event.audioOutput) {
          const c = (event.audioOutput as { content?: string }).content;
          if (c) this.cb.onAudioOutput(c);
        } else if (event.contentStart) {
          // Record the generationStage (SPECULATIVE | FINAL) of each TEXT content block so the gate
          // can keep only the FINAL pass. additionalModelFields is a JSON string on Nova Sonic.
          const cs = event.contentStart as { contentName?: string; type?: string; additionalModelFields?: string };
          if (cs.type === 'TEXT' && cs.contentName) {
            let stage = '';
            try { stage = String((JSON.parse(cs.additionalModelFields || '{}') as { generationStage?: string }).generationStage || ''); } catch { stage = ''; }
            this.textStage.set(cs.contentName, stage);
          }
        } else if (event.textOutput) {
          const t = event.textOutput as { content?: string; role?: string; contentName?: string };
          const role = t.role || 'ASSISTANT';
          const stage = t.contentName ? this.textStage.get(t.contentName) : '';
          // ONE shared, tested gate decides visibility: drops empties, control-JSON, SPECULATIVE
          // duplicates and A,B,A,B repeats — so every spoken line shows exactly once.
          if (this.gate.accept({ role, content: t.content || '', stage })) {
            this.cb.onText((t.content || '').trim(), role);
          }
        } else if (event.contentEnd) {
          const ce = event.contentEnd as { type?: string; contentName?: string };
          if (ce.contentName) this.textStage.delete(ce.contentName);
          if (ce.type === 'AUDIO') { this.gate.endTurn(); this.cb.onTurnComplete(); }
        }
      }
      this.cb.onClose();
    } catch (err) {
      if (!this.closed) this.cb.onError(err instanceof Error ? err.message : String(err));
      this.cb.onClose();
    }
  }
}
