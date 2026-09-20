// A TUNE NEEDS NO SOUND FILE — reading notes, and playing them.
//
// 🔴 WHY THIS EXISTS, and it is a gap this repo had already WRITTEN DOWN rather than one I went
// looking for. `GameVfxAudioGenerator` ships a complete, careful Web Audio engine — buses, a voice
// cap, 3D panning, pitch variation, the unlock-on-gesture that browsers require. Its only input is
// `load(name, url)`: a sound FILE. So `AppKnowledgeBase` records the consequence as an honest limit —
// *"SOUND FILES are yours to add — until you do, the game runs perfectly and simply stays quiet"*.
//
// That limit is honest and it is also the end of the road for most users. A shopkeeper who asked for
// a game cannot produce an `.mp3`, so the app is silent for ever. What closes it is not a sample
// library: it is SYNTHESIS. A note is a frequency and an envelope, the browser has an oscillator, and
// a tune is a list of notes with times. Nothing is downloaded, nothing is licensed, nothing costs a
// paisa, and it works offline.
//
// 🇮🇳 IT READS SARGAM AS WELL AS LETTERS, which is the India-first half. `MUSIC_AI` already
// teaches `Sa Re Ga Ma Pa Dha Ni` to Indian learners; a builder that then demands `C D E F G A B`
// makes them translate their own notation to use their own app. Both are accepted here, in one line
// of text, and the sargam half is treated the way a teacher would insist on — RELATIVE to the tune's
// tonic (see `noteToMidi`), never as a second name for the white keys.
//
// PURE builder → the caller writes the files. Same shape as every other generator in this directory.

/** MIDI 69 is A4 = 440 Hz. Everything audible is derived from this one anchor. */
const A4_MIDI = 69;
const A4_HZ = 440;

/** Semitones above C for each letter. Absolute — a `C` is a C whatever the tune's key is. */
export const LETTER_SEMITONES: Readonly<Record<string, number>> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

/**
 * Semitones above Sa for each swara of the SHUDDHA (natural) scale, plus the vikrit swaras.
 *
 * ⚠️ `Sa` and `Pa` are ACHAL — they have no komal form, by the theory itself, so `_Sa` and `_Pa` are
 * not entries here and are rejected rather than quietly played a semitone down. Ma has no komal form
 * either; its vikrit form is TEEVRA (`Ma#`), a semitone UP. Getting this table wrong would not throw
 * anywhere — it would just play a raga that does not exist, which is the kind of wrong a user can
 * hear and cannot report.
 */
export const SARGAM_SEMITONES: Readonly<Record<string, number>> = {
  sa: 0, re: 2, ga: 4, ma: 5, pa: 7, dha: 9, ni: 11,
  '_re': 1, '_ga': 3, '_dha': 8, '_ni': 10, 'ma#': 6,
};

/** The short forms a learner actually writes: `S R G M P D N`. */
export const SARGAM_SHORT: Readonly<Record<string, string>> = {
  s: 'sa', r: 're', g: 'ga', m: 'ma', p: 'pa', d: 'dha', n: 'ni',
};

/**
 * 🔴 `D` AND `G` ARE THE ONLY AMBIGUOUS TOKENS IN THIS NOTATION, and pretending otherwise breaks one
 * of the two notations silently. Each is both a Western letter and a sargam short form (Dha, Ga).
 * Every other short form — `S R M P N` — is not a letter A–G, and every other swara is spelled out,
 * so the ambiguity is exactly two tokens wide.
 *
 * It is resolved by the LINE, which is how a human reads it: a line is written in ONE notation, so
 * `looksLikeSargam` finds a token that CANNOT be a Western letter and lets that decide. Without it,
 * `C D E F G A B` came out as C, Dha, E, F, Ga, A, B — a scale with two wrong notes in it, and
 * nothing anywhere failed. Found by a test, not by ear.
 *
 * A token on its OWN has no line to read, so `noteToMidi` defaults `D`/`G` to the Western letter:
 * `C D E F G` is how a letter is normally written, while sargam's normal form is `Sa Re Ga` and the
 * short forms are a convenience on top.
 */
export const AMBIGUOUS_SHORT: ReadonlySet<string> = new Set(['d', 'g']);

