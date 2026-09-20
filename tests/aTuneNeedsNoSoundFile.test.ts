import { describe, it, expect } from 'vitest';
import { transformSync } from 'esbuild';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  generateMelody,
  validateBuiltInTunes,
  noteToMidi,
  midiToFrequency,
  parseMelody,
  LETTER_SEMITONES,
  SARGAM_SEMITONES,
  SARGAM_SHORT,
  MELODY_MODULES,
} from '../src/server/lib/MelodyGenerator';

/**
 * A TUNE NEEDS NO SOUND FILE (admin 2026-09-20, handing over a page of notation: *"yeh music notes
 * navbharatai ko sikhao! jab bhi need ho, use kiye jaye! dhun banane ke liye."*)
 *
 * 🔴 WHY THIS FILE RUNS THE EMITTED CODE INSTEAD OF GREPPING IT. Every other check we have over a
 * generator proves its output PARSES and COMPILES. Neither can tell a correct note from a plausible
 * one — and a tune whose pitches are subtly wrong is the worst failure this feature has, because
 * nothing errors, nobody can report it, and the person listening simply thinks our engine cannot
 * make music. A `toContain('midiToFrequency')` would pass just as happily over arithmetic that
 * returned nonsense.
 *
 * So the pitch tests below lift the reader straight out of the generated file, transpile it, RUN it,
 * and check it against numbers that are fixed by the theory itself (A4 = 440 Hz, C4 = 261.6 Hz, komal
 * Ga three semitones above Sa). Those are the only form of this test that could actually fail if the
 * arithmetic drifted — and they cover THE ARTIFACT THE USER GETS, not a second copy of it that
 * happens to live on our server.
 */
function evalEmitted(source: string, names: string[]): Record<string, any> {
  const head = source.replace(/^export /gm, '');
  const js = transformSync(head + '\nreturn { ' + names.join(', ') + ' };', { loader: 'ts' }).code;
  // eslint-disable-next-line no-new-func
  return new Function(js)();
}

const built = generateMelody();
const notationSrc = built.files['src/audio/notation.ts']!;
const playerSrc = built.files['src/audio/melody.ts']!;
const tunesSrc = built.files['src/audio/tunes.ts']!;

const app = evalEmitted(notationSrc, [
  'midiToFrequency', 'noteToMidi', 'parseMelody', 'buildTimeline', 'resolveTonic', 'looksLikeSargam',
  'LETTER_SEMITONES', 'SARGAM_SEMITONES', 'SARGAM_SHORT',
]);

/** Comments describe a mistake; only real code may satisfy an assertion about avoiding it. */
const code = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the pitch arithmetic, run rather than read', () => {
  it('anchors on A4 = 440 Hz, which fixes everything else', () => {
    expect(app.noteToMidi('A', 60)).toBe(69);
    expect(Math.round(app.midiToFrequency(69))).toBe(440);
    // C4 = 261.6 Hz is the number every tuner in the world agrees on. If this moves, the engine is
    // playing in a key nobody asked for and nothing else in the suite would notice.
    expect(Math.round(app.midiToFrequency(60) * 10) / 10).toBe(261.6);
    expect(app.noteToMidi('C4', 60)).toBe(60);
  });

  it('reads accidentals and absolute octaves', () => {
    expect(app.noteToMidi('F#', 60)).toBe(66);
    expect(app.noteToMidi('Bb', 60)).toBe(70);
    expect(app.noteToMidi('C5', 60)).toBe(72);
    expect(app.noteToMidi('A5', 60)).toBe(81);
  });

  it("an octave mark works on either notation: ' up, , down", () => {
    expect(app.noteToMidi("Sa'", 60)).toBe(72);
    expect(app.noteToMidi('Sa,', 60)).toBe(48);
    expect(app.noteToMidi("C'", 60)).toBe(72);
  });

  it('the platform reader and the emitted one give the SAME answers', () => {
    // The app carries its own copy because it runs in the user's browser and cannot import from our
    // server. That copy is what must be right, so every pitch case above is re-checked here against
    // the reference the rest of this file uses — the drifted-copy class, closed by comparison.
    // ♯ and ♭ are in the list on purpose: the platform copy accepted them and the emitted one
    // did not, and a token list without them passed happily over that drift.
    const tokens = ['C', 'A', 'D', 'G', 'F#', 'Bb', 'F♯', 'B♭', 'C4', 'A5',
      "Sa'", 'Sa,', 'Sa', 'Re', '_Ga', 'Ma#', 'Ma', 'z', '-', '', 'qq', 'H', '_Sa'];
    for (const token of tokens) {
      expect(app.noteToMidi(token, 60), token).toEqual(noteToMidi(token, 60));
      expect(app.noteToMidi(token, 60, { sargam: true }), token)
        .toEqual(noteToMidi(token, 60, { sargam: true }));
    }
    expect(app.LETTER_SEMITONES).toEqual(LETTER_SEMITONES);
    expect(app.SARGAM_SEMITONES).toEqual(SARGAM_SEMITONES);
    expect(app.SARGAM_SHORT).toEqual(SARGAM_SHORT);
  });

  it('the emitted tables ARE the tested tables — interpolated, not retyped', () => {
    // This is what makes the copy above safe rather than a promise: the numbers in the user's app are
    // the very objects these tests check, written into the file by the builder.
    expect(notationSrc).toContain(JSON.stringify(SARGAM_SEMITONES));
    expect(notationSrc).toContain(JSON.stringify(LETTER_SEMITONES));
    expect(notationSrc).toContain(JSON.stringify(SARGAM_SHORT));
  });
});

