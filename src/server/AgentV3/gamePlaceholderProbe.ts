/**
 * 🧸 THE PLACEHOLDER LOOK (external Game Maker audit, admin-approved 2026-11-25: "the build/playtest must catch a missing
 * GLB, a failed texture, a static character, a player spawned under the ground or under water, an empty map and controls
 * nobody can see — and the builder must be told to repair them").
 *
 * 🔑 THE CLASS: every one of these is a game that PLAYS while showing a stand-in. The kit's model loader falls back to the
 * code-built object when a model cannot load (externalAssets.ts `catch { return fallback(); }`), a GLB character whose clip
 * never plays stands in a T-pose, a texture whose image failed draws flat, a player in the sea or a map with nothing on it
 * still answers the keys — so the playtest's pixel and input measures all read "works", and nothing said that the user is
 * looking at a placeholder. The geometry look (gameGeometryProbe.ts) already catches a player under the ground and models
 * stuck at 0%; this file adds the rest as SEPARATE deterministic detectors, each from a measurement, never a guess:
 *
 *   • MISSING MODEL (files) — a model the project's own manifest (assetModels.ts / humanAssets.ts), its customizations, its
 *     player.ts or car.ts names, and the file is not in the workspace. Needs no browser: it is read from the file list.
 *   • MISSING MODEL / FAILED TEXTURE (page) — a model or image request that answered an error, an HTML page (a dev server's
 *     fallback for a file that is not there), or failed; and an <img> texture that finished loading with no pixels.
 *   • STATIC CHARACTER (page) — a rigged mesh (10+ bones) whose pose did not change once over a whole round of keyboard play.
 *   • PLAYER UNDER WATER (page, open world) — at the start, on foot, the water over the land stands above the player's head.
 *   • EMPTY MAP (page) — after a round of play the scene draws at most two meshes besides the camera's own (a ground and
 *     perhaps a sky): a character on a blank plane.
 *   • HIDDEN CONTROLS (page, phone) — an on-screen control that is laid out but sits mostly off the screen, is fully
 *     transparent, hidden, or too small for a thumb. A control hidden ON PURPOSE (display: none, e.g. Drift outside a car)
 *     has no layout and is never judged.
 *
 * WHAT HAPPENS WITH THEM: one GAME_PLACEHOLDERS line in the build report (admin), and a builder-only repair note on the next
 * game turn (`placeholderRepairNote`, the same path as the geometry look) — after which that turn's playtest looks again,
 * and a defect that is gone is simply not recorded. Never scored, never a gate, never a paid call, never shown to the user.
 * Every value from the page is clamped and every name stripped, because the page runs the game's code.
 * Kill switch: AGENTV3_GAME_PLACEHOLDER_PROBE=off. PURE except the env read.
 */

import { withoutComments } from '../lib/codeOnly';

export const GAME_PLACEHOLDER_CODE = 'GAME_PLACEHOLDERS';

export type PlaceholderKind =
  | 'MISSING_MODEL'
  | 'FAILED_TEXTURE'
  | 'STATIC_CHARACTER'
  | 'PLAYER_UNDERWATER'
  | 'EMPTY_MAP'
  | 'HIDDEN_CONTROLS';
export interface PlaceholderFinding { kind: PlaceholderKind; evidence: string; fix: string; /** The file it is about, when it is one. */ path?: string }

