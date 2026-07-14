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
import { isControlJson, isInterruptionSignal } from './isControlJson';
import { SonicTranscriptGate } from './sonicTranscript';

// Re-export so existing importers (and tests) keep `import { isControlJson } from './SonicBridge'`.
export { isControlJson, isInterruptionSignal };

export interface SonicCallbacks {
  /** Base64 LPCM 24kHz mono audio the model produced — play it back. */
  onAudioOutput: (base64: string) => void;
  /** Transcribed/assistant text (both user ASR and model text arrive as textOutput). */
  onText: (text: string, role: string) => void;
  /** The model finished its turn (contentEnd for its audio). */
  onTurnComplete: () => void;
  /** The user barged in (spoke over the assistant) — Nova Sonic signalled an interruption. The
   *  client must flush any queued playback and go quiet immediately. Optional (older callers skip). */
  onInterrupted?: () => void;
  /** Fatal error — the session is done. */
  onError: (message: string) => void;
  /** The stream closed. */
  onClose: () => void;
}

/** The two selectable voices (admin 2026-07-14). Nova Sonic's polyglot voices speak Hindi +
 *  English + Hinglish; matthew is masculine, tiffany is feminine. Env can override each id. */
export type SonicVoice = 'male' | 'female';
export function voiceIdFor(voice: SonicVoice): string {
  if (voice === 'male') return (process.env.SONIC_MALE_VOICE_ID || 'matthew').trim();
  return (process.env.SONIC_FEMALE_VOICE_ID || 'tiffany').trim();
}

/** One prior conversation turn seeded into a voice session so it CONTINUES a text chat
 *  (admin 2026-07-14: switch from text to voice → resume where it left off, not from zero). */
export interface SonicTurn { role: 'user' | 'assistant'; content: string }

// The voice-MODE clauses (expressiveness + gender + identity guard + date) — appended to whatever
// persona is in front (default NavBharatAI Voice, or a professional's own persona). Built per session
// so "today's date" is current — Nova Sonic has no clock (it once answered "15 July 2024" in 2026).
// The gender clause fixes the "मैं कर रही / कर रहा" flip-flop: self-refer with ONE consistent gender.
function voiceModeClauses(voice: SonicVoice): string {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
  const gender = voice === 'male'
    ? 'You speak with a MALE voice. When you speak Hindi, ALWAYS refer to yourself with MASCULINE grammatical forms (e.g. "मैं कर रहा हूँ", "मैं बता रहा हूँ", "मैं समझ गया") — NEVER feminine forms.'
    : 'You speak with a FEMALE voice. When you speak Hindi, ALWAYS refer to yourself with FEMININE grammatical forms (e.g. "मैं कर रही हूँ", "मैं बता रही हूँ", "मैं समझ गई") — NEVER masculine forms.';
  return (
    'You are now speaking OUT LOUD on a live voice call. Reply naturally in the language the user speaks ' +
    '(Hindi, Hinglish, English or a regional language). Keep answers short and conversational, as on a phone call. ' +
    'SPEAK LIKE A REAL HUMAN, never like a machine reading text. Be warm, expressive and emotional. ' +
    'Vary your pace and intonation naturally, take small natural pauses between thoughts, and let genuine ' +
    'feeling come through — sound happy, empathetic, curious, reassuring or excited as the moment calls for it. ' +
    'Use light, natural spoken fillers occasionally where a real person would (e.g. "hmm", "achha", "toh", "right"). ' +
    'Emphasise key words, react to what the user feels, and never sound flat, monotone or robotic. ' +
    gender + ' ' +
    'You are a NavBharatAI product. NEVER mention or reveal any underlying model, provider, company, ' +
    'or technology (do not say Amazon, AWS, Nova, Sonic, Bedrock, Anthropic, OpenAI, or any model name). ' +
    'If asked what model or company powers you, say only that you were built by NavBharatAI. ' +
    `Today's date is ${today} (India time). Use it whenever the user asks about the date, day or time.`
  );
}

/** Full system prompt: a persona (a professional's own prompt, or the default NavBharatAI Voice
 *  assistant) followed by the voice-mode clauses. The professional's identity is preserved so the
 *  Doctor voice sounds like the doctor, the Lawyer like the lawyer, etc. */
export function buildSystemPrompt(voice: SonicVoice, persona?: string): string {
  const base = (persona && persona.trim())
    ? persona.trim()
    : 'You are NavBharatAI Voice, a warm, concise spoken assistant for Indian users.';
  return `${base}\n\n${voiceModeClauses(voice)}`;
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

  private readonly systemPrompt: string;
  private readonly voice: SonicVoice;
  private readonly history: SonicTurn[];

  constructor(private readonly cb: SonicCallbacks, opts: { voice?: SonicVoice; persona?: string; history?: SonicTurn[] } = {}) {
    this.voice = opts.voice ?? 'female';
    this.history = Array.isArray(opts.history) ? opts.history.slice(-12) : []; // cap seeded context
    this.systemPrompt = buildSystemPrompt(this.voice, opts.persona);
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
          channelCount: 1, voiceId: voiceIdFor(this.voice), encoding: 'base64', audioType: 'SPEECH',
        },
      },
    });

    // 2) system prompt as a TEXT content block.
    const sysContent = randomUUID();
    this.queue.pushEvent({ contentStart: { promptName: this.promptName, contentName: sysContent, type: 'TEXT', interactive: true, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } });
    this.queue.pushEvent({ textInput: { promptName: this.promptName, contentName: sysContent, content: this.systemPrompt } });
    this.queue.pushEvent({ contentEnd: { promptName: this.promptName, contentName: sysContent } });

    // 2b) seed the prior TEXT conversation so voice CONTINUES the chat (text→voice continuity).
    // Each earlier turn is replayed as a non-interactive TEXT block in its original role.
    for (const turn of this.history) {
      const c = (turn.content || '').trim();
      if (!c) continue;
      const name = randomUUID();
      const role = turn.role === 'assistant' ? 'ASSISTANT' : 'USER';
      this.queue.pushEvent({ contentStart: { promptName: this.promptName, contentName: name, type: 'TEXT', interactive: false, role, textInputConfiguration: { mediaType: 'text/plain' } } });
      this.queue.pushEvent({ textInput: { promptName: this.promptName, contentName: name, content: c } });
      this.queue.pushEvent({ contentEnd: { promptName: this.promptName, contentName: name } });
    }

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
          // Barge-in first: an interruption control signal must flush playback, not just be dropped
          // silently. It is caught here (before the gate) so the client goes quiet the moment the
          // user speaks over the assistant. It is still never shown as a transcript line.
          if (isInterruptionSignal(t.content || '')) {
            this.cb.onInterrupted?.();
            continue;
          }
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
