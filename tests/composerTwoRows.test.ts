import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * ⚠️ "PLAN EK BAAR — SIRF 1ST BUILD ME — ACTIVELY WORKING DIKHTA HAI, BAAD ME NAHI" (admin 2026-08-25).
 *
 * `todos` and `agents` were set by their events and NEVER reset. So at the start of every build after
 * the first, the panel showed the PREVIOUS build's finished plan, complete with its green "✓ Done" —
 * and it stayed there until the new build's first `update_todo` arrived, which in a real report took
 * three and a half minutes. By then the user had read "Done" and stopped watching.
 *
 * The plan was never broken. It was showing the wrong build's.
 *
 * Worth noting what this did NOT need: the build prompt already says "Begin by calling update_todo",
 * and the live report confirms the model does. Changing the prompt would have been a fix aimed at a
 * cause that was not there.
 */
describe('a new build does not inherit the last build\'s plan', () => {
  const withPlan = agentV3Reducer(
    agentV3Reducer(initialAgentV3State(), { type: 'build_meta', buildId: 'build-1', promptHash: 'h1' } as never),
    { type: 'todo_updated', todos: [{ id: '1', title: 'Ship it', status: 'done' }] } as never,
  );

  it('holds the plan while the build that made it is current', () => {
    expect(withPlan.todos).toHaveLength(1);
  });

  it('clears it the moment a DIFFERENT buildId arrives', () => {
    const next = agentV3Reducer(withPlan, { type: 'build_meta', buildId: 'build-2', promptHash: 'h2' } as never);
    expect(next.todos).toEqual([]);
    expect(next.buildId).toBe('build-2');
  });

  it('clears the agent chips too — same staleness, same boundary', () => {
    const spawned = agentV3Reducer(withPlan, { type: 'agent_spawned', agent: 'frontend', task: 'x', ts: 1 } as never);
    expect(Object.keys(spawned.agents).length).toBeGreaterThan(0);
    const next = agentV3Reducer(spawned, { type: 'build_meta', buildId: 'build-2', promptHash: 'h2' } as never);
    expect(next.agents).toEqual({});
  });

  it('⚠️ does NOT clear when the SAME build re-announces itself', () => {
    // `build_meta` is re-sent on a resume or a reconnect. Wiping a RUNNING build's own live plan would
    // be a far worse bug than the one this fixes — the guard is on the id actually changing.
    const same = agentV3Reducer(withPlan, { type: 'build_meta', buildId: 'build-1', promptHash: 'h1' } as never);
    expect(same.todos).toHaveLength(1);
  });

  it('keeps everything that belongs to the SESSION, not the build', () => {
    // Messages, files, diffs and history are the conversation the user is still reading. Clearing
    // those would turn a staleness fix into data loss.
    const rich = agentV3Reducer(withPlan, { type: 'file_changed', change: { path: 'src/App.tsx', kind: 'create' } } as never);
    const next = agentV3Reducer(rich, { type: 'build_meta', buildId: 'build-2', promptHash: 'h2' } as never);
    expect(next.files).toEqual(rich.files);
    expect(next.narration).toEqual(rich.narration);
  });
});

/**
 * "MUJHE 2 LINE CHAHIYE BAS… IN DO KO MILA KAR EK ME KARO" — three strips sat between the transcript
 * and the input (plan · agent chips · Send/Search/Clear), which on a phone is most of the screen spent
 * on chrome.
 */
describe('the agent chips share the toolbar row instead of taking their own', () => {
  const panel = read('src/components/agentv3/AgentV3Panel.tsx');

  it('the chips are the toolbar\'s leftSlot', () => {
    expect(panel).toContain('leftSlot={!showTeamHq(running, powerLevel) && agents.length > 0 ?');
  });

  it('and no longer have a row of their own', () => {
    expect(panel).not.toContain('<div className="px-3 pt-2 flex gap-1.5 overflow-x-auto"');
  });

  it('the toolbar puts the left slot and the actions at opposite ends', () => {
    // The row was already justify-between — the merge needed no new layout, which is why it is safe.
    const bar = read('src/components/chat/ChatToolbar.tsx');
    expect(bar).toContain('<div className="flex items-center justify-between gap-2">');
    expect(bar).toContain('{leftSlot}');
  });

  it('TeamHqCard is deliberately NOT merged — it is a card, not a chip strip', () => {
    // Squeezing a roster, a clock and progress squares into a toolbar would destroy it rather than
    // move it.
    expect(panel).toContain('{showTeamHq(running, powerLevel) && (');
    expect(panel).toContain('<TeamHqCard agents={state.agents}');
  });

  it('many specialists cannot push Send off a phone', () => {
    expect(panel).toContain('overflow-x-auto overscroll-x-contain min-w-0');
  });
});

/** "PLAN KO… 3 SELECTER ME 'PLAN' ME BHI DIKHAO… JAB CHAHE DEKH SAKE, EXPAND KAR SAKE." */
describe('the plan is reachable from the mode selector', () => {
  const panel = read('src/components/agentv3/AgentV3Panel.tsx');

  it('the Plan entry carries the live count, or ✓ when finished', () => {
    expect(panel).toContain("{m === 'planner' && state.todos.length > 0 && (");
    expect(panel).toContain("{planComplete ? '\\u2713' : `${planDone}/${state.todos.length}`}");
  });

  it('and the plan itself expands inside the menu', () => {
    expect(panel).toContain('setMenuPlanOpen((v) => !v)');
    expect(panel).toContain('<TodoList todos={state.todos} hideHeader />');
  });

  it('bounded, so a long plan cannot grow the menu off the screen', () => {
    expect(panel).toContain('max-h-40 overflow-y-auto overscroll-contain');
  });

  it('its open state is SEPARATE from the strip above the transcript', () => {
    // Sharing one flag would mean opening the plan in one place silently changed the other — the kind
    // of coupling that makes a UI feel haunted.
    expect(panel).toContain('const [menuPlanOpen, setMenuPlanOpen] = useState(false);');
    expect(panel).toContain('const [planCollapsed, setPlanCollapsed]');
  });
});

/** The preview's own header was being CROPPED on a phone — Edit and the console were unreachable. */
describe('the preview toolbar can be swiped', () => {
  const prev = read('src/components/agentv3/PreviewSurface.tsx');

  it('every toolbar row scrolls horizontally', () => {
    expect(prev).toContain('overflow-x-auto overscroll-x-contain');
    // All three rows go through one constant — three copies is how they drift apart.
    expect(prev.split('className={TOOLBAR_ROW}').length - 1).toBe(3);
  });

  it('and the controls hold their width, or the scroll never engages', () => {
    // The failure mode that makes this look like it did nothing: flexbox squashes the children back
    // to fit and there is nothing to scroll.
    expect(prev).toContain('flex items-center gap-1 shrink-0');            // mode switcher
    expect(prev).toContain('border border-zinc-700 p-0.5 shrink-0');       // viewport switcher
    expect(prev).toContain('shrink-0 relative flex items-center gap-1');   // console
  });

  it('the middle label may shrink to nothing rather than force the row to fit', () => {
    expect(prev).toContain('<span className="truncate flex-1 min-w-0">{effectiveUrl}</span>');
  });
});
