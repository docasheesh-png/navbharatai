// A DEFECT THE USER IS SHOWN HAS A BUTTON (Q-381 batch three, 2026-10-11). Eighteen findings about the user's
// app reached their build-health card as warnings with nothing to press: code that does not compile, imports
// that point at nothing, a starter page where the app should be, made-up data shown as real, a secret printed
// to the logs, payments that cannot be confirmed, features asked for and not on the screen. THE CLASS: a real
// app defect told to the user with no next move. Fourteen get a one-tap fix; four roll-ups that restate one of
// them ("after one pass the files STILL do not parse") are offered through it, so there is one button, never two
// and never none. Nothing here moves a bill: every one stays an app finding at the severity it had.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FINDING_SUGGESTIONS, APP_FINDINGS_WITHOUT_AN_OFFER, OFFERED_THROUGH, buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { PROCESS_ONLY_CODES, HEAL_RESOLVES, isAppFinding, BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const OFFERED = [
  'STARTER_STILL_SHOWING', 'SYNTAX_ERROR_DETECTED', 'MISSING_FILES_DETECTED', 'MISSING_EXPORT_DETECTED',
  'COMPLIANCE_LOG_LEAK_FOUND', 'DB_COUPLED_BOOT', 'SERVERLESS_PAYMENT_NOT_SET_UP', 'SIMULATED_DATA_SHIPPED',
  'SIMULATED_RESULT_SHIPPED', 'FEATURE_COVERAGE', 'INTEGRITY_ORPHAN_STYLESHEET', 'INTEGRITY_FOCUS_CONFLICT',
  'INTEGRITY_DUPLICATE_ENTRY', 'INTEGRITY_DUPLICATE_MODULE',
];
const ROLL_UPS: Record<string, string> = {
  OUTCOME_SYNTAX_ERROR: 'SYNTAX_ERROR_DETECTED',
  OUTCOME_MISSING_FILES: 'MISSING_FILES_DETECTED',
  OUTCOME_MISSING_EXPORT: 'MISSING_EXPORT_DETECTED',
  BOOT_KILLING_ENV_GUARD_UNRESOLVED: 'BOOT_KILLING_ENV_GUARD',
  // batch four
  PLATFORM_PREVIEW_NOT_UP: 'PREVIEW_NEVER_CAME_UP',
  REVIEW_CRITICAL_UNVERIFIED: 'REVIEW_RECHECK_CRITICALS_REMAIN',
  OUTCOME_REVIEW_CRITICAL: 'REVIEW_RECHECK_CRITICALS_REMAIN',
  // batch six
  OUTCOME_PREVIEW_COMPILE: 'PREVIEW_COMPILE_DIVERGENCE',
  REVIEWER_AUTOFIX_INCOMPLETE: 'REVIEW_RECHECK_CRITICALS_REMAIN',
};
const BATCH_FOUR = ['DB_SCHEMA_MISSING', 'FRAMEWORK_SOURCE_MISMATCH'];
const idOf = (code: string) => `found-${code.toLowerCase().replace(/_/g, '-')}`;
const baseline: string[] = JSON.parse(readFileSync('tests/fixtures/findingClassificationBaseline.json', 'utf8'));

describe('the fourteen offers', () => {
  for (const code of OFFERED) {
    it(`${code} has a one-tap fix written for the person who pressed the button`, () => {
      const out = buildFindingSuggestions([{ code, autoResolved: false }]);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe(idOf(code));
      expect(out[0].kind).toBe('domain');
      expect(out[0].title.length).toBeGreaterThan(8);
      expect(out[0].prompt.length).toBeGreaterThan(80);
    });
  }

  it('a finding the build already answered offers nothing', () => {
    for (const code of OFFERED) expect(buildFindingSuggestions([{ code, autoResolved: true }])).toEqual([]);
  });

  it('the fixes that need the exact list are handed it — and only those', () => {
    const withEvidence = FINDING_SUGGESTIONS.filter((s) => OFFERED.includes(s.code) && s.withEvidence).map((s) => s.code).sort();
    expect(withEvidence).toEqual(['FEATURE_COVERAGE', 'MISSING_EXPORT_DETECTED', 'MISSING_FILES_DETECTED', 'SYNTAX_ERROR_DETECTED']);
    const [out] = buildFindingSuggestions([{ code: 'FEATURE_COVERAGE', message: 'Feature coverage: 1 requested feature(s) have NO visible control in the running app — Search. Present: Add.' }]);
    expect(out.prompt).toContain('What was measured: Feature coverage: 1 requested feature(s) have NO visible control in the running app — Search.');
  });

  it('nothing a user cannot do is promised: payment checking is never faked while it is not set up', () => {
    const p = FINDING_SUGGESTIONS.find((s) => s.code === 'SERVERLESS_PAYMENT_NOT_SET_UP')!.prompt;
    expect(p).toContain('never mark an order as paid');
    const d = FINDING_SUGGESTIONS.find((s) => s.code === 'SIMULATED_DATA_SHIPPED')!.prompt;
    expect(d).toContain('never present invented people as real');
  });
});

