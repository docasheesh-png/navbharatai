# Recorded game sound library (2026-11-19)

Admin aim: the best game experience at the lowest cost. Every kit game already makes sound from code (`synth.ts`); this adds
REAL recordings under the same names, so the feedback layer's step / click / hit / swing… play recordings with no builder work.

- Catalogue: 47 sounds from `facebookincubator/Meta-open-sound` @ `514c926…` (Oculus Audio Pack 01, CC BY 4.0). Built by
  `scripts/library/buildSoundLibrary.mts` (pinned clone, hash, Chromium decode, audible-RMS loudness → gain that only ever lowers,
  so nothing clips). Picks and prompt words: `scripts/library/soundPicks.mts`.
- Live admission: `scripts/library/admitSoundLibrary.mts` — 47/47 downloaded through the production downloader, size and sha256
  matched, the downloaded bytes decoded to non-silent audio (`asset-candidates/sound-library-admission.json`).
- Per game: core 9 sounds (~120 KB) + prompt-matched ones, bounded to 28 sounds / 8 MiB / 4 loops.
- Runtime: the kit ships a stand-in `src/game/fx/soundLibrary.ts` the shell always calls after `audio.unlock()`; the seed replaces
  it with the real loader (same exports). `audio.load(name, url, gain)` now carries a per-sound level.
- Flexibility: `src/game/fx/soundCustomizations.ts` — per sound `source: 'built-in' | { file }` (own .ogg/.mp3/.wav/.m4a under
  public/, also for brand-new sounds) and `volume` 0..2. Unsafe paths are ignored; a failed file falls back to the built-in voice.
- Ambience: `startAmbience()` starts the prepared `amb_*` loops; the builder is told to call it.
- Published games now serve .ogg/.m4a/.aac/.flac with audio content types (`bucketPublish.contentTypeFor`).
- Kill switch: `AGENTV3_GAME_SOUND_LIBRARY=off` (default on).

Limits: loudness is measured, not listened to by a person; levels follow fixed targets per kind. Synth-only voices with no good
recording (jump, coin, explosion, thunder…) stay code-made.
