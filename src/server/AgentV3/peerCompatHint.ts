// A PACKAGE VERSION THAT DOES NOT SUPPORT THIS PROJECT'S REACT — named before it is installed, and the newest
// version that does is handed over in the same tool result.
//
// 🔴 WHY (autopsy 981ce4cc, 2026-10-04). "Edit pdf" ran `npm install pdfjs-dist react-pdf`. npm refused with
// ERESOLVE: react-pdf@11.0.0 needs react@^19 and the project has react@18.3.1. Nothing told the model which
// react-pdf works with React 18, so it guessed two versions that do not exist (ETARGET twice), took
// `npmVersionHint`'s answer, "the latest react-pdf is 11.0.0; use react-pdf@^11", and installed it with
// `--legacy-peer-deps`. That installs, then crashes in the browser: "(0 , import_react.use) is not a
// function" (`use` exists only in React 19). Three more installs and a downgrade to react-pdf@8.0.2 /
// pdfjs-dist@3.11.174, a version with a published advisory, followed. react-pdf@10.5.0 supports React 18;
// one `npm view` says so.
//
// So: an ERESOLVE peer conflict names the newest version that fits; an ETARGET answer never recommends a
// version whose peers this project does not have; and an install forced through with --legacy-peer-deps
// or --force that left a package unsupported is said so at once. Advice only — nothing is installed for
// the model. PURE parts here; the dispatcher runs the two read-only commands.
import { valid, satisfies, prerelease, rcompare } from 'semver';

/** One peer requirement npm refused. */
export interface PeerConflict {
  /** The package that asked for the peer (react-pdf). */
  pkg: string;
  /** The version of it npm tried (11.0.0). */
  pkgVersion: string;
  /** The peer it needs (react). */
  peer: string;
  /** The range it needs (^19.0.0). */
  need: string;
  /** The version this project has (18.3.1), when npm printed it. */
  found: string | null;
}

const NAME = '(?:@[a-z0-9][\\w.-]*\\/)?[a-z0-9][\\w.-]*';

/**
 * The peer conflicts in an ERESOLVE (or a `npm ls` "invalid") answer, at most `max`. npm prints
 * `Found: react@18.3.1` and `peer react@"^19.0.0" from react-pdf@11.0.0`. PURE.
 */
export function peerConflicts(output: string, max = 3): PeerConflict[] {
  const text = String(output ?? '');
  const out: PeerConflict[] = [];
  const found = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(`Found: (${NAME})@(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, 'g'))) found.set(m[1], m[2]);
  for (const m of text.matchAll(new RegExp(`peer (${NAME})@"([^"]+)" from (${NAME})@(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, 'g'))) {
    const [, peer, need, pkg, pkgVersion] = m;
    if (out.some((c) => c.pkg === pkg && c.peer === peer)) continue;
    out.push({ pkg, pkgVersion, peer, need, found: found.get(peer) ?? null });
    if (out.length >= max) break;
  }
  // `npm ls` after a forced install: `react@18.3.1 invalid: "^19.0.0" from node_modules/react-pdf`.
  for (const m of text.matchAll(new RegExp(`(${NAME})@(\\d+\\.\\d+\\.\\d+[\\w.-]*)(?: deduped)? invalid: "([^"]+)" from node_modules\\/(${NAME})`, 'g'))) {
    const [, peer, have, need, pkg] = m;
    if (out.some((c) => c.pkg === pkg && c.peer === peer) || out.length >= max) continue;
    out.push({ pkg, pkgVersion: '', peer, need, found: have });
  }
  return out;
}

/** Does this install command force past peer checks? PURE. */
export function forcesPeers(command: string): boolean {
  return /\bnpm\s+(?:i|install|add)\b/.test(command) && /--legacy-peer-deps\b|--force\b/.test(command);
}

/** A package name safe to put on a shell line unquoted (npm's own naming rules). PURE. */
function safeName(name: string): boolean {
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name) && name.length <= 214;
}

/**
 * One read-only command: every published version of each package with its peers, and the version of every
 * package this project has installed. PURE string builder.
 */
export function peerDataCommand(packages: readonly string[]): string | null {
  const names = [...new Set(packages)].filter(safeName).slice(0, 3);
  if (names.length === 0) return null;
  const view = names
    .map((p) => `printf 'NBAI_PEERS ${p} '; npm view "${p}@>=0.0.0" version peerDependencies --json 2>/dev/null | tr -d '\\n'; echo`)
    .join('; ');
  const has =
    `node -e "try{var p=require('./package.json');var d=Object.assign({},p.devDependencies,p.dependencies);` +
    `Object.keys(d).forEach(function(k){try{console.log('NBAI_HAS '+k+'='+require('./node_modules/'+k+'/package.json').version)}catch(e){}})}catch(e){}"`;
  return `${view}; ${has}`;
}

interface Release { version: string; peers: Record<string, string> }

