// A DOMAIN THAT TURNS ACTIVE AFTER THE LAST PUBLISH GETS THE PUBLISHED APP — once, by itself (queue Q-163).
//
// A publish writes the app to two places: the shared published link, and — for a workspace that already has a
// domain connected — that domain's own site. A domain connected AFTER the last publish therefore served
// nothing ("site not found") until the user happened to press Publish again; the status card said so
// honestly, but the step was a chore with no reason to exist. The admin chose (2026-10-05) to copy the
// ALREADY-PUBLISHED release to the new domain instead of rebuilding — so there is no "which build is
// current" question: it is exactly what the published link already serves, read back from the publish
// bucket's copy of it.
//
// 🔒 THE RULES that make an unattended deploy to someone's domain acceptable:
//   • only when the domain's site is genuinely EMPTY (the hosting service's own "nothing published" page,
//     matched on two markers by `checkDomainServing`) — a domain showing anything is never touched;
//   • only the app's OWNER's domain, only an ACTIVE published app (never a held, paused or taken-down one);
//   • ONCE per domain and app — claimed in a transaction before deploying, so two instances cannot both do it
//     and a failure is not retried forever (the honest "press Publish" message covers a failure);
//   • the owner is told either way, in plain words that never name the hosting vendor;
//   • `DOMAIN_AUTOPUBLISH=off` turns it off.

import { deploymentStore, type DeploymentRecord } from '../AgentV3/DeploymentStore';
import { channelSubdomain, FirebaseHostingDeployer } from '../AgentV3/Deployment';
import { publishedAppDomain } from '../AgentV3/bucketOnlyPublish';
import { publishedAppsBucket, APP_PREFIX } from '../AgentV3/bucketPublish';
import { isRetryableDomainPublishError } from '../AgentV3/customDomainPublish';
import { doc, runTransaction, getServerDb } from './serverDb';
import { saveNotification } from './AdminNotificationStore';
import type { DomainLinkRecord } from './firebaseDomainLink';
import * as admin from 'firebase-admin';

/** Where the once-only claims live. One document per domain. */
export const AUTOPUBLISH_COLLECTION = 'domain_autopublish';
/** Bounds on what is read back from the bucket — a published static app, not an archive. */
export const MAX_COPY_FILES = 3_000;
export const MAX_COPY_BYTES = 200 * 1024 * 1024;

export type AutoPublishOutcome =
  | 'published' | 'failed'
  | 'disabled' | 'nothing-published' | 'not-owner' | 'no-copy' | 'already-done';

export function autoPublishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.DOMAIN_AUTOPUBLISH ?? '').trim().toLowerCase() !== 'off';
}

/** The bucket key of a published app, from its public URL (branded `<sub>.<domain>` or the hosting host). PURE. */
export function publishedSubdomain(url: string, brandedDomain: string): string {
  const host = String(url || '').trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase();
  const domain = String(brandedDomain || '').trim().replace(/^\.+|\.+$/g, '').toLowerCase();
  if (domain && host.endsWith(`.${domain}`)) {
    const sub = host.slice(0, -(domain.length + 1));
    return /^[a-z0-9-]+$/.test(sub) ? sub : '';
  }
  return channelSubdomain(`https://${host}`);
}

export function publishedMessage(domain: string): string {
  return `${domain} is now showing your published app. It was connected after your last publish, so NavBharatAI put `
    + `the version that is already live on it — nothing was rebuilt. From now on, every Publish updates it too.`;
}

export function failedMessage(domain: string): string {
  return `${domain} is connected, but NavBharatAI could not put your published app on it just now. Open your app and `
    + `press Publish once — that updates your domain as well.`;
}

export interface AutoPublishDeps {
  enabled: () => boolean;
  deployment: (workspaceId: string) => Promise<DeploymentRecord | null>;
  readPublished: (sub: string) => Promise<Map<string, Buffer> | null>;
  claimOnce: (domain: string, workspaceId: string) => Promise<boolean>;
  deployToSite: (workspaceId: string, files: Map<string, Buffer>) => Promise<unknown>;
  notify: (userId: string, message: string) => Promise<unknown>;
  brandedDomain: () => string;
}

/** Put the already-published app on a newly active, still-empty domain. Never throws. */
export async function autoPublishToNewDomain(link: DomainLinkRecord, deps: AutoPublishDeps): Promise<AutoPublishOutcome> {
  try {
    if (!deps.enabled()) return 'disabled';
    if (link.suspended) return 'disabled';
    const dep = await deps.deployment(link.workspaceId);
    if (!dep || (dep.status ?? 'active') !== 'active' || !dep.url) return 'nothing-published';
    if (dep.userId !== link.userId) return 'not-owner';
    const sub = publishedSubdomain(dep.url, deps.brandedDomain());
    const files = sub ? await deps.readPublished(sub) : null;
    if (!files || files.size === 0 || !files.has('index.html')) return 'no-copy';
    if (!(await deps.claimOnce(link.domain, link.workspaceId))) return 'already-done';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await deps.deployToSite(link.workspaceId, files);
        await deps.notify(link.userId, publishedMessage(link.domain)).catch(() => null);
        return 'published';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 2 || !isRetryableDomainPublishError(msg)) break;
      }
    }
    await deps.notify(link.userId, failedMessage(link.domain)).catch(() => null);
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** Read a published app back from the bucket's copy. `null` when the bucket is not configured or unreadable. */
async function readPublishedFromBucket(sub: string): Promise<Map<string, Buffer> | null> {
  const bucketName = publishedAppsBucket();
  if (!bucketName || !/^[a-z0-9-]+$/.test(sub)) return null;
  try {
    const prefix = `${APP_PREFIX}/${sub}/`;
    const [objects] = await admin.storage().bucket(bucketName).getFiles({ prefix, maxResults: MAX_COPY_FILES + 1 });
    if (objects.length === 0 || objects.length > MAX_COPY_FILES) return null;
    const files = new Map<string, Buffer>();
    let bytes = 0;
    for (const o of objects) {
      const rel = o.name.slice(prefix.length);
      if (!rel || rel.endsWith('/') || rel.split('/').some((p) => p === '..')) continue;
      const [buf] = await o.download();
      bytes += buf.length;
      if (bytes > MAX_COPY_BYTES) return null;
      files.set(rel, buf);
    }
    return files;
  } catch {
    return null;
  }
}

/** Claim the once-only right for this domain + app, in a transaction. A store that cannot answer ⇒ no. */
async function claimOnceInFirestore(domain: string, workspaceId: string): Promise<boolean> {
  try {
    const db = getServerDb() as any;
    if (!db) return false;
    const ref = doc(db, AUTOPUBLISH_COLLECTION, domain.toLowerCase());
    return await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      if (snap.exists() && snap.data()?.workspaceId === workspaceId) return false;
      t.set(ref, { domain: domain.toLowerCase(), workspaceId, at: Date.now() });
      return true;
    });
  } catch {
    // Unlike the job lease, an unanswerable claim does NOT proceed: this deploys to someone's domain, and
    // the honest status card already offers the one-press alternative.
    return false;
  }
}

export const realAutoPublishDeps: AutoPublishDeps = {
  enabled: () => autoPublishEnabled(),
  deployment: (ws) => deploymentStore.get(ws),
  readPublished: readPublishedFromBucket,
  claimOnce: claimOnceInFirestore,
  deployToSite: (ws, files) => new FirebaseHostingDeployer().deployToSite(ws, files),
  notify: (userId, message) => saveNotification({ message, target: { type: 'user', userId }, createdBy: 'system' }),
  brandedDomain: () => publishedAppDomain(),
};