describe('🔁 a roll-up is offered through the finding it restates', () => {
  it('the map is exactly these, and each target really has an offer', () => {
    expect({ ...OFFERED_THROUGH }).toEqual(ROLL_UPS);
    for (const source of Object.values(OFFERED_THROUGH)) expect(FINDING_SUGGESTIONS.some((s) => s.code === source)).toBe(true);
  });

  it('a roll-up is in no other home — not an offer of its own, not ours, not declared button-less', () => {
    for (const rollUp of Object.keys(OFFERED_THROUGH)) {
      expect(FINDING_SUGGESTIONS.some((s) => s.code === rollUp)).toBe(false);
      expect(PROCESS_ONLY_CODES.has(rollUp)).toBe(false);
      expect(APP_FINDINGS_WITHOUT_AN_OFFER.has(rollUp)).toBe(false);
    }
  });

  for (const [rollUp, source] of Object.entries(ROLL_UPS)) {
    // Alone is real: the final syntax re-check records OUTCOME_SYNTAX_ERROR when a late repair broke a file the
    // first check passed, so no SYNTAX_ERROR_DETECTED is open beside it.
    it(`${rollUp} alone still gets ${source}'s button`, () => {
      const out = buildFindingSuggestions([{ code: rollUp, autoResolved: false }]);
      expect(out.map((s) => s.id)).toEqual([idOf(source)]);
    });

    it(`${rollUp} beside ${source} is ONE button, not two`, () => {
      const out = buildFindingSuggestions([{ code: source }, { code: rollUp }], 10);
      expect(out.map((s) => s.id)).toEqual([idOf(source)]);
    });
  }

  it('the roll-up\'s message — the later, truer one — is the evidence the fix is handed', () => {
    const [out] = buildFindingSuggestions([
      { code: 'SYNTAX_ERROR_DETECTED', message: '3 generated file(s) do not parse (before the repair)' },
      { code: 'OUTCOME_SYNTAX_ERROR', message: 'After one repair pass, 1 file(s) STILL do not parse' },
    ]);
    expect(out.prompt).toContain('What was measured: After one repair pass, 1 file(s) STILL do not parse');
    expect(out.prompt).not.toContain('before the repair');
  });
});

describe('🔒 nothing moves a bill, and no offer outlives its problem', () => {
  it('every one is still a finding about the app, at the phase it is recorded in', () => {
    const phaseOf: Record<string, string> = {
      STARTER_STILL_SHOWING: 'preview', DB_COUPLED_BOOT: 'build', SERVERLESS_PAYMENT_NOT_SET_UP: 'tool',
      PLATFORM_PREVIEW_NOT_UP: 'preview', DB_SCHEMA_MISSING: 'preview', FRAMEWORK_SOURCE_MISMATCH: 'plan',
      SIMULATED_DATA_SHIPPED: 'readiness', SIMULATED_RESULT_SHIPPED: 'readiness', FEATURE_COVERAGE: 'readiness',
    };
    for (const code of [...OFFERED, ...BATCH_FOUR, ...Object.keys(ROLL_UPS)]) expect(isAppFinding({ phase: phaseOf[code] ?? 'build', code })).toBe(true);
  });

  it('the compile and integrity offers are answered by the heal that fixes them', () => {
    expect(HEAL_RESOLVES.SYNTAX_HEALED).toContain('SYNTAX_ERROR_DETECTED');
    expect(HEAL_RESOLVES.MISSING_FILES_HEALED).toContain('MISSING_FILES_DETECTED');
    expect(HEAL_RESOLVES.MISSING_EXPORT_HEALED).toContain('MISSING_EXPORT_DETECTED');
    for (const c of ['INTEGRITY_FOCUS_CONFLICT', 'INTEGRITY_ORPHAN_STYLESHEET', 'INTEGRITY_DUPLICATE_ENTRY', 'INTEGRITY_DUPLICATE_MODULE']) {
      expect(HEAL_RESOLVES.INTEGRITY_HEALED).toContain(c);
    }
  });

  it('the starter finding is answered when a later look sees the app itself render', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("if (!shown && starterNoted && verdict.rendered) { starterNoted = false; try { buildDiag.resolveOnRecheck('STARTER_STILL_SHOWING'); }");
    // …and once answered, the button is gone
    const d = new BuildDiagnostics();
    d.record({ phase: 'preview', severity: 'warning', code: 'STARTER_STILL_SHOWING', message: 'starter', autoResolved: false });
    expect(buildFindingSuggestions(d.report().issues)).toHaveLength(1);
    d.resolveOnRecheck('STARTER_STILL_SHOWING');
    expect(buildFindingSuggestions(d.report().issues)).toEqual([]);
  });
});

