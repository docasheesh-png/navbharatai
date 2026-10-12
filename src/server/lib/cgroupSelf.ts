/**
 * WHERE A PROCESS'S OWN cgroup-v2 FILES LIVE — the one place that answers it (autopsy 303e8a6f, 2026-10-12).
 *
 * 🔴 The kernel creates `memory.peak`, `memory.current`, `memory.max`, `memory.high`, `memory.min`, `memory.low` and
 * `memory.events` only in NON-ROOT cgroups (`CFTYPE_NOT_ON_ROOT`, mm/memcontrol.c). Reading them at the mount root
 * works inside a container with a private cgroup namespace — where the root IS the container's own cgroup — and
 * silently finds nothing on a VM. An E2B sandbox is a Firecracker VM: its envd runs every build command in
 * `/sys/fs/cgroup/user`, so the peak-memory probe read one directory too high and reported "no cgroup accounting
 * exposed" on every build since it shipped (2026-09-11), and six autopsies took that sentence as fact.
 *
 * The own cgroup comes from `/proc/self/cgroup` (`0::<path>` on cgroup v2). Under a cgroup namespace that path is
 * `/`, which resolves to the mount root — so a namespaced container reads exactly what it read before. PURE.
 */

export const CGROUP_V2_ROOT = '/sys/fs/cgroup';
export const SELF_CGROUP_FILE = '/proc/self/cgroup';
/** Where a cgroup-v1 memory hierarchy is mounted (beside the v2 root on a hybrid host). */
export const CGROUP_V1_MEMORY_ROOT = `${CGROUP_V2_ROOT}/memory`;

/**
 * ⚠️ EVERY cgroup FILE NAME LIVES IN THIS MODULE (adversarial review of 303e8a6f). The census in
 * tests/cgroupOwnPath.test.ts fails on `memory.peak`, `memory.max`, `max_usage_in_bytes`, … in a string anywhere
 * else — keyed on the file NAMES, because a path built by concatenation slips past a census of full literal paths.
 */

/** The process's own cgroup-v2 directory, from the text of `/proc/self/cgroup`, or null when there is none. */
export function ownCgroupV2Dir(selfCgroupText: string | null | undefined, root: string = CGROUP_V2_ROOT): string | null {
  const m = /^0::(\/\S*)\s*$/m.exec(String(selfCgroupText ?? ''));
  if (!m) return null;
  const path = m[1]!.replace(/\/+$/, '');
  if (path.split('/').includes('..')) return null;
  return `${root.replace(/\/+$/, '')}${path}`;
}

/**
 * Where to look for one cgroup-v2 file, nearest first: the process's own cgroup, then the mount root (a namespaced
 * container, or a host whose `/proc/self/cgroup` could not be read). Deduplicated. PURE.
 */
export function cgroupV2FileCandidates(file: string, selfCgroupText: string | null | undefined, root: string = CGROUP_V2_ROOT): string[] {
  const own = ownCgroupV2Dir(selfCgroupText, root);
  const rootPath = `${root.replace(/\/+$/, '')}/${file}`;
  return [...new Set([...(own ? [`${own}/${file}`] : []), rootPath])];
}

/** The own cgroup's directory and every ancestor up to the mount root, nearest first. PURE. */
export function cgroupV2Ancestors(selfCgroupText: string | null | undefined, root: string = CGROUP_V2_ROOT): string[] {
  const base = root.replace(/\/+$/, '');
  const own = ownCgroupV2Dir(selfCgroupText, root);
  const out: string[] = [];
  for (let d = own; d && d.length >= base.length; d = d.slice(0, d.lastIndexOf('/'))) {
    out.push(d);
    if (d === base) break;
  }
  if (!out.includes(base)) out.push(base);
  return out;
}

/** The process's own cgroup-v1 MEMORY directory (`N:memory:/path`), or null. PURE. */
export function ownCgroupV1MemoryDir(selfCgroupText: string | null | undefined, root: string = CGROUP_V1_MEMORY_ROOT): string | null {
  const m = /^\d+:(?:[^:\n]*,)?memory(?:,[^:\n]*)?:(\/\S*)\s*$/m.exec(String(selfCgroupText ?? ''));
  if (!m) return null;
  const path = m[1]!.replace(/\/+$/, '');
  if (path.split('/').includes('..')) return null;
  return `${root.replace(/\/+$/, '')}${path}`;
}