describe('sargam is RELATIVE, letters are ABSOLUTE', () => {
  it('Sa is whatever the tonic is — that is what sargam means', () => {
    // The common western mistake is to treat Sa as a fixed C. It would make every sargam tune play in
    // C whatever scale the singer actually uses, and nothing would fail.
    expect(app.noteToMidi('Sa', 65)).toBe(65);
    expect(app.noteToMidi('Pa', 65)).toBe(72);
    const inC = app.parseMelody('Sa Re Ga', { tonic: 'C4' }).notes.map((n: any) => n.midi);
    const inF = app.parseMelody('Sa Re Ga', { tonic: 'F4' }).notes.map((n: any) => n.midi);
    expect(inC).toEqual([60, 62, 64]);
    expect(inF).toEqual([65, 67, 69]);
  });

  it('a letter ignores the tonic completely', () => {
    expect(app.noteToMidi('C4', 65)).toBe(60);
    expect(app.parseMelody('C E G', { tonic: 'F4' }).notes.map((n: any) => n.midi)).toEqual([60, 64, 67]);
  });

  it('the shuddha scale is the major scale, and the vikrit swaras are right', () => {
    expect(app.parseMelody('Sa Re Ga Ma Pa Dha Ni', { tonic: 'C4' }).notes.map((n: any) => n.midi))
      .toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(app.noteToMidi('_Re', 60)).toBe(61);
    expect(app.noteToMidi('_Ga', 60)).toBe(63);
    expect(app.noteToMidi('_Dha', 60)).toBe(68);
    expect(app.noteToMidi('_Ni', 60)).toBe(70);
    // Ma's vikrit form goes UP (teevra), not down. A komal Ma does not exist.
    expect(app.noteToMidi('Ma#', 60)).toBe(66);
  });

  it('the short forms a learner writes are the same notes', () => {
    expect(app.parseMelody('S R G M P D N', { tonic: 'C4' }).notes.map((n: any) => n.midi))
      .toEqual([60, 62, 64, 65, 67, 69, 71]);
  });

  it('Sa, Pa and Ma have NO komal form — and are refused, not shifted', () => {
    // The theory itself says Sa and Pa are achal. Accepting `_Sa` would play a raga that does not
    // exist, which is a wrong a user can hear and cannot describe.
    expect(app.noteToMidi('_Sa', 60)).toBeUndefined();
    expect(app.noteToMidi('_Pa', 60)).toBeUndefined();
    expect(app.noteToMidi('_Ma', 60)).toBeUndefined();
  });
});

