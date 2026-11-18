// The App Mart's requests carry the admin session too, when one is active (storeAdminPermission.ts on the server).
//
// The Review tab, the moderation actions and the gallery queue are gated on the server's store-authority decision,
// which accepts EITHER a listed reviewer email OR the signed admin session that shows "Admin Panel". The session
// travels only in the `x-admin-token` header (never a URL), and only to our own App Mart routes — so this merges it
// into the store's headers and nowhere else. No token ⇒ the headers are returned unchanged. PURE apart from storage.
import { ADMIN_TOKEN_HEADER, adminToken } from './adminFetch';

export function withStoreAdminSession(
  headers: Record<string, string>,
  storage?: Pick<Storage, 'getItem'>,
): Record<string, string> {
  const token = adminToken(storage);
  return token ? { ...headers, [ADMIN_TOKEN_HEADER]: token } : headers;
}