/** The output of `peerDataCommand`, read back. PURE. */
export function readPeerData(stdout: string): { releases: Map<string, Release[]>; installed: Map<string, string> } {
  const releases = new Map<string, Release[]>();
  const installed = new Map<string, string>();
  for (const line of String(stdout ?? '').split('\n')) {
    const has = /^NBAI_HAS ((?:@[\w.-]+\/)?[\w.-]+)=(\S+)\s*$/.exec(line);
    if (has) { installed.set(has[1], has[2]); continue; }
    const view = /^NBAI_PEERS ((?:@[\w.-]+\/)?[\w.-]+) (.*)$/.exec(line);
    if (!view) continue;
    try {
      const parsed = JSON.parse(view[2]);
      const list = (Array.isArray(parsed) ? parsed : [parsed])
        .filter((r) => r && typeof r.version === 'string')
        .map((r) => ({ version: String(r.version), peers: r.peerDependencies && typeof r.peerDependencies === 'object' ? r.peerDependencies : {} }));
      releases.set(view[1], list);
    } catch { /* npm gave nothing usable for this package */ }
  }
  return { releases, installed };
}

/** Do the peers this project HAS satisfy this release? A peer it does not have is not a conflict. PURE. */
function fits(release: Release, installed: ReadonlyMap<string, string>): boolean {
  for (const [peer, range] of Object.entries(release.peers)) {
    const have = installed.get(peer);
    if (!have || !valid(have)) continue;
    if (!satisfies(have, String(range), { includePrerelease: true })) return false;
  }
  return true;
}

/** The newest stable release whose peers this project has. PURE. */
export function newestCompatible(releases: readonly Release[], installed: ReadonlyMap<string, string>): string | null {
  const stable = releases.filter((r) => valid(r.version) && !prerelease(r.version) && fits(r, installed));
  if (stable.length === 0) return null;
  return stable.map((r) => r.version).sort(rcompare)[0];
}

/** The newest stable release, whatever its peers. PURE. */
export function newestStable(releases: readonly Release[]): string | null {
  const stable = releases.map((r) => r.version).filter((v) => valid(v) && !prerelease(v));
  return stable.length ? stable.sort(rcompare)[0] : null;
}

/** What a release needs that this project does not have, as "react@^19.0.0". PURE. */
function unmetPeers(release: Release | undefined, installed: ReadonlyMap<string, string>): string[] {
  if (!release) return [];
  return Object.entries(release.peers)
    .filter(([peer, range]) => {
      const have = installed.get(peer);
      return !!have && !!valid(have) && !satisfies(have, String(range), { includePrerelease: true });
    })
    .map(([peer, range]) => `${peer}@${range}`);
}

/**
 * The note for a peer conflict (ERESOLVE, or a forced install npm ls calls invalid), or null. PURE.
 */
export function peerConflictHint(conflicts: readonly PeerConflict[], stdout: string, forced: boolean): string | null {
  const { releases, installed } = readPeerData(stdout);
  const lines: string[] = [];
  for (const c of conflicts) {
    const best = newestCompatible(releases.get(c.pkg) ?? [], installed);
    const have = c.found ?? installed.get(c.peer) ?? null;
    const what = `${c.pkg}${c.pkgVersion ? `@${c.pkgVersion}` : ''} needs ${c.peer}@${c.need}${have ? `, and this project has ${c.peer}@${have}` : ''}`;
    lines.push(best
      ? `${what}. The newest ${c.pkg} that works with this project is ${best}: install ${c.pkg}@^${best}.`
      : `${what}. No published ${c.pkg} supports this project's ${c.peer}; choose another package.`);
  }
  if (lines.length === 0) return null;
  const lead = forced
    ? '[peer hint] That install was forced past npm\'s peer check, and it left a package this project does not support. It will fail at runtime (for React: errors such as "use is not a function").'
    : '[peer hint] Do not retry with --legacy-peer-deps or --force: the package would install and then fail at runtime.';
  return `${lead} ${lines.join(' ')}`;
}

/**
 * The version to recommend for a range that does not exist: the newest one this project's peers support,
 * and the latest only when it fits. Null when npm said nothing. PURE.
 */
export function etargetRecommendation(pkg: string, stdout: string): { version: string; latest: string | null; latestNeeds: string[] } | null {
  const { releases, installed } = readPeerData(stdout);
  const list = releases.get(pkg) ?? [];
  const best = newestCompatible(list, installed);
  if (!best) return null;
  const latest = newestStable(list);
  return { version: best, latest, latestNeeds: latest && latest !== best ? unmetPeers(list.find((r) => r.version === latest), installed) : [] };
}

/** One line for a range that does not exist, naming a version that exists AND fits this project. PURE. */
export function etargetHintLine(name: string, range: string, rec: { version: string; latest: string | null; latestNeeds: string[] }): string {
  const why = rec.latest && rec.latest !== rec.version && rec.latestNeeds.length
    ? ` (the latest, ${rec.latest}, needs ${rec.latestNeeds.join(', ')}, which this project does not have)`
    : '';
  return `${name}@${range} does not exist — the newest ${name} that works with this project is ${rec.version}${why}; use ${name}@^${rec.version}`;
}