describe('the ranking', () => {
  it('an app that never ran still comes first; a starter page and code that does not compile outrank the look', () => {
    const out = buildFindingSuggestions([
      { code: 'DESIGN_CONSISTENCY' }, { code: 'SYNTAX_ERROR_DETECTED' }, { code: 'STARTER_STILL_SHOWING' }, { code: 'PREVIEW_NEVER_CAME_UP' },
    ], 4);
    expect(out.map((s) => s.id)).toEqual([idOf('PREVIEW_NEVER_CAME_UP'), idOf('STARTER_STILL_SHOWING'), idOf('SYNTAX_ERROR_DETECTED'), idOf('DESIGN_CONSISTENCY')]);
  });

  it('a secret in the logs outranks the look and the styling', () => {
    const out = buildFindingSuggestions([{ code: 'INTEGRITY_ORPHAN_STYLESHEET' }, { code: 'DESIGN_CONSISTENCY' }, { code: 'COMPLIANCE_LOG_LEAK_FOUND' }]);
    expect(out[0].id).toBe(idOf('COMPLIANCE_LOG_LEAK_FOUND'));
  });
});

describe('the backlog', () => {
  it('lost all eighteen: 37 → 19', () => {
    for (const code of [...OFFERED, ...Object.keys(ROLL_UPS)]) expect(baseline).not.toContain(code);
    expect(baseline.length).toBeLessThanOrEqual(19);
  });

  it('batch four: the two that waited for a re-check got one, and three more restatements are offered — 19 → 14', () => {
    for (const code of [...BATCH_FOUR, 'PLATFORM_PREVIEW_NOT_UP', 'REVIEW_CRITICAL_UNVERIFIED', 'OUTCOME_REVIEW_CRITICAL']) expect(baseline).not.toContain(code);
    expect(baseline.length).toBeLessThanOrEqual(14);
  });
});

