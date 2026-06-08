import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { CheckpointStorage } from '../checkpoint/CheckpointStorage';
import { InProcessEventBus } from '../eventbus/InProcessEventBus';
import { EventHistoryStore } from '../eventbus/EventHistoryStore';

export class DeploymentRollbackManager {
  private checkpoint = new CheckpointManager(
      new CheckpointStorage(), 
      new InProcessEventBus(new EventHistoryStore('rollback'))
  );

  async rollback(workspaceId: string): Promise<void> {
    await this.checkpoint.loadCheckpoint(workspaceId);
  }
}
