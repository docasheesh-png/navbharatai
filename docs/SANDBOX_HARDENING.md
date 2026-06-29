# Sandbox Hardening — Seccomp / Capabilities / Non-root (P-SEC.11)

> **Status:** the seccomp profile (`infra/e2b/seccomp-profile.json`) is a real, committed,
> unit-tested artifact. The runtime **apply** of seccomp + capability drop + non-root is a
> container-runtime concern (the same boundary as P-SEC.9 Cloud Armor: the config is in the
> repo; enabling it needs platform/infra access). This doc is the exact runbook to apply it.

## Why

The build sandbox runs untrusted, AI-generated code and a per-build dev/preview server. Today
`SandboxManager.ts` enforces only userspace limits (`NODE_OPTIONS` memory caps, process-group
killing). There is **no Linux kernel-level syscall filtering** and the container does not drop
Linux capabilities. A compromised preview server could call arbitrary syscalls (e.g. `ptrace`
another process, `mount` a host path, escalate via `setuid`).

Defence in depth = three independent layers:

1. **Seccomp** — block dangerous syscalls at the kernel boundary.
2. **Capability drop** — remove Linux capabilities the sandbox never needs.
3. **Non-root user** — the build process runs unprivileged, so even a seccomp/cap gap is contained.

## 1. Seccomp profile

`infra/e2b/seccomp-profile.json` is an OCI/Docker-format profile: **default-allow** with an
explicit ERRNO **denylist** of privilege-escalation and host-tampering syscalls —
`ptrace`/`process_vm_*` (cross-process memory), `mount`/`umount2`/`pivot_root`/`chroot`
(filesystem escape), the `setuid`/`setgid` family (UID/GID escalation), kernel-module load,
`kexec`/`reboot`/`swapon`/clock tampering, the kernel keyring, and `bpf`/`perf_event_open`.

A default-allow denylist (rather than a stricter default-deny allowlist) is the right trade-off
for a *general* build sandbox: `npm install` + `vite build` touch a very wide syscall surface, so
an allowlist would be brittle and break legitimate builds. The denylist precisely blocks the
dangerous classes without that fragility. The profile is validated by
`tests/seccompProfile.test.ts`, so it cannot silently drift out of coverage.

### Apply with Docker / OCI runtime

```bash
docker run \
  --security-opt seccomp=infra/e2b/seccomp-profile.json \
  --security-opt no-new-privileges \
  ...
```

### Apply with E2B

E2B manages the container runtime, so seccomp/capability options must be set at the **E2B
platform / template** layer rather than from NavBharatAI's server code. When E2B exposes a
custom seccomp profile or security-options field for a template, point it at this file (or its
contents). Until then, this profile is the canonical source of truth to hand to the platform.

## 2. Drop Linux capabilities

The sandbox needs no special capabilities. Drop everything, then add back only what a dev server
binding to a port might need:

```bash
docker run --cap-drop ALL --cap-add NET_BIND_SERVICE ...
```

(For E2B: set this at the template/platform layer, same as seccomp above.)

## 3. Non-root user

> **Why this is NOT done in `e2b.Dockerfile` here:** the image's `WORKDIR` is
> `/home/user/workspace` (it must match `WORKSPACE_ROOT` in `E2BActuator.ts`), and E2B's runtime
> manages the `user` account + workspace ownership. Naively adding `USER node` (whose home is
> `/home/node`) would point the build at a directory it does not own and **break MODE A/B builds**
> — a real breakage risk for a LOW-priority hardening item (safeguard #3). The correct place to
> enforce non-root is the E2B template/runtime, where the workspace user and its ownership are
> provisioned together.

When applied at the runtime layer, ensure:

- the build process runs as a non-root user that **owns** `/home/user/workspace`;
- combined with `--cap-drop ALL` and `no-new-privileges`, so dropped privileges can't be regained.

## Verification

- `infra/e2b/seccomp-profile.json` is valid JSON and blocks the required syscalls →
  `tests/seccompProfile.test.ts` (run via `npx vitest run`).
- After a runtime apply, confirm inside a sandbox that a blocked syscall is denied, e.g.
  `strace -f mount ...` returns `EPERM`, and `id` shows a non-root uid.