describe('D and G are the only ambiguous tokens, and the LINE decides them', () => {
  it('a line of letters reads them as letters', () => {
    // THE BUG THIS CLOSES, found by a test and not by ear: with sargam short forms always winning,
    // `C D E F G A B` came out as C, Dha, E, F, Ga, A, B — a major scale with two wrong notes in it,
    // and nothing anywhere failed. Both notations are advertised, so both must actually work.
    expect(app.parseMelody('C D E F G A B', { tonic: 'C4' }).notes.map((n: any) => n.midi))
      .toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(app.parseMelody('C E G', { tonic: 'F4' }).notes.map((n: any) => n.midi))
      .toEqual([60, 64, 67]);
  });

  it('a line with any UNAMBIGUOUS swara in it reads them as swaras', () => {
    // `S R M P N` and the spelled-out names cannot be letters A–G, so one of them settles the line.
    expect(app.parseMelody('S R G M P D N', { tonic: 'C4' }).notes.map((n: any) => n.midi))
      .toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(app.parseMelody('Sa Re G', { tonic: 'C4' }).notes.map((n: any) => n.midi))
      .toEqual([60, 62, 64]);
    expect(app.looksLikeSargam('Sa Re Ga')).toBe(true);
    expect(app.looksLikeSargam('_Ni Ma#')).toBe(true);
    expect(app.looksLikeSargam('C D E F G A B')).toBe(false);
    expect(app.looksLikeSargam('D G')).toBe(false);
  });

  it('an octave mark or a duration cannot hide a swara from the dialect check', () => {
    expect(app.looksLikeSargam("Sa'*2 G")).toBe(true);
    expect(app.parseMelody("Pa, G", { tonic: 'C4' }).notes.map((n: any) => n.midi)).toEqual([55, 64]);
  });

  it('a token on its OWN defaults to the Western letter, and says so by option', () => {
    // With no line to read, `D` is how a D is normally written; sargam's normal form is `Dha`.
    expect(app.noteToMidi('D', 60)).toBe(62);
    expect(app.noteToMidi('G', 60)).toBe(67);
    expect(app.noteToMidi('D', 60, { sargam: true })).toBe(69);
    expect(app.noteToMidi('G', 60, { sargam: true })).toBe(64);
    // The unambiguous short forms never needed the option.
    expect(app.noteToMidi('S', 60)).toBe(60);
    expect(app.noteToMidi('P', 60)).toBe(67);
  });

  it('the ambiguity really is only two tokens wide', () => {
    // If a third short form ever collided with a letter, the line rule above would silently start
    // deciding it too. This is what would notice.
    const letters = Object.keys(LETTER_SEMITONES);
    const collisions = Object.keys(SARGAM_SHORT).filter((k) => letters.includes(k));
    expect(collisions.sort()).toEqual(['d', 'g']);
  });
});

describe('timing', () => {
  it('a bare note is one beat; * lengthens, / shortens, *1.5 dots', () => {
    const p = app.parseMelody('Sa Sa*2 Ga/2 Pa*1.5');
    expect(p.notes.map((n: any) => [n.startBeat, n.beats])).toEqual([[0, 1], [1, 2], [3, 0.5], [3.5, 1.5]]);
    expect(p.beats).toBe(5);
  });

  it('a tie lengthens the note already there instead of adding a second one', () => {
    const p = app.parseMelody('Sa - - Ga');
    expect(p.notes.map((n: any) => [n.midi, n.startBeat, n.beats])).toEqual([[60, 0, 3], [64, 3, 1]]);
  });

  it('a chord sounds together and takes its longest member', () => {
    const p = app.parseMelody('[Sa Ga Pa] Sa');
    expect(p.notes.slice(0, 3).map((n: any) => n.startBeat)).toEqual([0, 0, 0]);
    expect(p.notes[3].startBeat).toBe(1);
    expect(app.parseMelody('[Sa Ga*3]').beats).toBe(3);
  });

  it('a bar line carries no time, so a musician may write them', () => {
    expect(app.parseMelody('Sa Ga | Pa Sa').beats).toBe(4);
    expect(app.parseMelody('Sa Ga|Pa Sa').notes).toHaveLength(4);
  });

  it('a TRAILING REST still counts toward the length', () => {
    // It is what a loop and a canon entry are measured against: a phrase whose second half is silence
    // must still take its full length, or a ground drifts against the melody a little every repeat.
    expect(app.parseMelody('Sa z*3').beats).toBe(4);
    expect(app.parseMelody('Sa z*3').notes).toHaveLength(1);
  });

  it('an unclosed chord is the rest of the line, never a crash', () => {
    expect(() => app.parseMelody('Sa [Ga Pa')).not.toThrow();
    expect(app.parseMelody('Sa [Ga Pa').notes).toHaveLength(3);
  });
});

describe('an unreadable token is a REST and is reported, never a guess', () => {
  it('keeps its place in time and names itself', () => {
    const p = app.parseMelody('Sa qq Ga');
    expect(p.notes.map((n: any) => n.midi)).toEqual([60, 64]);
    expect(p.notes[1].startBeat).toBe(2); // the bad token still took its beat
    expect(p.unreadable).toEqual(['qq']);
  });

  it('a wholly unreadable line yields silence, not noise', () => {
    const p = app.parseMelody('qq ww ee');
    expect(p.notes).toHaveLength(0);
    expect(p.unreadable).toHaveLength(3);
    expect(p.beats).toBe(3);
  });

  it('an empty line is empty, and nothing throws', () => {
    for (const bad of ['', '   ', '||', undefined as unknown as string, null as unknown as string]) {
      expect(() => app.parseMelody(bad)).not.toThrow();
      expect(app.parseMelody(bad).notes).toHaveLength(0);
    }
  });
});

