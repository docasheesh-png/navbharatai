import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  normalizeAppName, validateAppName, repoSlugFromAppName, effectiveAppName,
  findDuplicate, appNameErrorMessage, MAX_APP_NAME_LENGTH,
} from '../src/server/AgentV3/appName';

/**
 * THE APP'S NAME, AS THE USER CHOSE IT (admin 2026-09-04).
 *
 * *"jab jab bhi app bane to chat box me hi ek dedicated message sirf 'name' ke liye ho … jab user
 * save kare to har jagah wahi name ho jo user ne dala hai (duplicate not allowed) aur sath me ai ka
 * app building disturb bhi na ho."*
 *
 * Two of those clauses are the ones that can silently go wrong, so they are pinned hardest here:
 * "har jagah" (one resolver, used by every surface) and "building disturb na ho" (which is a property
 * of where the repo name is READ from, not a promise anyone can keep by being careful).
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('normalizeAppName — tidy the typing, keep the name', () => {
  it('collapses the whitespace a real person produces', () => {
    expect(normalizeAppName('  My   Shop \n')).toBe('My Shop');
  });

  it('🔒 never touches capitalisation or punctuation — this is the name they will SEE', () => {
    // Slugifying at this layer is how "My Shop" comes back as "my-shop" and the user concludes the
    // rename half-worked. The slug is a separate, derived value.
    expect(normalizeAppName("Asha's Café 2.0")).toBe("Asha's Café 2.0");
  });

  it('treats null/undefined as empty rather than throwing', () => {
    expect(normalizeAppName(null)).toBe('');
    expect(normalizeAppName(undefined)).toBe('');
  });
});

describe('validateAppName', () => {
  it('accepts an ordinary name and derives its GitHub-safe slug', () => {
    const v = validateAppName('  My Shop  ');
    expect(v.ok).toBe(true);
    expect(v.name).toBe('My Shop');
    expect(v.slug).toBe('my-shop');
  });

  it('rejects empty, too-short and too-long, each with its own reason', () => {
    expect(validateAppName('').error).toBe('empty');
    expect(validateAppName('   ').error).toBe('empty');
    expect(validateAppName('a').error).toBe('too-short');
    expect(validateAppName('x'.repeat(MAX_APP_NAME_LENGTH + 1)).error).toBe('too-long');
    expect(validateAppName('x'.repeat(MAX_APP_NAME_LENGTH)).ok).toBe(true); // the boundary is INSIDE
  });

  it('🔒 rejects a name that slugifies to NOTHING, with a reason of its own', () => {
    // "!!!" and "👍" are neither empty nor short, but a repo cannot be called "". Catching it here,
    // named, is what stops it becoming a baffling GitHub error several steps later.
    for (const junk of ['!!!', '👍👍', '---', '. . .']) {
      const v = validateAppName(junk);
      expect(v.ok, `${junk} must be rejected`).toBe(false);
      expect(v.error).toBe('no-usable-characters');
    }
  });

  it('every rejection has a human sentence, so the API and UI cannot word it differently', () => {
    for (const e of ['empty', 'too-short', 'too-long', 'no-usable-characters', 'duplicate'] as const) {
      expect(appNameErrorMessage(e).length).toBeGreaterThan(10);
    }
  });
});

describe('repoSlugFromAppName', () => {
  it('produces a GitHub-safe segment: alnum, dash, underscore only', () => {
    expect(repoSlugFromAppName("Asha's Café 2.0")).toMatch(/^[a-z0-9_-]+$/);
    expect(repoSlugFromAppName('My  Shop')).toBe('my-shop');
  });

  it('never leaves a leading/trailing dash or a doubled one', () => {
    expect(repoSlugFromAppName('  --My!!Shop--  ')).toBe('my-shop');
  });

  it('stays inside GitHub\'s repo-name limit', () => {
    expect(repoSlugFromAppName('x'.repeat(500)).length).toBeLessThanOrEqual(90);
  });
});

describe('effectiveAppName — the ONE resolver behind "har jagah wahi name"', () => {
  it('the user\'s chosen name beats the auto-derived title', () => {
    expect(effectiveAppName({ id: 'a', appName: 'My Shop', title: 'build me a shop app' })).toBe('My Shop');
  });

  it('falls back to the title when nothing was chosen — an un-renamed app is unaffected', () => {
    expect(effectiveAppName({ id: 'a', title: 'Watch store landing page' })).toBe('Watch store landing page');
  });

  it('🔒 a blank/whitespace appName does NOT win — it would blank the name everywhere', () => {
    expect(effectiveAppName({ id: 'a', appName: '   ', title: 'Real title' })).toBe('Real title');
  });

  it('never returns an empty string, whatever it is handed', () => {
    expect(effectiveAppName({ id: 'a' })).toBe('Untitled app');
    expect(effectiveAppName(null)).toBe('Untitled app');
  });
});

describe('findDuplicate — "duplicate not allowed"', () => {
  const apps = [
    { id: '1', title: 'My Shop' },
    { id: '2', appName: 'Bakery', title: 'build a bakery' },
    { id: '3', title: 'Something else' },
  ];

  it('finds a clash regardless of case and spacing', () => {
    expect(findDuplicate('my shop', apps, 'other')?.id).toBe('1');
    expect(findDuplicate('  BAKERY ', apps, 'other')?.id).toBe('2');
  });

  it('🔒 an app never clashes with ITSELF — renaming "My Shop" to "My Shop " must not 409', () => {
    expect(findDuplicate('My Shop', apps, '1')).toBeNull();
  });

  it('compares the EFFECTIVE name, so a renamed app is checked by what it is now called', () => {
    // App 2's derived title is "build a bakery"; only its chosen name "Bakery" should collide.
    expect(findDuplicate('build a bakery', apps, 'other')).toBeNull();
    expect(findDuplicate('Bakery', apps, 'other')?.id).toBe('2');
  });

  it('a free name returns null, and an empty query never matches anything', () => {
    expect(findDuplicate('Totally New', apps, 'other')).toBeNull();
    expect(findDuplicate('   ', apps, 'other')).toBeNull();
  });
});

// ---------- the wiring that makes the name real, and the build safe ----------

const route = read('src/server/routes/agentv3.ts');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const store = read('src/server/AgentV3/ConversationStore.ts');

describe('🔒 the build cannot be disturbed by a rename — a property of the data, not a promise', () => {
  it('the repo name is PERSISTED, so a build pushes to a stored fact', () => {
    expect(store).toContain('repoName?: string');
    expect(route).toContain('if (idRec.repoName) pinnedRepoName = idRec.repoName;');
    expect(route).toContain('const repoName = pinnedRepoName || repoNameForProject(');
  });

  it('🔒 the derivation NEVER reads the user-changeable name — that is what prevents an orphan', () => {
    // THE BUG THIS FORBIDS: ensureRepo(name) creates whatever name it is handed. Feed it a value the
    // user can change and the next build makes a NEW EMPTY repo, stranding the real app in the old
    // one. `title` is written once at record creation; `appName` changes on every rename.
    const at = route.indexOf('let pinnedRepoName');
    const block = route.slice(at, at + 900);
    expect(block).toContain('if (idRec.title) readableAppName = idRec.title;');
    expect(block).not.toContain('readableAppName = idRec.appName');
  });

  it('the rename endpoint writes the display name BEFORE it ever touches GitHub', () => {
    const at = route.indexOf("app.post('/api/agentv3/conversations/:id/name'");
    expect(at).toBeGreaterThan(-1);
    const handler = route.slice(at, route.indexOf('app.get(', at) > -1 ? route.indexOf('app.get(', at) : at + 6000);
    const displayWrite = handler.indexOf('appName: validated.name');
    const githubCall = handler.indexOf('renameRepo(');
    expect(displayWrite).toBeGreaterThan(-1);
    expect(githubCall).toBeGreaterThan(displayWrite); // order is the guarantee
  });

  it('🔒 the GitHub rename can never throw into the request', () => {
    // A throw here would turn a cosmetic outcome into a failed rename for a user whose name WAS saved.
    for (const client of ['src/server/AgentV3/UserGitHubClient.ts', 'src/server/AgentV3/GitHubAppClient.ts']) {
      const src = read(client);
      const at = src.indexOf('async renameRepo(');
      expect(at, `${client} must have renameRepo`).toBeGreaterThan(-1);
      const body = src.slice(at, at + 1200);
      expect(body, `${client} renameRepo must swallow`).toContain('catch {');
      expect(body).toContain('return { ok: false, status: 0, name: from };');
    }
  });

  it('a repo name is pinned ONLY on an outcome that is actually true', () => {
    const at = route.indexOf('// ---- The repo half.');
    const block = route.slice(at, at + 2200);
    // Confirmed move → persist what GitHub reported. Nothing there → pin the chosen name so the repo
    // is born with it. Name taken (422) → pin NOTHING, so the app keeps the repo it already has.
    expect(block).toContain('repoName: out.name');
    expect(block).toContain("repoNote = 'will-use-on-first-save'");
    expect(block).toContain("repoNote = out.status === 422 ? 'repo-name-taken' : 'repo-rename-failed'");
  });
});

describe('the name reaches every surface', () => {
  it('the history list serves the EFFECTIVE name as its title', () => {
    // Serving it as `title` means every existing reader shows the chosen name with no change of its
    // own — the surest way to get "everywhere" right is to leave nothing to update.
    expect(route).toContain('id: c.id, title: effectiveAppName(c),');
  });

  it('duplicates are refused with 409 before anything is written', () => {
    const at = route.indexOf("app.post('/api/agentv3/conversations/:id/name'");
    const handler = route.slice(at, at + 4000);
    expect(handler).toContain('findDuplicate(validated.name, mine, rec.id)');
    expect(handler).toContain("res.status(409)");
  });
});

describe('the chat name card + popup', () => {
  it('there is a dedicated name message with an Edit button', () => {
    expect(panel).toContain('App name');
    expect(panel).toContain("setNameDraft(appName); setNameError(null); setNameModalOpen(true);");
  });

  it('🔒 renaming stays available WHILE a build runs — that is the whole "dono smooth" ask', () => {
    const at = panel.indexOf('{nameModalOpen && (');
    expect(at).toBeGreaterThan(-1);
    const modal = panel.slice(at, at + 3000);
    // The Save button may only ever be disabled by the save itself or an empty box — never by `running`.
    expect(modal).toContain('disabled={nameSaving || !nameDraft.trim()}');
    expect(modal).not.toMatch(/disabled=\{[^}]*\brunning\b/);
  });

  it('the card is hidden until the server has told us a real name', () => {
    // A card showing a guessed name is worse than no card.
    expect(panel).toContain('{appName && (');
    expect(panel).toContain("const [appName, setAppName] = useState<string | null>(null);");
  });

  it('a failed save shows the server\'s own reason, never a generic shrug', () => {
    expect(panel).toContain("setNameError(data?.error || 'Could not save the name. Try again.');");
  });
});
