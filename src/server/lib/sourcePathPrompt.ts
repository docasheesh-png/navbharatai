/**
 * Source paths are locations, not product requirements or build orders.
 *
 * Keep this deliberately limited to path-shaped tokens with a known source/config extension.
 * It must not strip ordinary words such as "game" when they occur outside a path.
 */
const SOURCE_PATH_TOKEN = /(^|[\s"'\x60(\[])(?:[A-Za-z]:[\\/])?(?:\.{1,2}[\\/]|[\\/])?(?:[\w@.-]+[\\/])+[\w@.-]+\.(?:[cm]?[jt]sx?|json|css|scss|sass|less|html?|vue|svelte|py|go|rs|java|kt|swift|mdx?|ya?ml|toml|sql|sh|xml|svg|gradle|properties|lock|env|txt|ipynb)(?=$|[\s"'\x60)\]},;.!?])/gi;

const SOURCE_PATH_ONLY = /^(?:[A-Za-z]:[\\/])?(?:\.{1,2}[\\/]|[\\/])?(?:[\w@.-]+[\\/])+[\w@.-]+\.(?:[cm]?[jt]sx?|json|css|scss|sass|less|html?|vue|svelte|py|go|rs|java|kt|swift|mdx?|ya?ml|toml|sql|sh|xml|svg|gradle|properties|lock|env|txt|ipynb)$/i;

/** True only when the entire message is a source/config file path, optionally wrapped in punctuation. */
export function isSourcePathOnly(input: string | null | undefined): boolean {
  const candidate = String(input ?? '')
    .trim()
    .replace(/^[\x60"'(\[]+|[\x60"')\]},;.!?]+$/g, '')
    .trim();
  return candidate.length > 0 && SOURCE_PATH_ONLY.test(candidate);
}

/** Remove source-path tokens before product-domain keyword matching. */
export function withoutSourcePaths(input: string | null | undefined): string {
  return String(input ?? '').replace(SOURCE_PATH_TOKEN, (_match, prefix: string) => prefix || ' ');
}
