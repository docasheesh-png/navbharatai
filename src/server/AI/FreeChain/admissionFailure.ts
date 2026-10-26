import { chatAvailabilityMessage, type ChatAvailabilityInput } from '../../lib/chatAvailabilityMessage';
import type { AdmissionDenial } from './admissionQueue';

/** The queue's generic capacity reason also covers invalid configuration: it is not proof of load. */
export function freeChainAdmissionFailure(reason: AdmissionDenial, input: ChatAvailabilityInput) {
  const overloaded = reason === 'queue-full' || reason === 'timeout';
  return {
    status: reason === 'user-limit' ? 429 : 503,
    body: {
      ok: false as const,
      code: overloaded ? 'CHAT_CAPACITY_EXHAUSTED' : reason === 'user-limit' ? 'CHAT_REQUEST_IN_PROGRESS' : 'CHAT_ROUTE_UNAVAILABLE',
      reply: chatAvailabilityMessage(overloaded ? 'capacity' : 'temporary', input),
    },
  };
}
