# Branded preview URLs — the Cloudflare Worker

What this replaces, and what it costs, stated before the steps so the decision is reviewable.

## Why a Worker and not the documented path

E2B's own custom-domain documentation asks for a **GCP VM running Caddy**. That is precisely the VM
(`e2b-custom-domain-proxy`, us-west1-a) that was deleted on 2026-08-02 to save ~₹1,350/month. Going
back to it would restore both the bill and its weakness: one VM in one region is a single point of
failure for every user's preview.

This Worker does the same job with no server:

| | Cost | If it fails |
|---|---|---|
| GCP VM + Caddy (E2B's documented path) | ~₹1,350/month | every preview, everywhere, is down |
| **Cloudflare Worker (this)** | **₹0** on the free tier (100k requests/day), $5/month beyond it | Cloudflare's edge, 300+ locations |

Cheaper *and* more available — not a trade-off, which is the only reason it is worth changing a
working system at all.

A third option, running `cloudflared` inside each sandbox, was rejected: E2B bills by CPU-hour
(~$0.083/hr, measured), so a daemon in every sandbox would add cost to every build forever.

## What the user gets

```
before   https://5173-abc123.e2b.app      ← names our vendor in the address bar
after    https://5173-abc123.mitrify.xyz  ← ours
```

The server side is **already written**: `applyPreviewDomain()` in
`src/server/AgentV3/PreviewDomain.ts` performs this swap the moment `E2B_PREVIEW_DOMAIN` is set. The
Worker is the other half — the thing that actually answers on that hostname. Neither is any use
alone, and `tests/previewProxyWorker.test.ts` asserts the two still agree.

## Setup (about 15 minutes, all in the Cloudflare dashboard)

Nothing here deploys automatically. Every step is yours.

### 1. Create the Worker

Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**. Name it
`navbharatai-preview-proxy`. Replace the starter code with the contents of `worker.js` and **Deploy**.

### 2. Point the wildcard at it

In the **mitrify.xyz** zone:

- **DNS** → add record: type `AAAA`, name `*`, IPv4/IPv6 `100::`, **Proxied (orange cloud) ON**.
  The address is a documented discard range — it is never contacted, it only exists so Cloudflare has
  a proxied record to attach a Worker route to.
- Worker → **Settings** → **Domains & Routes** → **Add route**: `*.mitrify.xyz/*`, zone `mitrify.xyz`.

### 3. Tell the server to use it

Cloud Run → the service's environment:

```
E2B_PREVIEW_DOMAIN=mitrify.xyz
```

That single variable is the switch. **Unsetting it reverts everything instantly** — the server goes
back to publishing raw `*.e2b.app` URLs and the Worker simply stops being asked. There is no
migration and nothing to undo.

### 4. Check it

Build any app in v5.0, wait for the preview, then:

- the URL shown ends in `.mitrify.xyz` and the page loads
- edit a file — the preview updates by itself (this is the WebSocket path; if hot reload stops
  working, that is the part to look at first)
- open the preview in a new tab and reload — still fine
- leave it 20+ minutes so the sandbox is reaped, then reload — you should get the
  "This preview has gone to sleep" page, **not** a raw gateway error

## Certificates

`5173-abc123.mitrify.xyz` is one level below the apex, which free Universal SSL covers. A deeper
name like `abc.preview.mitrify.xyz` would **not** be covered and would need Advanced Certificate
Manager ($10/month) — which is why the hostname is shaped this way and should stay that way.

## The security line

The Worker forwards **only** to `{port}-{sandboxId}.e2b.app`, with the port and the sandbox id
strictly validated, and refuses everything else with a 404.

This is not caution for its own sake. If any hostname could be mapped to any upstream, anyone could
serve their own content from `*.mitrify.xyz` — a phishing page on our domain, holding our own valid
certificate. `tests/previewProxyWorker.test.ts` pins nine specific refusals, including a nested label
smuggling another host and a request to loop back to the upstream itself.

## What this does NOT do yet

The URL still changes when the sandbox does, and a shared link dies once the sandbox is reaped. So a
link a user sends to somebody today may not work tomorrow. Fixing that needs a stable per-workspace
slug plus wake-on-demand (the Worker asking our API to resume a paused sandbox), which is a separate
piece of work — deliberately not bundled in here, so this first step stays small, reversible, and
easy to judge on its own.
