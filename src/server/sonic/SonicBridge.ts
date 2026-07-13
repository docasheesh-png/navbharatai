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

const DEFAULT_SYSTEM_PROMPT =
  'You are NavBharatAI Voice, a warm, concise spoken assistant for Indian users. ' +
  'Reply naturally in the language the user speaks (Hindi, Hinglish, English or a regional language). ' +
  'Keep answers short and conversational, as if speaking on a phone call.';

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

  constructor(private readonly cb: SonicCallbacks, private readonly systemPrompt = DEFAULT_SYSTEM_PROMPT) {
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
        } else if (event.textOutput) {
          const t = event.textOutput as { content?: string; role?: string };
          if (t.content) this.cb.onText(t.content, t.role || 'ASSISTANT');
        } else if (event.contentEnd) {
          const ce = event.contentEnd as { type?: string };
          if (ce.type === 'AUDIO') this.cb.onTurnComplete();
        }
      }
      this.cb.onClose();
    } catch (err) {
      if (!this.closed) this.cb.onError(err instanceof Error ? err.message : String(err));
      this.cb.onClose();
    }
  }
}