describe('Q-381 batch four: a button only once its finding can be answered', () => {
  for (const code of BATCH_FOUR) {
    it(`${code} has a one-tap fix`, () => {
      const out = buildFindingSuggestions([{ code, autoResolved: false }]);
      expect(out.map((o) => o.id)).toEqual([idOf(code)]);
      expect(out[0].prompt.length).toBeGreaterThan(80);
    });
  }

  it('🔒 a migration that runs clean on its second attempt answers the first failure AND the missing tables', () => {
    expect(HEAL_RESOLVES.IMPORT_DB_MIGRATIONS_APPLIED).toEqual(['IMPORT_DB_MIGRATIONS_FAILED', 'DB_SCHEMA_MISSING']);
    const d = new BuildDiagnostics();
    d.record({ phase: 'preview', severity: 'warning', code: 'IMPORT_DB_MIGRATIONS_FAILED', message: 'exit 217', autoResolved: false });
    d.record({ phase: 'preview', severity: 'warning', code: 'DB_SCHEMA_MISSING', message: 'relation "profiles" does not exist', autoResolved: false });
    expect(buildFindingSuggestions(d.report().issues, 10).map((o) => o.id).sort()).toEqual([idOf('DB_SCHEMA_MISSING'), idOf('IMPORT_DB_MIGRATIONS_FAILED')].sort());
    d.record({ phase: 'preview', severity: 'info', code: 'IMPORT_DB_MIGRATIONS_APPLIED', message: 'ran clean on a second attempt', autoResolved: true });
    expect(buildFindingSuggestions(d.report().issues, 10)).toEqual([]);
  });

  it('…but a clean migration BEFORE the boot does not answer a table the boot then proves missing', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'preview', severity: 'info', code: 'IMPORT_DB_MIGRATIONS_APPLIED', message: 'ran clean', autoResolved: true });
    d.record({ phase: 'preview', severity: 'warning', code: 'DB_SCHEMA_MISSING', message: 'relation "orders" does not exist', autoResolved: false });
    expect(buildFindingSuggestions(d.report().issues).map((o) => o.id)).toEqual([idOf('DB_SCHEMA_MISSING')]);
  });

  it('🔒 the plan-time framework note is answered when the delivered project is coherent — never on an import turn', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("if (!isImportTurn && typeof integrityFiles['package.json'] === 'string' && checkFrameworkCoherence(integrityFiles).ok) {\n            buildDiag.resolveOnRecheck('FRAMEWORK_SOURCE_MISMATCH');");
  });

  it('the review button no longer claims a second look ran — it now also speaks for the settle lines', () => {
    const r = FINDING_SUGGESTIONS.find((s) => s.code === 'REVIEW_RECHECK_CRITICALS_REMAIN')!;
    expect(r.prompt).toContain('not confirmed fixed');
    expect(r.detail).not.toMatch(/checked again/);
    const [out] = buildFindingSuggestions([{ code: 'REVIEW_CRITICAL_UNVERIFIED', message: '1 reviewer [CRITICAL] finding(s) were not verifiably fixed: the total is never saved' }]);
    expect(out.id).toBe(idOf('REVIEW_RECHECK_CRITICALS_REMAIN'));
    expect(out.prompt).toContain('the total is never saved');
  });
});

describe('Q-381 batch five: a repaired app does not keep "may still be present"', () => {
  // The reviewer auto-fix retries once after a thrown first attempt. That attempt recorded
  // REVIEWER_AUTOFIX_INCOMPLETE; a second attempt that completed recorded "Auto-fixed" — and left the first
  // line open, so the user's build-health card warned that the findings "may still be present" in an app
  // whose repair had just completed. A completed pass now answers it.
  it('🔒 the route answers the earlier attempt\'s line when a pass completes', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = route.indexOf("buildDiag.record({ phase: 'build', ...reviewerAutofixOutcome(fix.ok, label) });");
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 900)).toContain("if (fix.ok) { try { buildDiag.resolveOnRecheck('REVIEWER_AUTOFIX_INCOMPLETE'); }");
  });

  it('once answered, it is neither a problem in the report nor open', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'build', severity: 'warning', code: 'REVIEWER_AUTOFIX_INCOMPLETE', message: 'Reviewer auto-fix did NOT complete — 2 critical issue(s) may still be present in the app.', autoResolved: false });
    d.record({ phase: 'build', severity: 'info', code: 'REVIEWER_AUTOFIX', message: 'Auto-fixed 2 critical issue(s) from the reviewer', autoResolved: true });
    expect(d.resolveOnRecheck('REVIEWER_AUTOFIX_INCOMPLETE')).toBe(1);
    expect(d.report().issues.filter((i) => i.code === 'REVIEWER_AUTOFIX_INCOMPLETE' && !i.autoResolved)).toEqual([]);
  });
});

describe('Q-381 batch five: payment checking that later worked does not keep its button', () => {
  it('🔒 a setup that succeeds answers an earlier failure for the same table — and only that table', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('could not be set up in the user\'s Supabase project for table "${table}" (${done.failure}).');
    expect(route).toContain("buildDiag.resolveOnRecheck('SERVERLESS_PAYMENT_NOT_SET_UP', { messageIncludes: `for table \"${table}\"` });");
    const d = new BuildDiagnostics();
    d.record({ phase: 'tool', severity: 'warning', code: 'SERVERLESS_PAYMENT_NOT_SET_UP', message: 'Payment verification could not be set up in the user\'s Supabase project for table "orders" (api-error).', autoResolved: false });
    d.record({ phase: 'tool', severity: 'warning', code: 'SERVERLESS_PAYMENT_NOT_SET_UP', message: 'Payment verification could not be set up in the user\'s Supabase project for table "bookings" (api-error).', autoResolved: false });
    expect(d.resolveOnRecheck('SERVERLESS_PAYMENT_NOT_SET_UP', { messageIncludes: 'for table "orders"' })).toBe(1);
    const open = d.report().issues.filter((i) => i.code === 'SERVERLESS_PAYMENT_NOT_SET_UP' && !i.autoResolved);
    expect(open.map((i) => i.message)).toEqual(['Payment verification could not be set up in the user\'s Supabase project for table "bookings" (api-error).']);
  });
});