describe('a round, and a ground', () => {
  const tunes = evalEmitted(tunesSrc.replace(/^import[^\n]*\n/gm, ''), ['ROUND', 'TUNES', 'CUES']);
  const ROUND = tunes.ROUND;

  it('is ONE phrase entered three times, over two repeating grounds', () => {
    expect(ROUND.voices.filter((v: any) => !v.loop)).toHaveLength(3);
    expect(ROUND.voices.filter((v: any) => v.loop)).toHaveLength(2);
    const entries = ROUND.voices.filter((v: any) => !v.loop).map((v: any) => v.entryBeats);
    expect(entries).toEqual([0, 6, 12]);
    // The same notes each time — a round is one melody, not three.
    const lines = new Set(ROUND.voices.filter((v: any) => !v.loop).map((v: any) => v.notes));
    expect(lines.size).toBe(1);
  });

  it('is built ONLY from root, third and fifth — so it is consonant at ANY entry delay', () => {
    // This is the claim the round rests on, and it is checkable rather than a matter of taste: notes
    // of one triad are consonant in every combination, so the phrase harmonises with itself however
    // late the second voice comes in, and the grounds cannot clash with it. Add a note outside the
    // triad and the round becomes luck — which is exactly what this test refuses.
    const tonic = app.resolveTonic(ROUND.tonic);
    const classes = new Set<number>();
    for (const v of ROUND.voices) {
      for (const n of app.parseMelody(v.notes, { tonic: ROUND.tonic }).notes) {
        if (n.midi !== null) classes.add(((n.midi - tonic) % 12 + 12) % 12);
      }
    }
    expect([...classes].sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  it('the voices that play ONCE decide the length; a ground fills it and never extends it', () => {
    // Found by running it: a 4-beat ground under an 18-beat round ran to beat 20, so the
    // ACCOMPANIMENT silently lengthened the tune, and looping that tune left a ragged gap before the
    // melody came back.
    const t = app.buildTimeline(ROUND);
    const beatSeconds = 60 / ROUND.bpm;
    expect(t.seconds).toBeCloseTo(18 * beatSeconds, 9);
    for (const n of t.notes) expect(n.at + n.dur).toBeLessThanOrEqual(t.seconds + 1e-9);
  });

  it('the final ground note is CLAMPED to the end, not dropped', () => {
    // Dropping it would leave the last bar of a round with no floor under it; letting it overrun is
    // the bug above. Clamping is what a musician does.
    const t = app.buildTimeline(ROUND);
    const ground = t.notes.filter((n: any) => n.wave === 'sine');
    expect(ground.length).toBeGreaterThan(6);
    const last = ground.reduce((m: any, n: any) => (n.at > m.at ? n : m), ground[0]);
    expect(last.at + last.dur).toBeCloseTo(t.seconds, 9);
  });

  it('an EMPTY ground cannot hang the app', () => {
    // A phrase of no length repeated to fill a span is an infinite loop, and it would hang the tab
    // rather than fail — the one failure mode here that a user could not even close.
    const t = app.buildTimeline({ name: 'x', bpm: 120, voices: [{ notes: '', loop: true }, { notes: 'Sa Ga' }] });
    expect(t.notes).toHaveLength(2);
    expect(notationSrc).toContain('phrase.beats > 0');
  });

  it('a tune of nothing but grounds falls back to its longest phrase', () => {
    const t = app.buildTimeline({ name: 'y', bpm: 120, voices: [{ notes: 'Sa Ga Pa', loop: true }] });
    expect(t.notes).toHaveLength(3);
    expect(t.seconds).toBeCloseTo(3 * 0.5, 9);
  });

  it('the timeline is time-ORDERED, because the scheduler walks it forwards', () => {
    const t = app.buildTimeline(ROUND);
    for (let i = 1; i < t.notes.length; i += 1) expect(t.notes[i].at).toBeGreaterThanOrEqual(t.notes[i - 1].at);
  });

  it('an absurd or missing bpm still produces a playable tune', () => {
    for (const bpm of [0, -20, NaN, undefined as unknown as number]) {
      const t = app.buildTimeline({ name: 'z', bpm, voices: [{ notes: 'Sa Ga' }] });
      expect(t.notes).toHaveLength(2);
      expect(t.seconds).toBeGreaterThan(0);
    }
  });

  it('every built-in tune really plays, with nothing unreadable in it', () => {
    for (const [name, tune] of Object.entries(tunes.TUNES as Record<string, any>)) {
      const t = app.buildTimeline(tune);
      expect(t.notes.length, name).toBeGreaterThan(0);
      expect(t.unreadable, name).toEqual([]);
    }
  });

  it('the builder VALIDATES its own library, so an unreadable built-in cannot ship', () => {
    // A built-in whose notation had a typo would play as rests — a tune simply missing notes, with
    // nothing failing anywhere. This is the only thing that would catch it.
    expect(validateBuiltInTunes()).toEqual([]);
  });
});

describe('what makes it SOUND right rather than nearly right', () => {
  it('books notes against the AUDIO clock a little ahead — never one timer per note', () => {
    // JS timers drift by tens of milliseconds and a background tab clamps them to once a second, so
    // a setTimeout-per-note tune plays late, unevenly, and falls apart the moment the user looks
    // away. The only job of the timer here is to book the next slice.
    expect(playerSrc).toContain('LOOKAHEAD_SECONDS');
    expect(playerSrc).toContain('ctx.currentTime + LOOKAHEAD_SECONDS');
    expect(playerSrc).toContain('setInterval(() => this.pump(), TICK_MS)');
    expect(code(playerSrc)).not.toContain('setTimeout');
    expect(playerSrc).toContain('osc.start(at)');
  });

  it('ramps every note up and down, so there is no CLICK on each one', () => {
    expect(playerSrc).toContain('g.gain.setValueAtTime(0, at)');
    expect(playerSrc).toContain('g.gain.linearRampToValueAtTime(peak, at + attack)');
    expect(playerSrc).toContain('g.gain.linearRampToValueAtTime(0, end)');
  });

  it('never ramps EXPONENTIALLY to zero — that is illegal and throws', () => {
    expect(code(playerSrc)).not.toContain('exponentialRampToValueAtTime');
  });

  it('unlocks the context on a real gesture — THE reason an app has no sound', () => {
    expect(playerSrc).toContain("window.addEventListener('pointerdown', resume)");
    expect(playerSrc).toContain("window.addEventListener('touchstart', resume)");
    expect(playerSrc).toContain("window.removeEventListener('pointerdown', resume)");
    expect(playerSrc).toContain('void this.ctx?.resume()');
  });

  it('stops a voice by ramping down first, and frees the node afterwards', () => {
    // Cutting a running oscillator dead is itself a click; never disconnecting it is a leak that
    // grows for as long as the app is open.
    expect(playerSrc).toContain('linearRampToValueAtTime(0, ctx.currentTime + 0.03)');
    expect(playerSrc).toContain('osc.onended');
    expect(playerSrc).toContain('osc.disconnect()');
    expect(playerSrc).toContain('this.live.delete(osc)');
  });

  it('survives a browser with no Web Audio at all — silently, never broken', () => {
    expect(playerSrc).toContain('if (!Ctor) return');
    expect(playerSrc).toContain('webkitAudioContext');
  });

  it('sits below full volume, because voices SUM', () => {
    expect(playerSrc).toContain('constructor(volume = 0.25)');
  });
});

describe('the builder', () => {
  it('emits the three files and needs NO dependency', () => {
    expect(Object.keys(built.files).sort()).toEqual(Object.values(MELODY_MODULES).sort());
    // A note is arithmetic and Web Audio is the browser's own API. Adding a package here would be the
    // one thing that could make this feature fail to install.
    expect(built.dependencies).toEqual([]);
  });

  it('a subset that could not compile is not a subset', () => {
    // The player and the library both import the reader, so asking for either must bring it.
    expect(Object.keys(generateMelody(['melody']).files).sort())
      .toEqual(['src/audio/melody.ts', 'src/audio/notation.ts']);
    expect(Object.keys(generateMelody(['tunes']).files).sort())
      .toEqual(['src/audio/notation.ts', 'src/audio/tunes.ts']);
    expect(Object.keys(generateMelody(['notation']).files)).toEqual(['src/audio/notation.ts']);
  });

  it('an unrecognised subset falls back to everything rather than emitting nothing', () => {
    expect(Object.keys(generateMelody(['nonsense']).files)).toHaveLength(3);
    expect(Object.keys(generateMelody([]).files)).toHaveLength(3);
  });

  it('the instructions teach BOTH notations, because that is the point of it', () => {
    expect(built.instructions).toContain('Sa Re Ga Ma Pa Dha Ni');
    expect(built.instructions).toContain('C D E F G A B');
    expect(built.instructions).toContain('melody.unlock()');
    expect(built.instructions).toContain('RELATIVE to `tonic`');
  });

  it('the emitted reader is SELF-CONTAINED, because the eval above depends on it', () => {
    // It runs in the user's browser and cannot import from our server; it must also not import from
    // its siblings, or the pitch tests here would be testing a stub.
    expect(code(notationSrc)).not.toContain('import ');
  });
});

describe('the library is honest about what it is', () => {
  it('ships no transcription of a published piece, and says why', () => {
    // A melody written down from memory may simply be WRONG, and a wrong tune is not something a
    // user can detect or report. Every built-in is either fixed by the theory (a scale, an alankar)
    // or written for that file.
    expect(tunesSrc).toContain('None is a transcription of a published piece');
  });

  it('the cues are the sounds an app needs and has no file for', () => {
    const tunes = evalEmitted(tunesSrc.replace(/^import[^\n]*\n/gm, ''), ['CUES']);
    for (const name of ['chime', 'success', 'error', 'coin', 'levelUp', 'tap']) {
      expect(Object.keys(tunes.CUES), name).toContain(name);
    }
  });

  it('the platform reader agrees with the theory, not just with itself', () => {
    // The reference implementation, checked against the same fixed numbers — so a future edit that
    // broke BOTH copies identically would still fail here.
    expect(midiToFrequency(69)).toBeCloseTo(440, 9);
    expect(parseMelody('Sa Re Ga Ma Pa Dha Ni Sa\'', { tonic: 'C4' }).notes.map((n) => n.midi))
      .toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });
});

describe('the tool is really reachable — an unwired generator is invisible', () => {
  const root = join(__dirname, '..');
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  it('is in the tool CATALOG, which is how the builder discovers it at all', () => {
    // Neither tsc nor vitest can see a generator that was never registered: the module compiles, the
    // tests pass, and the capability simply never exists for any user.
    const catalog = read('src/server/AgentV3/ToolCatalog.ts');
    expect(catalog).toContain("name: 'generate_melody'");
    expect(catalog).toContain("  'generate_melody',");
  });

  it('is DISPATCHED, and writes its files through the actuator', () => {
    const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(dispatcher).toContain("case 'generate_melody':");
    expect(dispatcher).toContain("import { generateMelody } from '../lib/MelodyGenerator'");
    expect(dispatcher).toContain('const mel = generateMelody(melInclude)');
  });

  it('the catalog entry names BOTH notations, or a sargam user never finds it', () => {
    const catalog = read('src/server/AgentV3/ToolCatalog.ts');
    const entry = catalog.slice(catalog.indexOf("name: 'generate_melody'"));
    const body = entry.slice(0, entry.indexOf('input_schema'));
    for (const word of ['sargam', 'dhun', 'Sa Re Ga Ma Pa Dha Ni', 'C D E F G A B']) {
      expect(body, word).toContain(word);
    }
  });

  it('the GAME tool stops implying a silent game is the end of it', () => {
    // Its honest limit was true and also a dead end for anyone who cannot produce an .mp3. Both the
    // tool description and the build plan now point at the synthesiser.
    expect(read('src/server/AgentV3/ToolCatalog.ts')).toContain('call generate_melody, which synthesises them');
    expect(read('src/server/AgentV3/systemPrompt.ts')).toContain('generate_melody');
  });

  it('every AI in NavBharatAI can answer "can it make music?"', () => {
    // AppKnowledgeBase is what the chat AIs read. A capability missing from it does not exist to
    // them, and the professional AIs are handed an entry by KEYWORD, so the words matter too.
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).toContain('generate_melody');
    expect(kb).toContain('MUSIC & TUNES');
    for (const kw of ["'sargam'", "'dhun'", "'music notes'", "'sound nahi aa raha'"]) {
      expect(kb, kw).toContain(kw);
    }
  });

  it('the knowledge base is HONEST about what a synthesiser is not', () => {
    // It is a clean instrument, not a recorded singer. Promising otherwise is the fake-feature class.
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).toContain('not a recorded orchestra or a real singer');
    expect(kb).toContain('never a copy of somebody');
  });
});

/**
 * THE PLAYER, ACTUALLY RUN — against a fake AudioContext that records every booking.
 *
 * 🔴 WHY THIS BLOCK EXISTS ON TOP OF THE SOURCE ASSERTIONS ABOVE. Those prove the file MENTIONS a
 * lookahead scheduler; they cannot prove it books the notes. A player that scheduled every note at
 * `currentTime`, or twice, or never advanced its cursor, would satisfy every one of them and play
 * either a chord or nothing. Nobody in CI can hear a tune, so the only honest substitute is to count
 * what it asked the audio hardware to do.
 */
function makeFakeAudio() {
  const oscillators: any[] = [];
  const gains: any[] = [];
  const intervals: Array<() => void> = [];
  const ctx: any = {
    currentTime: 0,
    state: 'running',
    resumed: 0,
    destination: { id: 'dest' },
    resume() { this.resumed += 1; return Promise.resolve(); },
    createGain() {
      const automation: Array<[string, number, number]> = [];
      const node = {
        gain: {
          value: 1,
          setValueAtTime: (v: number, t: number) => automation.push(['set', v, t]),
          linearRampToValueAtTime: (v: number, t: number) => automation.push(['linear', v, t]),
          exponentialRampToValueAtTime: (v: number, t: number) => automation.push(['exp', v, t]),
          cancelScheduledValues: (t: number) => automation.push(['cancel', 0, t]),
          setTargetAtTime: (v: number, t: number) => automation.push(['target', v, t]),
        },
        automation,
        connect() {}, disconnect() {},
      };
      gains.push(node);
      return node;
    },
    createOscillator() {
      const osc: any = {
        type: 'sine',
        frequency: { value: 0 },
        started: null as number | null,
        stopped: null as number | null,
        disconnects: 0,
        onended: null as null | (() => void),
        connect() {}, disconnect() { this.disconnects += 1; },
        start(t: number) { this.started = t; },
        stop(t: number) { this.stopped = t; },
      };
      oscillators.push(osc);
      return osc;
    },
  };
  const listeners: Record<string, Array<() => void>> = {};
  const win: any = {
    AudioContext: function () { return ctx; },
    addEventListener(name: string, fn: () => void) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name: string, fn: () => void) {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
    },
    fire(name: string) { for (const fn of [...(listeners[name] || [])]) fn(); },
    listenerCount: (name: string) => (listeners[name] || []).length,
  };
  const setIntervalFake = (fn: () => void) => { intervals.push(fn); return intervals.length as any; };
  const clearIntervalFake = () => { intervals.length = 0; };
  return { ctx, win, oscillators, gains, intervals, setIntervalFake, clearIntervalFake };
}