export function gamePlaceholderProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_PLACEHOLDER_PROBE ?? '').trim().toLowerCase() !== 'off';
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const clean = (v: unknown, max = 80): string => String(v ?? '').replace(/[^\p{L}\p{N} _./:#-]/gu, '').trim().slice(0, max);

// ── FILES ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The model files a project's own source says it loads, each with who names it. PURE. */
export function referencedModelFiles(files: Readonly<Record<string, string>>): Array<{ path: string; subject: string; by: string }> {
  const out: Array<{ path: string; subject: string; by: string }> = [];
  const seen = new Set<string>();
  const add = (path: string, subject: string, by: string) => {
    const p = path.replace(/^\.?\//, '');
    const full = p.startsWith('public/') ? p : 'public/' + p;
    if (seen.has(full) || full.length > 240 || full.includes('..')) return;
    seen.add(full);
    out.push({ path: full, subject: clean(subject, 40) || 'a model', by });
  };
  for (const [path, text] of Object.entries(files || {})) {
    if (typeof text !== 'string' || !/^src\/.*\.(ts|tsx|js|jsx)$/.test(path)) continue;
    // The generated loaders' manifest (assetModels.ts, humanAssets.ts): each subject's GLB is public/game-assets/<sha256>.glb.
    const m = /const assets: Record<string, LocalGameAsset> = (\{.*\});\n/.exec(text);
    if (m) {
      try {
        const manifest = JSON.parse(m[1]) as Record<string, { sha256?: unknown }>;
        for (const [subject, entry] of Object.entries(manifest)) {
          const sha = String(entry?.sha256 ?? '');
          if (/^[a-f0-9]{64}$/.test(sha)) add(`public/game-assets/${sha}.glb`, subject, path);
        }
      } catch { /* not a manifest we wrote */ }
    }
    // The project's own model files: customizations ({ file: '…glb' }), player.ts and car.ts (model: '…glb').
    if (/(^|\/)(assetCustomizations|player|car|track)\.ts$/.test(path)) {
      // Code only: the files' own comments show example paths ('public/models/my-car.glb') that are not loaded.
      for (const hit of withoutComments(text).matchAll(/\b(?:file|model)[ \t]*:[ \t]*['"]([^'"\n]{1,240}\.(?:glb|gltf))['"]/gi)) {
        add(hit[1], hit[1].split('/').pop() || 'a model', path);
      }
    }
  }
  return out;
}

/**
 * MISSING MODEL from the files alone: every model the source names whose file is not in `present` (the workspace's own file
 * list). An empty `present` means the list could not be read, and nothing is said. PURE.
 */
export function missingModelFindings(files: Readonly<Record<string, string>>, present: readonly string[]): PlaceholderFinding[] {
  if (!present.length) return [];
  const have = new Set(present.map((p) => String(p).replace(/^\.?\//, '')));
  return referencedModelFiles(files)
    .filter((r) => !have.has(r.path))
    .slice(0, 4)
    .map((r) => ({
      kind: 'MISSING_MODEL' as const,
      path: r.path,
      evidence: `the model "${r.subject}" (${r.path}, named in ${r.by}) is not in the project, so the game shows the code-built stand-in`,
      fix: r.path.startsWith('public/game-assets/')
        ? 'add the library model again (it is downloaded by the platform), or remove it from the game; never point the loader at a file that is not there'
        : `put the model at ${r.path} or change ${r.by} to a model the project has`,
    }));
}

// ── PAGE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlaceholderPageRead {
  meshes?: number;
  skinned?: Array<{ id?: string; name?: string; bones?: number; pose?: number }> | null;
  brokenTextures?: string[] | null;
  failed?: Array<{ url?: string; why?: string }> | null;
  standing?: { feet?: number; land?: number; water?: number | null; seated?: boolean } | null;
}
export interface ControlsRead { total?: number; off?: Array<{ name?: string; why?: string }> | null }

/** How deep the water over the land must stand above the player's feet before the player's head is under it. */
export const UNDERWATER_HEAD_M = 1.2;
/** A rig with fewer bones (a door, a flag) may stand still on purpose. */
export const CHARACTER_BONES = 10;
/** A scene that draws this many meshes or fewer is a blank plane (a ground and perhaps a sky). */
export const EMPTY_SCENE_MESHES = 2;

/**
 * The placeholder findings from the page: `start` is read before the keyboard round, `end` after it, `controls` on the
 * phone. Each read may be null (an older script, a 2D game, a stage that did not finish), and then that detector says
 * nothing. At most 6 findings. PURE.
 */
export function pagePlaceholderFindings(start: PlaceholderPageRead | null | undefined, end: PlaceholderPageRead | null | undefined, controls?: ControlsRead | null): PlaceholderFinding[] {
  const out: PlaceholderFinding[] = [];
  const s = start && typeof start === 'object' ? start : null;
  const e = end && typeof end === 'object' ? end : null;
  const failed = [...(Array.isArray(s?.failed) ? s!.failed! : []), ...(Array.isArray(e?.failed) ? e!.failed! : [])];
  const seen = new Set<string>();
  for (const f of failed) {
    const url = clean(f?.url, 120);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const isModel = /\.(glb|gltf|bin|fbx|obj)$/i.test(url);
    out.push({
      kind: isModel ? 'MISSING_MODEL' : 'FAILED_TEXTURE',
      path: url,
      evidence: `${url} did not load (${clean(f?.why, 20) || 'failed'}) while the game was played`,
      fix: isModel ? 'make the path point at a model the project has (public/…), or add the model; the loader shows a code-built stand-in until it loads'
        : 'make the texture path point at an image the project has, or drop the texture; a material whose image failed draws flat',
    });
  }
  for (const name of [...new Set([...(e?.brokenTextures ?? []), ...(s?.brokenTextures ?? [])].map((n) => clean(n, 60)).filter(Boolean))].slice(0, 2)) {
    out.push({ kind: 'FAILED_TEXTURE', evidence: `the texture image "${name}" finished loading with no pixels`, fix: 'point it at an image file that exists in the project' });
  }
  // A rigged mesh seen at the start AND at the end whose pose never changed over the whole round.
  const before = new Map((Array.isArray(s?.skinned) ? s!.skinned! : []).map((k) => [clean(k?.id, 40), k]));
  for (const k of (Array.isArray(e?.skinned) ? e!.skinned! : []).slice(0, 8)) {
    const id = clean(k?.id, 40), was = before.get(id);
    const bones = num(k?.bones, 0, 1e4) ?? 0;
    const p0 = num(was?.pose, -1e12, 1e12), p1 = num(k?.pose, -1e12, 1e12);
    if (!id || !was || bones < CHARACTER_BONES || p0 === null || p1 === null || p0 !== p1) continue;
    out.push({
      kind: 'STATIC_CHARACTER',
      evidence: `the character "${clean(k?.name, 40) || 'a rigged model'}" (${bones} bones) did not move a single bone through a whole round of play — it stands frozen`,
      fix: 'play its clip: call handle.update(dt) every frame and handle.play(\'idle\') / play(\'walk\') as it moves (or use the kit\'s player.ts, which animates it by itself)',
    });
    break;
  }
  const st = s?.standing;
  if (st && st.seated !== true) {
    const feet = num(st.feet, -1e5, 1e5), water = num(st.water, -1e5, 1e5);
    if (feet !== null && water !== null && water - feet > UNDERWATER_HEAD_M) {
      out.push({
        kind: 'PLAYER_UNDERWATER',
        evidence: `the player started ${(water - feet).toFixed(1)} m under water`,
        fix: 'start the player on dry land (the open world\'s own spawn, or a spot where map.world.heightAt is above the water), never at a fixed position',
      });
    }
  }
  const meshes = num(e?.meshes, 0, 1e7);
  if (meshes !== null && meshes <= EMPTY_SCENE_MESHES) {
    out.push({
      kind: 'EMPTY_MAP',
      evidence: `after a round of play the scene drew only ${meshes} mesh${meshes === 1 ? '' : 'es'} — a blank map`,
      fix: 'put the world on it: the kit\'s open world (<OpenWorldGame>) or its objects (buildings, trees, roads), not one bare plane',
    });
  }
  const offList = Array.isArray(controls?.off) ? controls!.off! : [];
  if (offList.length) {
    const names = offList.slice(0, 3).map((o) => `"${clean(o?.name, 30) || 'a control'}" (${clean(o?.why, 30) || 'not visible'})`).join(', ');
    out.push({
      kind: 'HIDDEN_CONTROLS',
      evidence: `on a phone ${offList.length} on-screen control${offList.length === 1 ? ' is' : 's are'} laid out but cannot be seen or reached: ${names}`,
      fix: 'keep every on-screen control inside the screen (env(safe-area-inset-*) margins), fully opaque enough to see, and at least 40 px — or use the kit\'s touch controls',
    });
  }
  return out.slice(0, 6);
}

/** The file findings and the page findings as one list: a file already named missing is said once. At most 6. PURE. */
export function combinePlaceholderFindings(fromFiles: readonly PlaceholderFinding[], fromPage: readonly PlaceholderFinding[]): PlaceholderFinding[] {
  const base = (p?: string) => String(p ?? '').split('/').pop()?.toLowerCase() ?? '';
  const named = new Set(fromFiles.map((f) => base(f.path)).filter(Boolean));
  return [...fromFiles, ...fromPage.filter((f) => !(f.path && named.has(base(f.path))))].slice(0, 6);
}

/** The admin line recorded as GAME_PLACEHOLDERS ('' when there is nothing to say). PURE. */
export function placeholderFindingsMessage(findings: readonly PlaceholderFinding[]): string {
  if (!findings.length) return '';
  return `Placeholder look (builder-only): ${findings.map((f, i) => `(${i + 1}) ${f.kind} — ${f.evidence}; fix: ${f.fix}.`).join(' ')}`.slice(0, 2000);
}

interface IssueLike { code?: unknown; message?: unknown }
/** The builder's repair note for the NEXT game turn, from the last report's GAME_PLACEHOLDERS line, or null. PURE. */
export function placeholderRepairNote(issues: ReadonlyArray<IssueLike> | null | undefined): string | null {
  const list = Array.isArray(issues) ? issues : [];
  const hit = [...list].reverse().find((i) => String(i?.code ?? '') === GAME_PLACEHOLDER_CODE);
  const msg = hit ? String(hit.message ?? '').replace(/^Placeholder look \(builder-only\):\s*/, '').trim() : '';
  if (!msg) return null;
  return [
    'PLACEHOLDERS FOUND BY THE LAST PLAYTEST (builder-only; do not mention it to the user). The game was played after the last turn and shows a stand-in where the real thing should be:',
    msg.slice(0, 1800),
    'Repair each one in this turn as said (the smallest change that removes it; never delete the feature to hide it). The game is played again after this turn and every item is looked at once more.',
  ].join('\n');
}

/**
 * The browser side, as plain JavaScript for the playtest script (gamePlaytest.ts adds it as an init script AFTER its own
 * scene hook, and attaches to the same `window.__THREE_DEVTOOLS__` hub). It defines two read-only functions:
 * window.__nbPlaceholders() (the scene, the failed requests, where the player stands) and window.__nbControlsOff() (the
 * phone's on-screen controls). Nothing here changes the game; the fetch wrapper only watches the answer.
 */
export const PLACEHOLDER_PAGE_HOOK = String.raw`() => {
  const failed = [];
  const asset = /\.(glb|gltf|bin|fbx|obj|png|jpe?g|webp|ktx2|hdr|basis)([?#]|$)/i;
  const short = (u) => { try { const x = new URL(String(u), location.href); return x.pathname.slice(0, 120); } catch (e) { return String(u).slice(0, 120); } };
  const note = (u, why) => { if (failed.length < 12 && !failed.some((f) => f.url === short(u))) failed.push({ url: short(u), why: String(why) }); };
  const realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const p = realFetch.apply(this, arguments);
      if (asset.test(url)) p.then((r) => { const ct = (r.headers && r.headers.get('content-type')) || ''; if (!r.ok) note(url, r.status); else if (/text\/html/i.test(ct)) note(url, 'html page'); }, () => note(url, 'failed'));
      return p;
    };
  }
  window.addEventListener('error', (e) => { const t = e && e.target; if (t && t.tagName === 'IMG' && asset.test(t.src || '')) note(t.src, 'image failed'); }, true);
  const seen = { scene: null, camera: null };
  let hub = window.__THREE_DEVTOOLS__;
  if (!hub || typeof hub.addEventListener !== 'function') {
    hub = new EventTarget();
    try { Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: hub, configurable: true, writable: true }); } catch (e) { /* the page owns it */ }
  }
  hub.addEventListener('observe', (e) => {
    const o = e && e.detail;
    if (!o || o.isScene || typeof o.render !== 'function') return;
    const render = o.render;
    o.render = function (scene, camera) {
      if (scene && scene.isScene && camera && camera.isCamera) { seen.scene = scene; seen.camera = camera; }
      return render.apply(this, arguments);
    };
  });
  window.__nbPlaceholders = () => {
    const sc = seen.scene, cam = seen.camera;
    let standing = null;
    try { standing = window.__nbWorld && window.__nbWorld.standing ? window.__nbWorld.standing() : null; } catch (e) { standing = null; }
    if (!sc) return { failed: failed.slice(), standing };
    let meshes = 0, nodes = 0;
    const skinned = [], broken = [];
    const keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
    const walk = (o, underCam) => {
      if (nodes++ > 6000 || !o || o.visible === false) return;
      const isCam = o === cam;
      if (!underCam && !isCam && (o.isMesh || o.isInstancedMesh || o.isPoints)) {
        meshes++;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          for (const k of keys) {
            const img = m[k] && m[k].image;
            if (img && img.tagName === 'IMG' && img.complete && img.naturalWidth === 0 && broken.length < 4) broken.push(short(img.currentSrc || img.src || k));
          }
        }
      }
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones && skinned.length < 8) {
        const bones = o.skeleton.bones;
        let pose = 0;
        for (let i = 0; i < Math.min(64, bones.length); i++) {
          const q = bones[i].quaternion, p = bones[i].position;
          pose += (q.x * 1.31 + q.y * 1.73 + q.z * 2.29 + q.w * 0.71 + p.x * 0.37 + p.y * 0.53 + p.z * 0.61) * (i + 1);
        }
        let name = '';
        for (let a = o; a && !name; a = a.parent) name = a.name || '';
        skinned.push({ id: String(o.uuid).slice(0, 36), name: String(name).slice(0, 40), bones: bones.length, pose: Math.round(pose * 1e5) / 1e5 });
      }
      for (const c of (o.children || [])) walk(c, underCam || isCam);
    };
    walk(sc, false);
    return { meshes, skinned, brokenTextures: broken, failed: failed.slice(), standing };
  };
  window.__nbControlsOff = () => {
    const off = [];
    let total = 0;
    const W = innerWidth, H = innerHeight;
    for (const el of document.querySelectorAll('.nbg-tc-btn, [class*=joystick], [class*=dpad], [data-control]')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      total++;
      const st = getComputedStyle(el);
      let opacity = 1;
      for (let a = el; a && a.nodeType === 1; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity || 1);
      const inX = Math.max(0, Math.min(b.right, W) - Math.max(b.left, 0)), inY = Math.max(0, Math.min(b.bottom, H) - Math.max(b.top, 0));
      const shown = (inX * inY) / Math.max(1, b.width * b.height);
      const why = st.visibility === 'hidden' ? 'hidden' : opacity < 0.05 ? 'transparent' : shown < 0.5 ? 'off the screen' : (b.width < 16 || b.height < 16) ? 'too small' : '';
      if (why && off.length < 6) off.push({ name: String((el.getAttribute('aria-label') || el.textContent || el.className || 'control')).trim().slice(0, 30), why });
    }
    return { total, off };
  };
}`;
