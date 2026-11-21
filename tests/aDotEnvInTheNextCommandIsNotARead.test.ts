// failedbr #1838 (2026-11-20): a chained read was refused as "reads a .env secrets file" because the rule's
// `[^\n|]*` crossed `;` and `&&` — a reader in one command and `.env` in the next was treated as one read.
import { describe, expect, it } from 'vitest';
import { classifyCommandRisk } from '../src/server/AgentV3/CommandGovernance';

const SECRETS = /reads a \.env secrets file/;
const reasons = (c: string) => classifyCommandRisk(c).reasons.join(' ');

describe('.env in the NEXT command is not a secrets read (failedbr #1838)', () => {
  it.each([
    'sed -n 200,400p src/styles/start.css; echo ---; cat src/lib/bestLap.ts; ls -la .env',
    'cat src/a.ts; test -f .env && echo has-env',
    'cat src/x.ts && wc -l .env',
    'sed -n 1,80p src/App.tsx; echo ---; cat src/vite-env.d.ts',
  ])('not refused: %s', (c) => {
    expect(reasons(c)).not.toMatch(SECRETS);
  });

  it.each([
    'cat .env', 'grep -c KEY .env', 'cat a.ts;cat .env', 'cat a.ts && cat .env.local', 'cat 2>&1 .env',
    'head -n5 &>/dev/null .env.local', 'cat .env 2>&1 | head', 'awk -F= \'{print $1}\' .env',
  ])('a real read is still refused: %s', (c) => {
    expect(reasons(c)).toMatch(SECRETS);
  });

  it('a template is still readable', () => {
    expect(reasons('cat .env.example')).not.toMatch(SECRETS);
  });
});

describe('every verb-and-argument rule reads ONE command (siblings of #1838)', () => {
  it.each([
    ['git push origin main && rm -f /tmp/x', /force-push/],
    ['cat src/a.ts; ls ~/.ssh/', /private keys/],
    ['npm install react && ls -g', /global npm install/],
    ['kill 123; echo -9', /force-kills/],
  ])('not flagged: %s', (c, re) => {
    expect(reasons(c)).not.toMatch(re);
  });

  it.each([
    ['git push --force origin main', /force-push/],
    ['git push origin main -f', /force-push/],
    ['cat ~/.ssh/id_rsa', /private keys/],
    ['npm install -g serve', /global npm install/],
    ['kill -9 123', /force-kills/],
    ['dd if=img of=/dev/sda', /disk device/],
    ['echo x | tee /etc/hosts', /system directory/],
  ])('still flagged: %s', (c, re) => {
    expect(reasons(c)).toMatch(re);
  });
});
