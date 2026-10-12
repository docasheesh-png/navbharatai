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
