// THE CHAT NAMES ITS PLATFORM (admin 2026-10-11, Q-123).
//
// The server strips every sentence that teaches buying from what the iPhone app's AIs are told
// (src/server/AppContext/iosPurchaseGuard.ts). It can only do that when the request says it came from the
// iPhone app, so every chat request carries `X-NBAI-Platform`. Sent only from the native apps — the web
// sends nothing and is treated as the web — and only on the chat calls, so no other route's CORS answer has
// to know the header.
import { nativePlatformName } from './mobileNative';

export function platformHeader(): Record<string, string> {
  const p = nativePlatformName();
  return p === 'ios' || p === 'android' ? { 'X-NBAI-Platform': p } : {};
}