describe('Q-381 batch six: the last fourteen — and the backlog is empty', () => {
  const OFFERED_SIX = [
    'PREVIEW_COMPILE_DIVERGENCE', 'OUTCOME_PREVIEW_FAILED', 'LAST_CHANCE_PROOF', 'PREVIEW_ERROR', 'BUILD_TIMEOUT',
    'DB_UNREACHABLE', 'BACKSTOP_GATE_FAIL', 'ARCHITECTURE_INVARIANT_VIOLATED',
  ];
  const DECLARED_SIX = ['OUTCOME_RELEASE_GATE_RED', 'STUCK_TOOL', 'PLATFORM_SOURCE_WORKSPACE'];
  const ERROR_CODES = [
    'BUILD_TIMEOUT', 'DB_UNREACHABLE', 'PLATFORM_SOURCE_WORKSPACE', 'PREVIEW_COMPILE_DIVERGENCE', 'PREVIEW_ERROR', 'STUCK_TOOL',
    'OUTCOME_PREVIEW_COMPILE', 'OUTCOME_PREVIEW_FAILED', 'OUTCOME_RELEASE_GATE_RED',
  ];

  for (const code of OFFERED_SIX) {
    it(`${code} has a one-tap fix`, () => {
      const out = buildFindingSuggestions([{ code, autoResolved: false }]);
      expect(out.map((o) => o.id)).toEqual([idOf(code)]);
      expect(out[0].prompt.length).toBeGreaterThan(80);
    });
  }

  it('three are declared: counted against the build, nothing to press', () => {
    for (const code of DECLARED_SIX) {
      expect(APP_FINDINGS_WITHOUT_AN_OFFER.has(code)).toBe(true);
      expect(buildFindingSuggestions([{ code }])).toEqual([]);
    }
  });

  it('🔒 NO BILL MOVES: not one ERROR code became "ours" — each still counts against the build', () => {
    for (const code of ERROR_CODES) {
      expect(PROCESS_ONLY_CODES.has(code), code).toBe(false);
      expect(isAppFinding({ phase: 'build', code }), code).toBe(true);
    }
  });

  it('the one that became ours is a WARNING, by its own recording site\'s words', () => {
    expect(PROCESS_ONLY_CODES.has('PREVIEW_SERVER_DOWN')).toBe(true);
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const records = [...route.matchAll(/severity: '(\w+)', code: 'PREVIEW_SERVER_DOWN'/g)].map((m) => m[1]);
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(new Set(records)).toEqual(new Set(['warning']));
    expect(route).toContain("The app's code was never the problem here");
  });

  it('🔒 an architecture rule a later pass restored is answered before the gate counts it', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const recheck = route.indexOf("if (!still.has(key)) buildDiag.resolveOnRecheck('ARCHITECTURE_INVARIANT_VIOLATED', { messageIncludes: key });");
    expect(recheck).toBeGreaterThan(-1);
    expect(route.indexOf('let gate = releaseGate(gateEvidence, gateFindings(), gateQuality);')).toBeGreaterThan(recheck);
    expect(route).toContain("const keyOf = (v: { file: string; detail: string }) => `${v.file} breaks how this app is built — ${v.detail}`;");
    // the key is a prefix of the recorded message, so messageIncludes finds exactly that finding
    expect(route).toContain('...obs(`${v.file} breaks how this app is built — ${v.detail}. ${v.rule}`)');
  });

  it('the review evidence that wins is the line that lists the findings', () => {
    const [out] = buildFindingSuggestions([
      { code: 'REVIEWER_AUTOFIX_INCOMPLETE', message: 'Reviewer auto-fix did NOT complete — 1 critical issue(s) may still be present in the app.' },
      { code: 'REVIEW_CRITICAL_UNVERIFIED', message: '1 reviewer [CRITICAL] finding(s) were not verifiably fixed:\n- the cart total is never saved' },
    ]);
    expect(out.id).toBe(idOf('REVIEW_RECHECK_CRITICALS_REMAIN'));
    expect(out.prompt).toContain('the cart total is never saved');
  });

  it('🎯 THE BACKLOG IS EMPTY — every problem a user is shown has a home', () => {
    expect(baseline).toEqual([]);
  });
});
