// The admin's read-only view of one user (admin 2026-09-11: "user ki jitni information hamare pas hai
// woh admin sab read only dekh sake").
//
// These tests read the ROUTE SOURCE rather than calling the handler, for the same reason the other
// route-guard tests in this repo do: the thing worth locking is a rule about what the handler may
// reach for, and that rule is broken by ADDING a line, which no amount of exercising the current
// behaviour would catch.
//
// ⚠️ Comment lines are stripped before every absence assertion. A file's own explanation necessarily
// QUOTES the thing it is refusing to do — this repo has been bitten by that three times.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const reportsSrc = readFileSync(join(__dirname, 'reports.ts'), 'utf8');
const adminSrc = readFileSync(join(__dirname, 'admin.ts'), 'utf8');

/** The account handler only — anchored on the route registration, never on prose that names it. */
function accountHandler(): string {
  const start = reportsSrc.indexOf("app.get('/api/admin/users/:uid/account'");
  expect(start).toBeGreaterThan(-1);
  const end = reportsSrc.indexOf("app.post('/api/admin/reports/:id/status'", start);
  expect(end).toBeGreaterThan(start);
  return reportsSrc.slice(start, end);
}

/** The users-list handler only. */
function usersListHandler(): string {
  const start = adminSrc.indexOf("app.get('/api/admin/users',");
  expect(start).toBeGreaterThan(-1);
  const end = adminSrc.indexOf("app.post('/api/admin/users/:userId/tokens'", start);
  expect(end).toBeGreaterThan(start);
  return adminSrc.slice(start, end);
}

/** Drop comments, so an explanation of a rule cannot be mistaken for a breach of it. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('the account sheet reads counts and times — never what the user wrote', () => {
  // The published Privacy Policy is the reason this is a hard line and not a preference: §3 limits
  // team access to "what is needed to run the service, fix a defect you reported, or meet a legal
  // duty", and §5 promises the Doctor AI surface is used only for the user's own case history. A
  // browsable transcript viewer on an admin screen would contradict both — and the decisions this
  // sheet ends in (suspend, refund, believe a complaint) turn on volume and recency, not on content.
  const handler = () => code(accountHandler());

  for (const collection of ['chat_sessions', 'pro_memories', 'engineer_memory', 'user_brain_v3']) {
    it(`never opens \`${collection}\``, () => {
      expect(handler()).not.toContain(collection);
    });
  }

  it('never reads a transcript field off any document', () => {
    const src = handler();
    for (const field of ['.messages', 'messages', 'transcript', 'patientSnapshot']) {
      expect(src).not.toContain(field);
    }
  });

  it('says on the screen what it withholds — an absent section must not read as "this user did nothing"', () => {
    expect(accountHandler()).toContain('withheld:');
  });
});

describe('the account sheet is logged, because the Privacy Policy says team access is logged', () => {
  it('writes an audit line naming the user whose account was opened', () => {
    expect(code(accountHandler())).toContain("audit('ADMIN_USER_ACCOUNT_VIEW'");
  });
});

describe('the account sheet answers the questions the admin actually asked', () => {
  const handler = () => accountHandler();

  it('biodata — the user’s own profile row', () => {
    expect(handler()).toContain("collection('user_profiles')");
    expect(handler()).toContain('profileView(');
  });

  it('activity — how much AI they use and when they were last here', () => {
    expect(handler()).toContain("collection('ai_usage_logs')");
    expect(handler()).toContain('summariseAiActivity(');
  });

  it('joined + last active, from the only source that records them properly', () => {
    expect(handler()).toContain('resolveJoinedAt(');
    expect(handler()).toContain('resolveLastActiveAt(');
  });

  it('what they are entitled to — hosting plan and Professionals pass', () => {
    expect(handler()).toContain('activeHostingTier(');
    expect(handler()).toContain('professionalPassStore.getStatus(');
  });

  it('devices are counted, and the stored hashes are not re-published', () => {
    const src = code(accountHandler());
    expect(src).toContain('summariseDevices(');
    expect(src).not.toContain('uaHash');
    expect(src).not.toContain('ipHash');
  });
});

describe('the users list carries the two dates the admin asked for', () => {
  it('returns joinedAt and lastActiveAt, each with where it came from', () => {
    const src = usersListHandler();
    expect(src).toContain('joinedAt:');
    expect(src).toContain('joinedAtSource:');
    expect(src).toContain('lastActiveAt:');
    expect(src).toContain('lastActiveAtSource:');
  });

  it('resolves them in ONE batched Auth call rather than a read per user', () => {
    const src = code(usersListHandler());
    expect(src).toContain('fetchAuthMetadata(');
    // A per-user lookup on a list the admin refreshes is a real bill and a slow page.
    expect(src).not.toContain('getUser(');
  });

  it('keeps the fields the panel already showed — this is an addition, not a replacement', () => {
    const src = usersListHandler();
    for (const field of ['tokenBalance:', 'remainingBalance:', 'hasPro:', 'banned:', 'createdAt:']) {
      expect(src).toContain(field);
    }
  });
});
