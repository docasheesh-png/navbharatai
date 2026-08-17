import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock } from './helpers/sourceSlice';

/**
 * THE WHOLE CHAIN, END TO END (admin 2026-08-08).
 *
 * "Jab app banaye aur credentials ki need ho, to popup aa jaye, user name+value bhar kar save kare, woh
 * Settings ke keys column me save ho, aur app se 100% sync ho."
 *
 * Six links, and the feature is a lie if any one is missing: the builder can ask → the ask reaches the
 * client → a popup renders with fields → saving writes the ENCRYPTED VAULT (the same store Settings
 * uses) → the build is told → the keys land in the RUNNING app's `.env`.
 *
 * The unit logic is tested in `secretRequest.test.ts`. What can silently regress is the wiring, which
 * is exactly the defect class this session spent the day removing — a real Render deploy engine with no
 * caller, a palette AI nothing could reach, four routes with no door.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const catalog = read('src/server/AgentV3/ToolCatalog.ts');
const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
const route = read('src/server/routes/agentv3.ts');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const card = read('src/components/agentv3/SecretRequestCard.tsx');
const reducer = read('src/components/agentv3/agentV3Reducer.ts');
const hook = read('src/hooks/useAgentV3Build.ts');

describe('link 1 — the builder can actually ask', () => {
  it('request_secrets is registered in BOTH the definition and the exposed list', () => {
    // A tool defined but absent from the catalog list is invisible to the agent.
    expect(catalog).toContain("name: 'request_secrets'");
    expect(catalog).toContain("  'request_secrets',");
  });

  it('the description tells the agent to ask INSTEAD of writing a placeholder', () => {
    const at = catalog.indexOf("name: 'request_secrets'");
    const def = catalog.slice(at, at + 2200);
    expect(def).toContain('instead of writing a placeholder');
    expect(def).toContain('never fake it');
  });
});

describe('link 2 — the dispatcher asks and does not fake the outcome', () => {
  const fn = braceBlock(dispatcher, "case 'request_secrets': {");

  it('filters through the tested planner rather than trusting the model', () => {
    expect(fn).toContain('planSecretRequest(rawAsks, this.savedSecretNames)');
  });

  it('says so honestly when there is no user to ask', () => {
    // Without a verified user there is no vault, so a popup would lose whatever they typed.
    expect(fn).toContain('if (!this.onSecretsNeeded)');
    expect(fn).toContain('no signed-in user');
  });

  it('a SKIP keeps building and forbids a fake feature', () => {
    expect(fn).toContain("secretRequestResult('skipped', askedNames)");
    expect(fn).toContain('visibly disabled');
    expect(fn).toContain('never a fake success');
  });

  it('a vault save that could NOT reach the sandbox says exactly that', () => {
    // "Saved" and "saved AND wired" are different facts; blurring them would have the agent build
    // against a key the running app does not have.
    expect(fn).toContain('could not be written into the running app');
  });

  it('it does not ask twice for the same key inside one build', () => {
    expect(fn).toContain('this.savedSecretNames = [...this.savedSecretNames, ...Object.keys(saved)]');
  });
});

describe('link 3 — the keys reach the RUNNING app, not just the vault', () => {
  const fn = braceBlock(dispatcher, "case 'request_secrets': {");

  it('merges into the app\'s .env immediately', () => {
    // The vault is read once at build START. Without this write, a key saved mid-build would not exist
    // for the running app until the next build — the same gap rescueDatabase closed for the database.
    expect(fn).toContain('mergeDotEnv(existing, saved)');
    expect(fn).toContain("writeFile(this.workspaceId, '.env', merged)");
  });

  it('and the user\'s real keys are kept out of their git repo', () => {
    expect(fn).toContain('gitignoreWithEnv');
  });
});

describe('link 4 — the ask reaches the client', () => {
  it('the route emits secret_request and waits for the answer', () => {
    expect(route).toContain("type: 'secret_request'");
    expect(route).toContain('await awaitApproval(requestId)');
  });

  it('it is wired ONLY for a verified user', () => {
    expect(route).toContain('dispatcher.setSecretRequestHandler(');
    expect(route).toContain('dispatcher.setSavedSecretNames(Object.keys(vaultSecrets))');
  });

  it('the server re-READS the vault — that is how a mid-build save becomes visible', () => {
    expect(route).toContain('const fresh = await loadUserVaultSecrets(userId)');
  });

  it('and returns ONLY the keys that were asked for', () => {
    // A build must never quietly pull in unrelated keys the user happens to have saved.
    expect(route).toContain('for (const a of asks) {');
    expect(route).toContain('const v = fresh[a.name];');
  });

  it('the reducer surfaces it as its own gate, not the yes/no one', () => {
    expect(reducer).toContain("case 'secret_request':");
    expect(reducer).toContain('pendingSecrets:');
  });
});

describe('link 5 — the popup, with the minimise the admin asked for', () => {
  it('is rendered by the panel from pendingSecrets', () => {
    expect(panel).toContain('{state.pendingSecrets && (');
    expect(panel).toContain('<SecretRequestCard');
  });

  it('MINIMISES rather than dismissing — the typing survives', () => {
    // A user without the key to hand must be able to go and get it without losing the form or killing
    // the build. The state lives in the card and it is never unmounted.
    expect(card).toContain('const [minimised, setMinimised] = useState(false)');
    expect(card).toContain('if (minimised) {');
    expect(card).toContain('onClick={() => setMinimised(false)}');
  });

  it('a value is hidden by default and never autocompleted', () => {
    // Someone pasting a production key is usually screen-sharing or being watched.
    expect(card).toContain("type={shown[s.name] ? 'text' : 'password'}");
    expect(card).toContain('autoComplete="off"');
  });

  it('typing nothing is a SKIP, not an error', () => {
    expect(card).toContain('if (Object.keys(toSave).length === 0) { onDone(false); return; }');
  });

  it('a FAILED save never answers "saved"', () => {
    // Otherwise the build wires keys that are not there.
    expect(card).toContain('if (!ok) {');
    expect(card).toContain('could not be saved just now');
  });
});

describe('link 6 — saving writes the SAME vault Settings uses', () => {
  it('the panel calls the shared secrets API, not a private path', () => {
    // Matched on the MODULE rather than one exact member list: the panel legitimately imports more
    // from this client over time (it gained `listSecrets` when v5's More menu grew a Keys & Secrets
    // door). What must never change is WHERE the call comes from — the shared, always-authenticated
    // vault client — so that is what is pinned.
    expect(panel).toMatch(/import \{[^}]*\bsaveSecret\b[^}]*\} from '\.\.\/\.\.\/lib\/secretsApi'/);
    expect(panel).toContain('await saveSecret(userId, name, value)');
    // And never a hand-rolled request to the vault, which is how the auth header got forgotten before.
    expect(panel).not.toMatch(/fetch\(\s*[`'"]\/api\/secrets/);
  });

  it('answering clears the gate so a saved key is never asked for again on screen', () => {
    expect(hook).toContain('pendingPermission: undefined, pendingSecrets: undefined');
  });
});

describe('THE SECURITY PROPERTY — a value never travels on the build stream', () => {
  it('the emitted event carries names and reasons only', () => {
    // buildDiag.recordCommand stores raw strings UNREDACTED and the transcript is persisted, so a value
    // sent this way would sit in storage forever.
    const types = read('src/server/AgentV3/types.ts');
    const at = types.indexOf("type: 'secret_request'");
    const def = types.slice(at, types.indexOf('\n', at + 200) + 1);
    expect(def).toContain('name: string');
    expect(def).toContain('why: string');
    expect(def).not.toContain('value');
  });

  it('the dispatcher never receives a value from the client either', () => {
    const fn = braceBlock(dispatcher, "case 'request_secrets': {");
    // It learns the values by re-reading the vault server-side, never from the answer.
    expect(fn).not.toContain('reqRec.value');
    expect(fn).toContain('await this.onSecretsNeeded(plan.ask)');
  });
});

/**
 * LINK 0 — THE ONE THAT WOULD HAVE MADE ALL SIX POINTLESS.
 *
 * The tool was registered, the popup rendered, the vault wired and the .env merge proven — and the
 * system prompt said, in its own words, "SECRETS / API KEYS the app needs: NEVER ask". The builder
 * would have obeyed the prompt and never called the tool. A capability the model is forbidden to use is
 * as dead as one with no caller; it just fails somewhere a grep does not look.
 *
 * The chat-safety half of that rule was RIGHT and is kept: a secret must never be pasted into chat,
 * because chat is stored. What changed is where the instruction routes — to the popup, instead of to
 * "tell them to add it in Settings afterwards", which is the after-the-build dead end this feature
 * exists to remove.
 */
describe('link 0 — the builder is TOLD to use the tool', () => {
  const prompt = read('src/server/AgentV3/systemPrompt.ts');

  it('the prompt names request_secrets', () => {
    expect(prompt).toContain('call the request_secrets TOOL');
  });

  it('the chat-safety rule survives — a secret still never goes in chat', () => {
    expect(prompt).toContain('NEVER ask the user to paste a key into the CHAT');
  });

  it('it says ask EARLY, not at the end', () => {
    // Telling the user afterwards leaves them with a broken app and homework.
    expect(prompt).toContain('Ask AS SOON AS you know the app needs it, not at');
  });

  it('and a skip still forbids a fake feature', () => {
    expect(prompt).toContain('never a fake success');
  });
});
