import type { Request, Response } from 'express';
import { withFixedTextChainScope } from '../fixedTextChain';
import { strictFreeRequired } from '../inferencePolicy';
import { onClientGone } from '../../lib/clientDisconnect';
import { runWithAuthenticatedInferenceGatewayRequest, runWithApiKeyInferenceGatewayRequest, runWithInferenceGatewayContext, runWithInferenceGatewayEntryAdmission, InferenceGatewayTerminalError } from './runtime';
import type { InferenceGatewayContext } from './context';
/** Product conversational boundary only. Never install this on Pro, developer API
 * or published-app inference: their identity/payer contracts remain independent.
 */
export async function withConversationalGateway<T>(req: Request, res: Response,
  input: Pick<InferenceGatewayContext, 'surface' | 'policyKey' | 'funding' | 'qualityTier' | 'dataClass'> & { verifiedUid: string; verifiedApiKeyId?: string; requiredApiScopes?: readonly import('../../lib/ApiKeyManager').ApiScope[] },
  run: () => Promise<T>): Promise<T> {
  const controller = new AbortController(); const deadlineAtMs = Date.now() + 90000;
  onClientGone(res, () => controller.abort());
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    return await withFixedTextChainScope(input.surface, 'text', () => {
      const enter = (uid: string | null) => {
      if (!uid || uid !== input.verifiedUid) throw new InferenceGatewayTerminalError('context-unverified');
      return runWithInferenceGatewayContext({ ...input, principalId: uid, tenantId: uid,
        mode: strictFreeRequired() ? 'strict-free' : 'free-first-authorized-paid', deadlineAtMs, signal: controller.signal },
      () => runWithInferenceGatewayEntryAdmission(async () => { controller.signal.throwIfAborted(); const result = await run(); controller.signal.throwIfAborted(); return result; }));
      };
      return input.surface === 'developer-api'
        ? runWithApiKeyInferenceGatewayRequest(req, { uid: input.verifiedUid, keyId: input.verifiedApiKeyId ?? '', scopes: input.requiredApiScopes ?? [] }, enter)
        : runWithAuthenticatedInferenceGatewayRequest(req, enter);
    });
  } finally { clearTimeout(timer); }
}
