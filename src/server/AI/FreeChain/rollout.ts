import type { ChatReplyLanguage } from '../../../lib/chatReplyLanguage';
import type { EntryAdmissionGrant } from './entryAdmission';
import { createHash } from 'node:crypto';
import type { FreeChainConfig, ProviderId } from './config';
export interface FreeChainControl { enabled?: boolean; rolloutPercent?: number; disabledProviders?: ProviderId[] }
export interface FreeChainContext {
  /** Verified by the server, never copied from req.body.userId. Anonymous requests remain legacy. */
  uid: string;
  conversationKey: string;
  privateTurn: boolean;
  healthTurn: boolean;
  cacheEligible: boolean;
  /** Per-chat explicit choice resolved before history/context trimming; never account state. */
  replyLanguage?: ChatReplyLanguage;
  /** Teacher/exam surface (server-derived from the request mode); routes to the quality model. */
  teachingTurn?: boolean;
  /** Opaque server-issued entry lease, never accepted from request JSON. */
  entryAdmission?: EntryAdmissionGrant;
  /**
   * Verified admin (isAdminEmail on the Firebase-verified grant email). Set only by
   * freeChainRequestContext — never from body. Used for CHEAPERINFERENCE=admin exclusive path.
   */
  isAdmin?: boolean;
}
export function rolloutBucket(uid: string): number { return parseInt(createHash('sha256').update(`free-chat-chain:v1:${uid}`).digest('hex').slice(0, 8), 16) % 10000; }
export function selectedForFreeChain(config: FreeChainConfig, control: FreeChainControl, uid: string | undefined): boolean {
  if (!config.enabled || !uid || control.enabled === false) return false;
  return config.allowUids.includes(uid) || rolloutBucket(uid) < (control.rolloutPercent ?? config.rolloutPercent) * 100;
}
