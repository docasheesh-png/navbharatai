/** The file written into a published app when its shared database starts.
 *  It has no key in it. The key stays in the secret vault.
 *  The path `/api/v1/data/` is the real prefix the published app calls.
 */
export function dataClientSource(): string {
  return `/* NavBharatAI data client.
 * The address and the key live in this app's secrets:
 *   VITE_NBAI_DATA_URL
 *   VITE_NBAI_DATA_KEY
 * Publish the app again so they are included. The key is visible to anyone who can
 * load the published app; it identifies the app, not a user.
 * Call configureNbaiAuth(() => yourFirebaseUser.getIdToken()) using the same
 * trusted Firebase project as NavBharatAI. Other auth providers need a connected
 * database with their own verified access policies. Never pass a user id as proof.
 * This file does not remove the Made with NavBharatAI badge. That follows the hosting plan.
 */
var DATA_API = '/api/v1/data/';
var nbaiGetToken;
export function configureNbaiAuth(getToken) {
  if (typeof getToken !== 'function') throw new Error('Connect a real sign-in token provider.');
  nbaiGetToken = getToken;
}
function nbaiCfg() {
  var env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  return {
    url: String(env.VITE_NBAI_DATA_URL || ''),
    key: String(env.VITE_NBAI_DATA_KEY || ''),
  };
}
function nbaiUrl(cfg, path) {
  if (cfg.url.indexOf(DATA_API) < 0) throw new Error('The data address is not a NavBharatAI data API. Nothing was sent.');
  return cfg.url + path;
}
async function nbaiCall(method, path, body) {
  var cfg = nbaiCfg();
  if (!cfg.url || !cfg.key) throw new Error('The data API is not set up in this app yet. Publish again after the database is ready.');
  if (!nbaiGetToken) throw new Error('Connect sign-in with configureNbaiAuth before using this database.');
  var token = await nbaiGetToken();
  if (!token) throw new Error('Please sign in to access your records.');
  var res = await fetch(nbaiUrl(cfg, path), {
    method: method,
    headers: { Authorization: 'Bearer ' + token, 'X-Nbai-Key': cfg.key, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'The data API refused that.');
  return data;
}
export function nbList(collection, cursor) { return nbaiCall('GET', '/' + encodeURIComponent(collection) + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')); }
export function nbGet(collection, id) { return nbaiCall('GET', '/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id)); }
export function nbAdd(collection, record) { return nbaiCall('POST', '/' + encodeURIComponent(collection), record); }
export function nbUpdate(collection, id, record) { return nbaiCall('PATCH', '/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id), record); }
export function nbRemove(collection, id) { return nbaiCall('DELETE', '/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id)); }
`;
}