/** Tokens that cannot be a Western letter, so finding one settles the dialect of the line. */
const UNAMBIGUOUS_SARGAM = /^(?:sa|re|ga|ma|pa|dha|ni|s|r|m|p|n|ma#|_(?:re|ga|dha|ni))$/;


/** A4 = 440 Hz equal temperament. PURE. */
export function midiToFrequency(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** One sounding note (or a rest), placed in beats from the start of its phrase. */
export interface ParsedNote {
  /** MIDI number, or `null` for a rest. */
  midi: number | null;
  /** Where it begins, in beats. Chord members share this. */
  startBeat: number;
  /** How long it sounds, in beats. */
  beats: number;
}

export interface ParsedPhrase {
  notes: ParsedNote[];
  /**
   * The phrase's full length in beats — INCLUDING a trailing rest.
   *
   * This is what a loop and a canon entry are measured against, which is why it is the running
   * cursor rather than the end of the last sounding note: a two-bar phrase whose second bar is
   * silence must still take two bars before it repeats, or the ground drifts against the melody.
   */
  beats: number;
}

/**
 * One token → a MIDI number. PURE. Returns `null` for a rest, `undefined` for something unreadable.
 *
 * 🔑 THE ONE MUSICAL DECISION IN THIS FILE: sargam is RELATIVE, letters are ABSOLUTE.
 * `Sa` is whatever the tune's tonic is, so the same sargam line transposes to any key by changing one
 * field — which is what sargam MEANS. Treating `Sa` as a fixed C would be the common western
 * mistake, and it would make every sargam tune this engine plays sound like it was written in C
 * whatever the singer's own scale is. `C4` meanwhile is 261.6 Hz in every tune, as it must be.
 *
 * Accepted: `C`, `F#`, `Bb`, `C4`, `A5`, and `'` / `,` for an octave up / down; `Sa`, `_Re`, `Ma#`,
 * `S R G M P D N`, with the same octave marks. `z` is a rest. Case is ignored.
 */
export function noteToMidi(
  token: string,
  tonicMidi: number,
  options: { sargam?: boolean } = {},
): number | null | undefined {
  let t = String(token || '').trim();
  if (!t) return undefined;

  // Octave marks are stripped first so they can sit on either notation without a second rule.
  let octaveShift = 0;
  t = t.replace(/'/g, () => { octaveShift += 12; return ''; });
  t = t.replace(/,/g, () => { octaveShift -= 12; return ''; });
  t = t.trim();
  if (!t) return undefined;

  const lower = t.toLowerCase();
  if (lower === 'z' || lower === '-') return null;

  // SARGAM. Longest names first: `d` is Dha and `dha` must not be read as `d` + `ha`.
  const sargam = options.sargam === true;
  const sargamKey = lower.startsWith('_')
    ? '_' + expandShort(lower.slice(1), sargam)
    : expandShort(lower, sargam);
  if (Object.prototype.hasOwnProperty.call(SARGAM_SEMITONES, sargamKey)) {
    return tonicMidi + SARGAM_SEMITONES[sargamKey]! + octaveShift;
  }
  // A komal on an achal swara is rejected, not shifted. See SARGAM_SEMITONES.
  if (lower.startsWith('_')) return undefined;

  // WESTERN letter, optional accidental, optional absolute octave digit.
  const m = /^([a-g])(#|b|♯|♭)?(-?\d)?$/.exec(lower);
  if (!m) return undefined;
  const base = LETTER_SEMITONES[m[1]!]!;
  const accidental = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  // MIDI octave numbering: C4 = 60, so the octave number is offset by 1 from the MIDI octave.
  const octave = m[3] === undefined ? 4 : Number(m[3]);
  return (octave + 1) * 12 + base + accidental + octaveShift;
}

function expandShort(name: string, sargamLine: boolean): string {
  if (name.length !== 1) return name;
  if (!Object.prototype.hasOwnProperty.call(SARGAM_SHORT, name)) return name;
  // A bare `D` or `G` outside a sargam line is the Western letter. See AMBIGUOUS_SHORT.
  if (AMBIGUOUS_SHORT.has(name) && !sargamLine) return name;
  return SARGAM_SHORT[name]!;
}

/**
 * Is this line written in sargam? Decided ONLY from tokens that cannot be a Western letter, so a
 * line of letters is never dragged into sargam by its `D` or its `G`. PURE.
 */
export function looksLikeSargam(source: string): boolean {
  for (const group of tokenize(String(source || ''))) {
    for (const raw of group.tokens) {
      // Exactly the two octave marks the reader itself strips: an apostrophe and a comma.
      const bare = splitDuration(raw).token.replace(/[',]/g, '').trim().toLowerCase();
      if (UNAMBIGUOUS_SARGAM.test(bare)) return true;
    }
  }
  return false;
}

/**
 * Read a line of notes into placed, timed notes. PURE — no audio, no clock.
 *
 * The language, complete:
 *   `Sa Re Ga`      three notes, one beat each
 *   `Sa*2`          two beats long
 *   `Ga/2`          half a beat
 *   `Sa*1.5`        a dotted note — which is what makes 12/8 and a swung feel possible
 *   `z`             a rest (`z*2` for a longer one)
 *   `-`             hold the previous note one more beat (a tie)
 *   `[Sa Ga Pa]`    a chord: all at once, the group taking the longest member's length
 *
 * ⚠️ AN UNREADABLE TOKEN IS A REST, NEVER A GUESS. A typo must not become a wrong note: silence in
 * the right place is obviously a mistake and a plausible wrong pitch is not. `unreadable` carries the
 * offending tokens so a caller can say so honestly instead of the tune quietly changing.
 */
export function parseMelody(
  source: string,
  options: { tonic?: string } = {},
): ParsedPhrase & { unreadable: string[] } {
  const tonicMidi = resolveTonic(options.tonic);
  // The dialect is read ONCE per line, then every token in it is read the same way.
  const sargam = looksLikeSargam(source);
  const notes: ParsedNote[] = [];
  const unreadable: string[] = [];
  let cursor = 0;

  for (const group of tokenize(String(source || ''))) {
    if (group.chord) {
      let longest = 0;
      for (const raw of group.tokens) {
        const { token, beats } = splitDuration(raw);
        const midi = noteToMidi(token, tonicMidi, { sargam });
        if (midi === undefined) { unreadable.push(raw); continue; }
        if (midi !== null) notes.push({ midi, startBeat: cursor, beats });
        longest = Math.max(longest, beats);
      }
      // An all-unreadable chord still takes its place in time — one beat, silent.
      cursor += longest || 1;
      continue;
    }

    const raw = group.tokens[0]!;
    const { token, beats } = splitDuration(raw);

    // A tie lengthens the note already placed rather than adding a silent one.
    if (token === '-') {
      const last = notes[notes.length - 1];
      if (last && last.startBeat + last.beats >= cursor - 1e-9) last.beats += beats;
      cursor += beats;
      continue;
    }

    const midi = noteToMidi(token, tonicMidi, { sargam });
    if (midi === undefined) { unreadable.push(raw); cursor += beats; continue; }
    if (midi !== null) notes.push({ midi, startBeat: cursor, beats });
    cursor += beats;
  }

  return { notes, beats: cursor, unreadable };
}

function resolveTonic(tonic: string | undefined): number {
  if (!tonic) return 60; // C4 — the tonic a harmonium's Sa sits on by default here.
  const midi = noteToMidi(tonic, 60);
  return typeof midi === 'number' ? midi : 60;
}

/** `Ga/2` → `{ token: 'Ga', beats: 0.5 }`. A missing or nonsense duration is one beat. */
function splitDuration(raw: string): { token: string; beats: number } {
  const m = /^(.*?)(?:([*/])(\d+(?:\.\d+)?))?$/.exec(raw);
  if (!m) return { token: raw, beats: 1 };
  const token = m[1] || raw;
  const n = m[3] === undefined ? NaN : Number(m[3]);
  if (!Number.isFinite(n) || n <= 0) return { token, beats: 1 };
  return { token, beats: m[2] === '/' ? 1 / n : n };
}

function tokenize(src: string): Array<{ chord: boolean; tokens: string[] }> {
  const out: Array<{ chord: boolean; tokens: string[] }> = [];
  // `|` is a bar line: musicians write them and they carry no time of their own.
  const flat = src.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  let i = 0;
  while (i < flat.length) {
    if (flat[i] === ' ') { i += 1; continue; }
    if (flat[i] === '[') {
      const close = flat.indexOf(']', i);
      if (close === -1) { // an unclosed chord is the rest of the line, not a crash
        out.push({ chord: true, tokens: flat.slice(i + 1).split(' ').filter(Boolean) });
        break;
      }
      out.push({ chord: true, tokens: flat.slice(i + 1, close).split(' ').filter(Boolean) });
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < flat.length && flat[j] !== ' ' && flat[j] !== '[') j += 1;
    out.push({ chord: false, tokens: [flat.slice(i, j)] });
    i = j;
  }
  return out;
}

// ── What the app gets ────────────────────────────────────────────────────────────────────────────
//
// ⚠️ THE ONE DUPLICATION IN THIS FILE, STATED RATHER THAN LEFT TO BE DISCOVERED. The emitted app
// carries its own copy of the reader, because it runs in the USER's browser and cannot import from
// our server — the same constraint every generator in this directory lives under. What is NOT
// duplicated is the part that would be dangerous to get differently twice: the PITCH TABLES are
// interpolated from the constants above, so a `_Ga` is the same semitone in the app as in the tests
// by construction. And the exported readers are not decoration either — `generateMelody` VALIDATES
// every built-in tune with them before emitting it, so a tune this engine ships is a tune that
// parsed.

const NOTATION_MODULE = `/**
 * Reading notes — Western letters AND Indian sargam, in one line of text.
 *
 * THE MUSICAL DECISION: sargam is RELATIVE to the tune's tonic, letters are ABSOLUTE. 'Sa' is
 * whatever 'tonic' says, so the same line transposes to any singer's scale by changing one field —
 * which is what sargam means. 'C4' is 261.6 Hz in every tune, as it must be.
 *
 * The language, complete:
 *   Sa Re Ga       three notes, one beat each
 *   Sa*2           two beats      Ga/2   half a beat      Sa*1.5  a dotted note
 *   z              a rest         -      hold the previous note one more beat
 *   [Sa Ga Pa]     a chord, all at once
 *   |              a bar line, carries no time
 *   Sa' / Sa,      an octave up / down       _Re  komal Re       Ma#  teevra Ma
 *
 * 'D' and 'G' are the only tokens the two notations share (Dha / Ga). The LINE decides: a line
 * holding any spelled-out swara or 'S R M P N' reads them as swaras, otherwise as letters — so
 * 'C D E F G A B' and 'S R G M P D N' are both correct. Spell 'Dha' / 'Ga' to be certain.
 *
 * AN UNREADABLE TOKEN BECOMES A REST, NEVER A GUESS: silence in the right place is obviously a
 * mistake, a plausible wrong pitch is not. PURE — no audio, no clock, safe to unit-test.
 */
export const LETTER_SEMITONES: Readonly<Record<string, number>> = ${JSON.stringify(LETTER_SEMITONES)};

/** Sa and Pa are ACHAL — no komal form exists, so '_Sa' is rejected, not shifted. Ma goes UP ('Ma#'). */
export const SARGAM_SEMITONES: Readonly<Record<string, number>> = ${JSON.stringify(SARGAM_SEMITONES)};

export const SARGAM_SHORT: Readonly<Record<string, string>> = ${JSON.stringify(SARGAM_SHORT)};

/**
 * 'D' and 'G' are the ONLY ambiguous tokens here: each is both a Western letter and a sargam short
 * form (Dha, Ga). Every other short form (S R M P N) is not a letter A-G and every other swara is
 * spelled out, so the ambiguity is two tokens wide — and it is settled by the LINE, the way a human
 * reads it. Without this, 'C D E F G A B' came out as C, Dha, E, F, Ga, A, B.
 *
 * A token on its own has no line to read, so noteToMidi defaults D/G to the Western letter.
 */
export const AMBIGUOUS_SHORT: ReadonlySet<string> = new Set(${JSON.stringify([...AMBIGUOUS_SHORT])});

const UNAMBIGUOUS_SARGAM = /^(?:sa|re|ga|ma|pa|dha|ni|s|r|m|p|n|ma#|_(?:re|ga|dha|ni))$/;

export interface ParsedNote { midi: number | null; startBeat: number; beats: number }
export interface ParsedPhrase { notes: ParsedNote[]; beats: number; unreadable: string[] }

/** A4 = 440 Hz, equal temperament. */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function expandShort(name: string, sargamLine: boolean): string {
  if (name.length !== 1) return name;
  if (!Object.prototype.hasOwnProperty.call(SARGAM_SHORT, name)) return name;
  // A bare 'D' or 'G' outside a sargam line is the Western letter. See AMBIGUOUS_SHORT.
  if (AMBIGUOUS_SHORT.has(name) && !sargamLine) return name;
  return SARGAM_SHORT[name];
}

/**
 * Is this line written in sargam? Decided ONLY from tokens that cannot be a Western letter, so a
 * line of letters is never dragged into sargam by its 'D' or its 'G'. PURE.
 */
export function looksLikeSargam(source: string): boolean {
  for (const group of tokenize(String(source || ''))) {
    for (const raw of group.tokens) {
      // Exactly the two octave marks the reader itself strips: an apostrophe and a comma.
      const bare = splitDuration(raw).token.replace(/[',]/g, '').trim().toLowerCase();
      if (UNAMBIGUOUS_SARGAM.test(bare)) return true;
    }
  }
  return false;
}

/** One token to a MIDI number. null = a rest, undefined = unreadable. */
export function noteToMidi(
  token: string,
  tonicMidi: number,
  options: { sargam?: boolean } = {},
): number | null | undefined {
  let t = String(token || '').trim();
  if (!t) return undefined;
  let octaveShift = 0;
  t = t.replace(/'/g, () => { octaveShift += 12; return ''; });
  t = t.replace(/,/g, () => { octaveShift -= 12; return ''; });
  t = t.trim();
  if (!t) return undefined;

  const lower = t.toLowerCase();
  if (lower === 'z' || lower === '-') return null;

  const sargam = options.sargam === true;
  const sargamKey = lower.startsWith('_')
    ? '_' + expandShort(lower.slice(1), sargam)
    : expandShort(lower, sargam);
  if (Object.prototype.hasOwnProperty.call(SARGAM_SEMITONES, sargamKey)) {
    return tonicMidi + SARGAM_SEMITONES[sargamKey] + octaveShift;
  }
  if (lower.startsWith('_')) return undefined;

  const m = /^([a-g])(#|b|\u266f|\u266d)?(-?\\d)?$/.exec(lower);
  if (!m) return undefined;
  const base = LETTER_SEMITONES[m[1]];
  const sharp = m[2] === '#' || m[2] === '\u266f';
  const flat = m[2] === 'b' || m[2] === '\u266d';
  const accidental = sharp ? 1 : flat ? -1 : 0;
  const octave = m[3] === undefined ? 4 : Number(m[3]);
  return (octave + 1) * 12 + base + accidental + octaveShift;
}

function splitDuration(raw: string): { token: string; beats: number } {
  const m = /^(.*?)(?:([*/])(\\d+(?:\\.\\d+)?))?$/.exec(raw);
  if (!m) return { token: raw, beats: 1 };
  const token = m[1] || raw;
  const n = m[3] === undefined ? NaN : Number(m[3]);
  if (!Number.isFinite(n) || n <= 0) return { token, beats: 1 };
  return { token, beats: m[2] === '/' ? 1 / n : n };
}

function tokenize(src: string): Array<{ chord: boolean; tokens: string[] }> {
  const out: Array<{ chord: boolean; tokens: string[] }> = [];
  const flat = src.replace(/\\|/g, ' ').replace(/\\s+/g, ' ').trim();
  let i = 0;
  while (i < flat.length) {
    if (flat[i] === ' ') { i += 1; continue; }
    if (flat[i] === '[') {
      const close = flat.indexOf(']', i);
      if (close === -1) {
        out.push({ chord: true, tokens: flat.slice(i + 1).split(' ').filter(Boolean) });
        break;
      }
      out.push({ chord: true, tokens: flat.slice(i + 1, close).split(' ').filter(Boolean) });
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < flat.length && flat[j] !== ' ' && flat[j] !== '[') j += 1;
    out.push({ chord: false, tokens: [flat.slice(i, j)] });
    i = j;
  }
  return out;
}

export function resolveTonic(tonic?: string): number {
  if (!tonic) return 60;
  const midi = noteToMidi(tonic, 60);
  return typeof midi === 'number' ? midi : 60;
}

export function parseMelody(source: string, options: { tonic?: string } = {}): ParsedPhrase {
  const tonicMidi = resolveTonic(options.tonic);
  // The dialect is read ONCE per line, then every token in it is read the same way.
  const sargam = looksLikeSargam(source);
  const notes: ParsedNote[] = [];
  const unreadable: string[] = [];
  let cursor = 0;

  for (const group of tokenize(String(source || ''))) {
    if (group.chord) {
      let longest = 0;
      for (const raw of group.tokens) {
        const { token, beats } = splitDuration(raw);
        const midi = noteToMidi(token, tonicMidi, { sargam });
        if (midi === undefined) { unreadable.push(raw); continue; }
        if (midi !== null) notes.push({ midi, startBeat: cursor, beats });
        longest = Math.max(longest, beats);
      }
      cursor += longest || 1;
      continue;
    }
    const raw = group.tokens[0];
    const { token, beats } = splitDuration(raw);
    if (token === '-') {
      const last = notes[notes.length - 1];
      if (last && last.startBeat + last.beats >= cursor - 1e-9) last.beats += beats;
      cursor += beats;
      continue;
    }
    const midi = noteToMidi(token, tonicMidi, { sargam });
    if (midi === undefined) { unreadable.push(raw); cursor += beats; continue; }
    if (midi !== null) notes.push({ midi, startBeat: cursor, beats });
    cursor += beats;
  }

  return { notes, beats: cursor, unreadable };
}
`;

const TIMELINE_MODULE = `
// ── Laying a tune out in time ────────────────────────────────────────────────────────────────────

/** One line of the tune. Several voices make a round, or a melody over a ground. */
export interface MelodyVoice {
  notes: string;
  /**
   * Beats this voice waits before it starts. THIS IS WHAT MAKES A ROUND (a rota): the same melody,
   * entered late by a second voice, so it harmonises with itself.
   */
  entryBeats?: number;
  /**
   * A GROUND (a 'pes'): this voice repeats under the whole tune instead of playing once. Two short
   * grounds under a canon is the medieval rota's own structure and still the cheapest way to make a
   * few bars sound like a piece.
   */
  loop?: boolean;
  gain?: number;
  wave?: 'sine' | 'triangle' | 'square' | 'sawtooth';
}

export interface Tune {
  name: string;
  /** Beats per minute. A beat is whatever one bare note is worth. */
  bpm: number;
  /** What 'Sa' means. Letters ignore it. Default C4. */
  tonic?: string;
  voices: MelodyVoice[];
}

export interface ScheduledNote {
  freq: number;
  /** Seconds from the start of the tune. */
  at: number;
  dur: number;
  gain: number;
  wave: string;
}

export interface Timeline {
  notes: ScheduledNote[];
  seconds: number;
  /** Tokens that could not be read — they became rests. Show them; never let the tune change quietly. */
  unreadable: string[];
}

/** A backstop, not a limit anyone should reach: a ground under a long tune, not an infinite loop. */
const MAX_GROUND_REPEATS = 512;

/**
 * Turn a tune into a flat, time-ordered list of notes in SECONDS. PURE — no audio, no clock.
 *
 * Everything hard about playing music is decided here, where it can be tested, so the audio half
 * below is only 'make this frequency at this time'.
 *
 * HOW LONG THE TUNE IS: the voices that play ONCE decide it. A ground repeats to fill that length —
 * so adding a ground can never extend a tune, and a tune of nothing but grounds falls back to its
 * longest phrase rather than running for ever.
 */
export function buildTimeline(tune: Tune): Timeline {
  const notes: ScheduledNote[] = [];
  const unreadable: string[] = [];
  const beatSeconds = 60 / (Number(tune?.bpm) > 0 ? Number(tune.bpm) : 96);
  const voices = Array.isArray(tune?.voices) ? tune.voices : [];

  const parsed = voices.map((voice) => {
    const phrase = parseMelody(voice?.notes || '', { tonic: tune?.tonic });
    for (const bad of phrase.unreadable) unreadable.push(bad);
    return { voice, phrase, entry: Math.max(0, Number(voice?.entryBeats) || 0) };
  });

  const endOf = (p: { phrase: { beats: number }; entry: number }) => p.entry + p.phrase.beats;
  const once = parsed.filter((p) => !p.voice?.loop);
  const spanBeats = (once.length > 0 ? once : parsed).reduce((m, p) => Math.max(m, endOf(p)), 0);

  for (const { voice, phrase, entry } of parsed) {
    const gain = Number.isFinite(Number(voice?.gain)) && Number(voice.gain) > 0 ? Number(voice.gain) : 1;
    const wave = voice?.wave || 'triangle';

    // A phrase of no length can never be repeated — without this, an empty ground spins for ever.
    const repeats = voice?.loop && phrase.beats > 0
      ? Math.min(MAX_GROUND_REPEATS, Math.max(1, Math.ceil((spanBeats - entry) / phrase.beats)))
      : 1;

    for (let r = 0; r < repeats; r += 1) {
      const offset = entry + r * phrase.beats;
      if (voice?.loop && r > 0 && offset >= spanBeats - 1e-9) break;
      for (const note of phrase.notes) {
        if (note.midi === null) continue;
        const startBeat = offset + note.startBeat;
        let beats = note.beats;
        if (voice?.loop) {
          // A GROUND MUST NOT OUTLAST THE MELODY IT HOLDS UP. Caught by running it: a 4-beat ground
          // under an 18-beat round ran to beat 20, so the ACCOMPANIMENT had silently lengthened the
          // tune — and looping that tune would leave a ragged gap before the melody came back.
          if (startBeat >= spanBeats - 1e-9) continue;
          beats = Math.min(beats, spanBeats - startBeat);
        }
        notes.push({
          freq: midiToFrequency(note.midi),
          at: startBeat * beatSeconds,
          dur: beats * beatSeconds,
          gain,
          wave,
        });
      }
    }
  }

  notes.sort((a, b) => a.at - b.at);
  const seconds = notes.reduce((m, n) => Math.max(m, n.at + n.dur), spanBeats * beatSeconds);
  return { notes, seconds, unreadable };
}
`;

const MELODY_MODULE = `import { buildTimeline } from './notation';
import type { Timeline, Tune } from './notation';

/**
 * Playing a tune in the browser. No sound files, no dependency, no network, no cost.
 *
 * FOUR MISTAKES THIS AVOIDS, each of which is what a hand-rolled attempt actually sounds like:
 *
 *   • ONE setTimeout PER NOTE. JavaScript timers drift by tens of milliseconds, and a background tab
 *     clamps them to once a second — so the tune plays late, unevenly, and falls apart the moment the
 *     user looks at another tab. Web Audio has its OWN clock; a note must be booked against
 *     ctx.currentTime, and the only job of a timer is to book the notes a little way ahead.
 *
 *   • A GAIN THAT STARTS AT FULL VOLUME. Beginning or ending a note on a non-zero gain is a step
 *     change in the waveform, and the ear hears a step change as a CLICK — on every single note. The
 *     fix is a few milliseconds of ramp at each end, which is the whole difference between 'a tune'
 *     and 'a tune with a tick on it'.
 *
 *   • exponentialRampToValueAtTime(0, t). Illegal — the target must be non-zero, and passing 0
 *     throws and kills the note. The ramps here are LINEAR to 0 for exactly that reason.
 *
 *   • NOT UNLOCKING THE CONTEXT ON A GESTURE. Every browser suspends audio until the user touches
 *     the page. This is THE reason 'there is no sound in my app', and it is one line.
 */
export interface PlayOptions {
  /** Repeat the whole tune until stop(). */
  loop?: boolean;
  /** 0..1 over the player's own volume. */
  gain?: number;
  /** Called once the last note has finished (never when stopped, and never when looping). */
  onEnd?: () => void;
}

const LOOKAHEAD_SECONDS = 0.15;
const TICK_MS = 25;
const ATTACK = 0.012;

export class MelodyPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private live = new Set<OscillatorNode>();
  private timeline: Timeline | null = null;
  private cursor = 0;
  private startedAt = 0;
  private opts: PlayOptions = {};
  private unlocked = false;
  private volume: number;

  /** Default 0.25: several voices SUM, and summing four at full gain clips the master into mud. */
  constructor(volume = 0.25) { this.volume = volume; }

  /** MUST be called from a real user gesture. Safe to call repeatedly; the listeners remove themselves. */
  unlock(): void {
    if (this.unlocked || typeof window === 'undefined') return;
    const resume = () => {
      this.init();
      void this.ctx?.resume();
      this.unlocked = true;
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      window.removeEventListener('touchstart', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    window.addEventListener('touchstart', resume);
  }

  private init(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no Web Audio: the app must still work, just silently
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  get playing(): boolean { return this.timer !== null; }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /** Read the tune once, then book its notes a little ahead of the audio clock until it ends. */
  play(tune: Tune, options: PlayOptions = {}): Timeline | null {
    this.stop();
    this.init();
    if (!this.ctx || !this.master) return null;
    void this.ctx.resume();

    const timeline = buildTimeline(tune);
    if (timeline.notes.length === 0) return timeline;

    this.timeline = timeline;
    this.opts = options;
    this.cursor = 0;
    // A beat of headroom so the first note is booked in the future, not already late.
    this.startedAt = this.ctx.currentTime + 0.06;
    if (typeof options.gain === 'number') this.setVolume(options.gain);

    this.pump();
    this.timer = setInterval(() => this.pump(), TICK_MS);
    return timeline;
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.timeline = null;
    const ctx = this.ctx;
    for (const osc of this.live) {
      try {
        // Ramp down before stopping: cutting a running oscillator dead is itself a click.
        if (ctx) {
          const g = (osc as unknown as { __gain?: GainNode }).__gain;
          if (g) {
            g.gain.cancelScheduledValues(ctx.currentTime);
            g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
            g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.03);
          }
          osc.stop(ctx.currentTime + 0.04);
        } else {
          osc.stop();
        }
      } catch { /* already stopped — nothing to do */ }
    }
    this.live.clear();
  }

  private pump(): void {
    const ctx = this.ctx;
    const timeline = this.timeline;
    if (!ctx || !this.master || !timeline) return;

    const horizon = ctx.currentTime + LOOKAHEAD_SECONDS;
    while (this.cursor < timeline.notes.length) {
      const note = timeline.notes[this.cursor];
      const at = this.startedAt + note.at;
      if (at > horizon) break;
      this.voice(note.freq, Math.max(at, ctx.currentTime), note.dur, note.gain, note.wave);
      this.cursor += 1;
    }

    if (this.cursor < timeline.notes.length) return;
    const finishesAt = this.startedAt + timeline.seconds;
    if (ctx.currentTime < finishesAt) return;

    if (this.opts.loop) {
      this.cursor = 0;
      this.startedAt = finishesAt;
      return;
    }
    const onEnd = this.opts.onEnd;
    this.stop();
    if (onEnd) { try { onEnd(); } catch { /* a listener must not break the player */ } }
  }

  private voice(freq: number, at: number, dur: number, gain: number, wave: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = (wave as OscillatorType) || 'triangle';
    osc.frequency.value = freq;

    const g = ctx.createGain();
    // A short note gets a short release; a long one is never cut on more than 80ms.
    const release = Math.min(0.08, Math.max(0.01, dur * 0.35));
    const attack = Math.min(ATTACK, Math.max(0.004, dur * 0.2));
    const end = at + dur;
    const peak = Math.max(0.0001, Math.min(1, gain));
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, Math.max(at + attack, end - release));
    // LINEAR, not exponential: an exponential ramp to 0 is illegal and throws.
    g.gain.linearRampToValueAtTime(0, end);

    osc.connect(g);
    g.connect(this.master);
    (osc as unknown as { __gain?: GainNode }).__gain = g;

    osc.start(at);
    osc.stop(end + 0.02);
    this.live.add(osc);
    osc.onended = () => {
      this.live.delete(osc);
      try { osc.disconnect(); g.disconnect(); } catch { /* already gone */ }
    };
  }
}

/** One player is enough for an app; a second one just fights the first for the speakers. */
export const melody = new MelodyPlayer();
`;

const TUNES_MODULE = `import type { Tune } from './notation';

/**
 * Ready tunes. Copy one, change the notes, and it is your own.
 *
 * ⚠️ EVERY TUNE HERE IS EITHER A SCALE EXERCISE (whose notes are fixed by the theory itself) OR
 * WRITTEN FOR THIS FILE. None is a transcription of a published piece — not for licensing reasons
 * but for an honesty one: a melody written down from memory is a melody that may be WRONG, and a
 * wrong tune is not something a user can detect or report. Add a real piece by typing its notes.
 */

/** The shuddha (natural) scale, ascending. Sa is whatever 'tonic' says — change it to any key. */
export const SARGAM_ASCENT: Tune = {
  name: 'Sargam — Sa to Sa',
  bpm: 108,
  tonic: 'C4',
  voices: [{ notes: 'Sa Re Ga Ma Pa Dha Ni Sa*2', wave: 'triangle' }],
};

/** The first alankar every student is given: three notes, then move up one and repeat. */
export const FIRST_ALANKAR: Tune = {
  name: 'First alankar',
  bpm: 132,
  tonic: 'C4',
  voices: [{
    notes: 'Sa Re Ga | Re Ga Ma | Ga Ma Pa | Ma Pa Dha | Pa Dha Ni | Dha Ni Sa*2',
    wave: 'triangle',
  }],
};

/** The same thing in letters, for an app that thinks in keys rather than swaras. */
export const MAJOR_SCALE: Tune = {
  name: 'Major scale',
  bpm: 120,
  voices: [{ notes: 'C D E F G A B C*2', wave: 'triangle' }],
};

/**
 * A ROUND (a rota) — ONE phrase, entered three times a bar apart, over two repeating grounds.
 *
 * 🔑 WHY IT IS CONSONANT BY CONSTRUCTION rather than by luck: every note in every voice is a tone of
 * the SAME triad (Sa, Ga, Pa — root, third, fifth). Notes of one triad are consonant with each other
 * in any combination, so the phrase cannot clash with itself at ANY entry delay and the grounds
 * cannot clash with it either. That is the trick a round is built on, and it is why four bars of
 * material can fill a whole piece. Change the entry delay or add a fourth voice and it still holds —
 * a test checks the property, which is what makes this a claim rather than an opinion.
 */
export const ROUND: Tune = {
  name: 'Round (rota)',
  bpm: 152,
  tonic: 'F4',
  voices: [
    { notes: 'Sa Ga Pa Ga Sa*2', entryBeats: 0, wave: 'triangle' },
    { notes: 'Sa Ga Pa Ga Sa*2', entryBeats: 6, gain: 0.8, wave: 'triangle' },
    { notes: 'Sa Ga Pa Ga Sa*2', entryBeats: 12, gain: 0.7, wave: 'triangle' },
    // The two grounds — a 'pes'. Short, repeating, and the reason the round has a floor to stand on.
    { notes: 'Sa,*2 Pa,*2', loop: true, gain: 0.55, wave: 'sine' },
    { notes: 'Ga,*4', loop: true, gain: 0.4, wave: 'sine' },
  ],
};

/** Short cues — the sounds an app needs and has no file for. Written here, so they are ours. */
export const CUES: Record<string, Tune> = {
  chime:   { name: 'Chime',    bpm: 240, voices: [{ notes: 'C5 E5 G5', wave: 'sine' }] },
  success: { name: 'Success',  bpm: 260, voices: [{ notes: 'C5 E5 G5 C6*2', wave: 'triangle' }] },
  error:   { name: 'Error',    bpm: 200, voices: [{ notes: 'E4 C4*2', wave: 'square', gain: 0.5 }] },
  coin:    { name: 'Coin',     bpm: 420, voices: [{ notes: 'B5 E6*2', wave: 'square', gain: 0.5 }] },
  levelUp: { name: 'Level up', bpm: 300, voices: [{ notes: 'C5 D5 E5 G5 C6*2', wave: 'triangle' }] },
  tap:     { name: 'Tap',      bpm: 600, voices: [{ notes: 'A5', wave: 'sine', gain: 0.4 }] },
};

export const TUNES: Record<string, Tune> = {
  sargam: SARGAM_ASCENT,
  alankar: FIRST_ALANKAR,
  scale: MAJOR_SCALE,
  round: ROUND,
  ...CUES,
};
`;

/** The files this generator can emit, by the short name `include` accepts. */
export const MELODY_MODULES: Readonly<Record<string, string>> = {
  notation: 'src/audio/notation.ts',
  melody: 'src/audio/melody.ts',
  tunes: 'src/audio/tunes.ts',
};

const FILES: Record<string, string> = {
  'src/audio/notation.ts': NOTATION_MODULE + TIMELINE_MODULE,
  'src/audio/melody.ts': MELODY_MODULE,
  'src/audio/tunes.ts': TUNES_MODULE,
};

export interface MelodyResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/**
 * Every built-in tune, read with the SAME reader the app will use. Returns the problems found.
 *
 * This is why the readers above are exported rather than private: a tune this engine ships must be
 * a tune that parses, and a test asserts this list is empty. A silently unreadable built-in would
 * play as rests — a tune that is simply missing notes, with nothing failing anywhere.
 */
export function validateBuiltInTunes(): string[] {
  const problems: string[] = [];
  const lines = TUNES_MODULE.match(/notes: '([^']*)'/g) || [];
  if (lines.length === 0) problems.push('no tune lines found in the emitted library');
  for (const line of lines) {
    const notation = line.slice("notes: '".length, -1);
    const parsed = parseMelody(notation, { tonic: 'C4' });
    if (parsed.unreadable.length > 0) {
      problems.push(`unreadable in "${notation}": ${parsed.unreadable.join(', ')}`);
    }
    if (parsed.notes.length === 0) problems.push(`no notes parsed from "${notation}"`);
  }
  return problems;
}

/**
 * Build the melody engine. PURE — the caller writes the files.
 *
 * `include` takes a subset of `notation` / `melody` / `tunes`. Asking for the player alone still
 * brings the reader, because the player imports it — a subset that cannot compile is not a subset.
 */
export function generateMelody(include?: string[]): MelodyResult {
  const wanted = new Set((include || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  let files: Record<string, string>;

  if (wanted.size === 0) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [name, path] of Object.entries(MELODY_MODULES)) {
      if (wanted.has(name)) files[path] = FILES[path]!;
    }
    // The player and the library both import the reader; emitting either without it will not build.
    if (files['src/audio/melody.ts'] || files['src/audio/tunes.ts']) {
      files['src/audio/notation.ts'] = FILES['src/audio/notation.ts']!;
    }
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    // Web Audio is the browser's own API and a note is arithmetic. Nothing to install, nothing to fetch.
    dependencies: [],
    instructions:
      `Added the melody engine (${Object.keys(files).length} files under src/audio).\n`
      + '```ts\n'
      + "import { melody } from './audio/melody';\n"
      + "import { TUNES } from './audio/tunes';\n"
      + '\n'
      + 'melody.unlock();                       // MUST happen; browsers suspend audio until a gesture\n'
      + 'melody.play(TUNES.round, { loop: true });\n'
      + 'melody.play(TUNES.success);            // a short cue\n'
      + 'melody.stop();\n'
      + '\n'
      + '// Your own tune — one line of notes:\n'
      + "melody.play({ name: 'Mine', bpm: 120, tonic: 'C4', voices: [\n"
      + "  { notes: 'Sa Re Ga Ma | Pa*2 Ga*2' },          // sargam, relative to tonic\n"
      + "  { notes: 'Sa,*2 Pa,*2', loop: true, gain: 0.5 } // a ground under it\n"
      + '] });\n'
      + '```\n'
      + 'THE NOTATION (Indian sargam and Western letters, in one line):\n'
      + '- `Sa Re Ga Ma Pa Dha Ni` (or `S R G M P D N`), komal as `_Re` `_Ga` `_Dha` `_Ni`, teevra as `Ma#`.\n'
      + '  Sargam is RELATIVE to `tonic`, so one line transposes to any key by changing that field.\n'
      + '- `C D E F G A B`, with `F#` / `Bb` and an absolute octave (`C4`, `A5`). A `C` is always a C.\n'
      + "- `Sa'` an octave up, `Sa,` an octave down. `Sa*2` two beats, `Ga/2` half, `Sa*1.5` dotted.\n"
      + '- `D` and `G` are the only tokens both notations share (Dha / Ga). The LINE decides: a line\n'
      + '  holding any spelled-out swara or `S R M P N` reads them as swaras, otherwise as letters — so\n'
      + '  `C D E F G A B` and `S R G M P D N` are both correct. Spell `Dha` / `Ga` to be certain.\n'
      + '- `z` a rest, `-` hold the previous note, `[Sa Ga Pa]` a chord, `|` a bar line (no time).\n'
      + 'WHAT MAKES IT SOUND RIGHT RATHER THAN NEARLY RIGHT:\n'
      + '- Notes are booked against the AUDIO clock a little ahead of time, never one setTimeout each —\n'
      + '  timers drift by tens of milliseconds and a background tab clamps them to once a second.\n'
      + '- Every note ramps up and down over a few milliseconds. Without that there is a CLICK on every\n'
      + '  single note, which is the whole difference between a tune and a tune with a tick on it.\n'
      + '- `melody.unlock()` on a real gesture is the single most common reason a web app has no sound.\n'
      + '- Several voices SUM, so the player sits at 0.25 by default; raise it with `setVolume`.\n'
      + '- A ROUND is `entryBeats` (the same phrase entered late) over a `loop: true` ground. Build the\n'
      + '  phrase from one triad and it harmonises with itself at any delay — see TUNES.round.\n'
      + '- A token it cannot read becomes a REST and is reported in the returned timeline\n'
      + "  (`unreadable`), never guessed. Show it; a tune must not change quietly.\n"
      + 'NO sound file, NO dependency, NO network, NO cost — it works offline.',
  };
}
