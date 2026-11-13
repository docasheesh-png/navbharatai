/** Caller must supply an already-verified identity. Credits/free-build grants are not authority. */
export function explicitStoreAdmin(verifiedEmail: string | null, configuredAdmins: string | undefined): boolean {
  if (!verifiedEmail) return false;
  const allowed = (configuredAdmins || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(verifiedEmail.toLowerCase());
}