function loadPlayer(fake: ReturnType<typeof makeFakeAudio>) {
  // The player imports from the reader; concatenating them is what the bundler does anyway, and the
  // reader is self-contained (asserted above), so nothing is stubbed out.
  const combined = notationSrc.replace(/^export /gm, '')
    + '\n'
    + playerSrc.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
    + '\nreturn { MelodyPlayer, melody, buildTimeline };';
  const js = transformSync(combined, { loader: 'ts' }).code;
  // eslint-disable-next-line no-new-func
  return new Function('window', 'setInterval', 'clearInterval', js)(
    fake.win, fake.setIntervalFake, fake.clearIntervalFake,
  );
}

describe('the player, run against a fake AudioContext', () => {
  const TUNE = { name: 't', bpm: 120, tonic: 'C4', voices: [{ notes: 'Sa Re Ga Ma' }] };

  it('unlocks on the first gesture, and then removes its own listeners', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    p.unlock();
    expect(fake.win.listenerCount('pointerdown')).toBe(1);
    expect(fake.win.listenerCount('touchstart')).toBe(1);
    fake.win.fire('pointerdown');
    expect(fake.ctx.resumed).toBeGreaterThan(0);
    // A listener left behind would resume the context on every tap for the life of the app.
    expect(fake.win.listenerCount('pointerdown')).toBe(0);
    expect(fake.win.listenerCount('keydown')).toBe(0);
  });

  it('books each note ONCE, at its own time — not all at currentTime', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer, buildTimeline } = loadPlayer(fake);
    const p = new MelodyPlayer();
    const timeline = p.play(TUNE);
    expect(timeline.notes).toHaveLength(4);

    // Only what is inside the lookahead may be booked yet. Booking the lot up front is the bug that
    // makes a long tune unstoppable and a looping one impossible.
    expect(fake.oscillators.length).toBeGreaterThan(0);
    expect(fake.oscillators.length).toBeLessThan(4);

    for (let t = 0; t <= timeline.seconds + 0.5; t += 0.05) {
      fake.ctx.currentTime = t;
      for (const tick of [...fake.intervals]) tick();
    }
    expect(fake.oscillators).toHaveLength(4);

    const started = fake.oscillators.map((o) => Math.round(o.started * 1000) / 1000);
    const first = started[0];
    expect(started.map((s) => Math.round((s - first) * 1000) / 1000)).toEqual([0, 0.5, 1, 1.5]);
    expect(fake.oscillators.map((o) => Math.round(o.frequency.value * 10) / 10))
      .toEqual([261.6, 293.7, 329.6, 349.2]);
  });

  it('every note is stopped, and every node released', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    const timeline = p.play(TUNE);
    for (let t = 0; t <= timeline.seconds + 0.5; t += 0.05) {
      fake.ctx.currentTime = t;
      for (const tick of [...fake.intervals]) tick();
    }
    for (const osc of fake.oscillators) {
      expect(osc.stopped).not.toBeNull();
      expect(osc.stopped).toBeGreaterThan(osc.started);
      // onended is what frees the node; without it the graph grows for as long as the app is open.
      expect(typeof osc.onended).toBe('function');
      osc.onended();
      expect(osc.disconnects).toBeGreaterThan(0);
    }
  });

  it('the envelope really ramps from ZERO up and back to ZERO', () => {
    // An earlier version of this test asserted only that an oscillator existed, which is no test at
    // all: a player that set the gain straight to full volume would have passed it and clicked on
    // every single note.
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    p.play({ name: 'one', bpm: 120, tonic: 'C4', voices: [{ notes: 'Sa' }] });
    expect(fake.oscillators).toHaveLength(1);

    // gains[0] is the master; the voice's own gain is the one created after it.
    const voice = fake.gains[fake.gains.length - 1];
    const steps = voice.automation as Array<[string, number, number]>;
    expect(steps.length).toBeGreaterThanOrEqual(4);

    // Starts at silence, rises, holds, returns to silence — in that order, and in time order.
    expect(steps[0][0]).toBe('set');
    expect(steps[0][1]).toBe(0);
    expect(steps[1][0]).toBe('linear');
    expect(steps[1][1]).toBeGreaterThan(0);
    const last = steps[steps.length - 1];
    expect(last[0]).toBe('linear');
    expect(last[1]).toBe(0);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i][2]).toBeGreaterThanOrEqual(steps[i - 1][2]);

    // The peak is reached AFTER the note begins, not at it — that difference is the click.
    expect(steps[1][2]).toBeGreaterThan(steps[0][2]);
    // And the whole envelope lands inside the note.
    const osc = fake.oscillators[0];
    expect(steps[0][2]).toBeCloseTo(osc.started, 9);
    expect(last[2]).toBeLessThanOrEqual(osc.stopped);

    // An exponential ramp to zero throws and kills the note; there must not be one anywhere.
    expect(steps.some((st) => st[0] === 'exp')).toBe(false);
  });

  it('LOOPING re-books the tune instead of stopping', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    const timeline = p.play(TUNE, { loop: true });
    for (let t = 0; t <= timeline.seconds * 2 + 0.5; t += 0.05) {
      fake.ctx.currentTime = t;
      for (const tick of [...fake.intervals]) tick();
    }
    expect(fake.oscillators.length).toBeGreaterThanOrEqual(8);
    expect(p.playing).toBe(true);
  });

  it('a tune that is NOT looping ends itself and reports it', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    let ended = 0;
    const timeline = p.play(TUNE, { onEnd: () => { ended += 1; } });
    for (let t = 0; t <= timeline.seconds + 1; t += 0.05) {
      fake.ctx.currentTime = t;
      for (const tick of [...fake.intervals]) tick();
    }
    expect(ended).toBe(1);
    expect(p.playing).toBe(false);
    expect(fake.oscillators).toHaveLength(4);
  });

  it('stop() halts the scheduler and books nothing more', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    p.play({ name: 'long', bpm: 60, voices: [{ notes: 'Sa Re Ga Ma Pa Dha Ni Sa' }] });
    const booked = fake.oscillators.length;
    p.stop();
    expect(p.playing).toBe(false);
    fake.ctx.currentTime = 20;
    for (const tick of [...fake.intervals]) tick();
    expect(fake.oscillators).toHaveLength(booked);
  });

  it('a tune with nothing in it books nothing and does not start a timer', () => {
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    const timeline = p.play({ name: 'empty', bpm: 120, voices: [{ notes: 'z z' }] });
    expect(timeline.notes).toHaveLength(0);
    expect(fake.oscillators).toHaveLength(0);
    expect(p.playing).toBe(false);
  });

  it('a browser with NO Web Audio is silent, never broken', () => {
    const fake = makeFakeAudio();
    delete fake.win.AudioContext;
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    expect(() => p.unlock()).not.toThrow();
    expect(p.play(TUNE)).toBeNull();
    expect(p.playing).toBe(false);
  });

  it('several voices really sound TOGETHER', () => {
    // A round whose voices played one after another would not be a round at all.
    const fake = makeFakeAudio();
    const { MelodyPlayer } = loadPlayer(fake);
    const p = new MelodyPlayer();
    const timeline = p.play({
      name: 'chord', bpm: 120, tonic: 'C4',
      voices: [{ notes: 'Sa*2' }, { notes: 'Ga*2' }, { notes: 'Pa*2' }],
    });
    for (let t = 0; t <= timeline.seconds + 0.5; t += 0.05) {
      fake.ctx.currentTime = t;
      for (const tick of [...fake.intervals]) tick();
    }
    expect(fake.oscillators).toHaveLength(3);
    const starts = new Set(fake.oscillators.map((o) => Math.round(o.started * 1000)));
    expect(starts.size).toBe(1);
  });
});
