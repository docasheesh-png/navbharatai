import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * P-SEC.11 — the E2B sandbox seccomp profile is a security artifact, so it is verified, not
 * just committed: it must be valid OCI seccomp JSON and must actually deny the dangerous
 * syscall classes the roadmap calls out (ptrace, mount, setuid family) and more.
 */
const profile = JSON.parse(
  readFileSync(resolve(__dirname, '../infra/e2b/seccomp-profile.json'), 'utf8'),
);

/** All syscall names that the profile blocks with an ERRNO action. */
const blocked = new Set<string>(
  profile.syscalls
    .filter((rule: any) => rule.action === 'SCMP_ACT_ERRNO')
    .flatMap((rule: any) => rule.names),
);

describe('e2b seccomp profile (P-SEC.11)', () => {
  it('is a valid default-allow OCI seccomp profile', () => {
    expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');
    expect(Array.isArray(profile.syscalls)).toBe(true);
    expect(profile.syscalls.length).toBeGreaterThan(0);
  });

  it('declares the architectures it applies to', () => {
    const arches = profile.archMap.map((a: any) => a.architecture);
    expect(arches).toContain('SCMP_ARCH_X86_64');
    expect(arches).toContain('SCMP_ARCH_AARCH64');
  });

  it('blocks the roadmap-named dangerous syscalls (ptrace, mount, setuid)', () => {
    expect(blocked.has('ptrace')).toBe(true);
    expect(blocked.has('mount')).toBe(true);
    expect(blocked.has('setuid')).toBe(true);
  });

  it('blocks the full privilege-escalation / host-tampering set', () => {
    for (const sc of [
      'umount2', 'pivot_root', 'chroot',                       // mount/fs escape
      'setgid', 'setreuid', 'setresuid', 'setfsuid',           // uid/gid escalation
      'init_module', 'finit_module', 'delete_module',          // kernel modules
      'kexec_load', 'reboot', 'swapon',                        // host tampering
      'bpf', 'perf_event_open',                                // kernel tracing
      'process_vm_readv', 'process_vm_writev',                 // cross-process memory
    ]) {
      expect(blocked.has(sc), `expected seccomp to block ${sc}`).toBe(true);
    }
  });

  it('every ERRNO rule returns a concrete errno and documents why', () => {
    for (const rule of profile.syscalls) {
      if (rule.action === 'SCMP_ACT_ERRNO') {
        expect(typeof rule.errnoRet).toBe('number');
        expect(typeof rule.comment).toBe('string');
        expect(rule.comment.length).toBeGreaterThan(0);
      }
    }
  });
});
