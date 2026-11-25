/**
 * WAS THIS APP PUT ONLINE ON THIS TURN? — the fact the claim audit weighs "your app is live" against (master audit
 * 2026-11-25, Part N: "claiming a deployment succeeded without checking deployment status").
 *
 * true: a deploy tool call SUCCEEDED this turn (TOOL_DONE is recorded only on success; a failed deploy throws).
 * false: none did, and the project has no live deployment.
 * undefined: an app already live from an earlier Publish (the summary may rightly say it is live), or the record could not
 * be read in time — the audit is silent, because a false accusation is worse than a missed one. Never throws.
 */
import { deploymentStore, isLiveDeployment, type DeploymentRecord } from './DeploymentStore';

export interface DeployFactPorts {
  deploySucceeded: () => boolean;
  read: (workspaceId: string) => Promise<DeploymentRecord | null>;
}

export async function deployedThisTurn(workspaceId: string, deploySucceeded: () => boolean, ports: Partial<DeployFactPorts> = {}, ms = 1_500): Promise<boolean | undefined> {
  try {
    if ((ports.deploySucceeded ?? deploySucceeded)()) return true;
    const read = ports.read ?? ((id: string) => deploymentStore.get(id));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ms); });
    const rec = await Promise.race([read(workspaceId), late]);
    if (timer) clearTimeout(timer);
    if (rec === 'late') return undefined;
    return isLiveDeployment(rec ?? undefined) ? undefined : false;
  } catch { return undefined; }
}