/**
 * The process's EFFECTIVE memory limit, in bytes, or null on any doubt — the SMALLEST numeric limit from its own
 * cgroup up to the root (adversarial review of 303e8a6f: a leaf can carry a larger number than an ancestor that
 * really binds it, and a too-large denominator understates a real memory problem). cgroup v2 first ("max" = no
 * limit, skipped); then v1, own memory cgroup up to its root (a ~1 TB+ value is v1's "no limit" sentinel). PURE
 * apart from the injected reader.
 */
export function effectiveMemoryLimitBytes(read: (p: string) => string): number | null {
  let self: string | null = null;
  try { self = read(SELF_CGROUP_FILE); } catch { /* no /proc here — the root candidates still apply */ }
  const numeric = (path: string): number | null => {
    try {
      const raw = read(path).trim();
      if (!raw || raw === 'max') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 && n < 1024 ** 4 ? n : null;
    } catch { return null; }
  };
  const min = (paths: string[]): number | null => {
    const vals = paths.map(numeric).filter((n): n is number => n !== null);
    return vals.length ? Math.min(...vals) : null;
  };
  const v2 = min(cgroupV2Ancestors(self).map((d) => `${d}/memory.max`));
  if (v2 !== null) return v2;
  const v1Own = ownCgroupV1MemoryDir(self);
  const v1Dirs: string[] = [];
  for (let d = v1Own; d && d.length >= CGROUP_V1_MEMORY_ROOT.length; d = d.slice(0, d.lastIndexOf('/'))) {
    v1Dirs.push(d);
    if (d === CGROUP_V1_MEMORY_ROOT) break;
  }
  if (!v1Dirs.includes(CGROUP_V1_MEMORY_ROOT)) v1Dirs.push(CGROUP_V1_MEMORY_ROOT);
  return min(v1Dirs.map((d) => `${d}/memory.limit_in_bytes`));
}

/**
 * The shell probe that reads the high-water mark of the cgroup the probe ITSELF runs in — on an E2B VM, the
 * `/user` cgroup envd starts every build command in. Read-only, and with NO redirection at all: every read is
 * guarded by `[ -r … ]`, so the write-ban test stays as strict as it was (adversarial review of 303e8a6f).
 *
 *   v2 <peak> max=<own memory.max> high=<reclaim-throttle events> oom_kill=<n> cgroup=<path>
 *   v1 <max_usage_in_bytes> cgroup=<path>          (the probe's OWN v1 memory cgroup — never the host's root)
 *   unavailable cgroup=<path>
 */
export function ownCgroupMemoryProbe(root: string = CGROUP_V2_ROOT, selfFile: string = SELF_CGROUP_FILE): string {
  const r = root.replace(/\/+$/, '');
  const ev = (key: string) => `$(if [ -r "$d/memory.events" ]; then sed -n 's/^${key} //p' "$d/memory.events"; fi)`;
  return `if [ -r ${selfFile} ]; then cg=$(sed -n 's/^0:://p' ${selfFile} | head -n1); m1=$(sed -n 's/^[0-9]*:\\(.*,\\)\\{0,1\\}memory\\(,[^:]*\\)\\{0,1\\}://p' ${selfFile} | head -n1); fi; `
    + `d="${r}\${cg%/}"; v="${r}/memory\${m1%/}"; `
    + `if [ -n "$cg" ] && [ -r "$d/memory.peak" ]; then `
    + `echo "v2 $(cat "$d/memory.peak") max=$(if [ -r "$d/memory.max" ]; then cat "$d/memory.max"; fi) high=${ev('high')} oom_kill=${ev('oom_kill')} cgroup=\${cg:-/}"; `
    + `elif [ -n "$m1" ] && [ -r "$v/memory.max_usage_in_bytes" ]; then echo "v1 $(cat "$v/memory.max_usage_in_bytes") cgroup=\${m1:-/}"; `
    + `else echo "unavailable cgroup=\${cg:-\${m1:-unknown}}"; fi`;
}
