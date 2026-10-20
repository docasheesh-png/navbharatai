import { describe, expect, it } from 'vitest';
import { createFirestoreDeployStore, DeployStoreUnavailable } from '../src/server/AgentV3/hostedDeployments';

describe('durable deployment claims fail closed', () => {
  it('refuses new work when the database is absent', async () => {
    await expect(createFirestoreDeployStore(() => null).claim('app-a', 'owner-a', 1)).rejects.toBeInstanceOf(DeployStoreUnavailable);
  });
  it('refuses new work when a transaction rejects, including an ambiguous commit', async () => {
    const store = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw new Error('commit acknowledgement lost'); } };
    await expect(createFirestoreDeployStore(() => store as never).claim('app-a', 'owner-a', 1)).rejects.toBeInstanceOf(DeployStoreUnavailable);
  });
});
