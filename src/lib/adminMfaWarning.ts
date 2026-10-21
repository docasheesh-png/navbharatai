// The admin login's second factor is opt-in, and its OFF state used to be visible only inside the Security tab — which
// also fetched the status only when it was opened. So an admin who never opened it never learned the login had no
// second factor (admin 2026-10-17). This is the one rule for when the dashboard says so out loud.
//
// `null` status means "not measured yet / the request failed": that is NOT "enabled" and NOT "disabled", and it must
// say nothing — a warning built on a guess would be as dishonest as silence built on one.
export interface AdminMfaStatusLike { enabled: boolean; envManaged?: boolean }

export function adminMfaWarning(status: AdminMfaStatusLike | null | undefined): string | null {
  if (!status || typeof status.enabled !== 'boolean') return null;
  if (status.enabled) return null;
  return 'Admin sign-in has no second factor: a stolen password alone is enough to get in. Turn on the authenticator code in Security → Two-factor sign-in.';
}
