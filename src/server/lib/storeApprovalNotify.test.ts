import { describe, it, expect } from 'vitest';
import {
  approvalBellMessage, approvalEmailSubject, approvalEmailBody, notifyStoreApproval,
  type NotifyApprovalDeps,
} from './storeApprovalNotify';

describe('approvalBellMessage / approvalEmailSubject / approvalEmailBody — pure text', () => {
  it('names the store correctly per kind, and carries the app name', () => {
    expect(approvalBellMessage('XStudy Help', 'apk')).toContain('Nav App Store');
    expect(approvalBellMessage('XStudy Help', 'apk')).toContain('XStudy Help');
    expect(approvalBellMessage('PaisaTrack', 'web')).toContain('App Mart');
    expect(approvalBellMessage('PaisaTrack', 'web')).toContain('PaisaTrack');
  });

  it('the email subject and body both carry the app name', () => {
    expect(approvalEmailSubject('PaisaTrack')).toContain('PaisaTrack');
    expect(approvalEmailBody('PaisaTrack', 'web')).toContain('PaisaTrack');
    expect(approvalEmailBody('PaisaTrack', 'apk')).toContain('installed');
    expect(approvalEmailBody('PaisaTrack', 'web')).toContain('browser');
  });

  it('never mentions an underlying AI vendor — the White-Label Law applies to every user-facing surface', () => {
    for (const text of [approvalBellMessage('App', 'apk'), approvalEmailBody('App', 'web')]) {
      expect(text).not.toMatch(/claude|anthropic|glm|kimi|gemini|grok|gpt|openai/i);
    }
  });
});

function harness() {
  const bell: Array<{ uid: string; message: string }> = [];
  const mail: Array<{ to: string; subject: string; body: string }> = [];
  let emailAvailable = true;
  let ownerHasEmail = true;
  const deps: Partial<NotifyApprovalDeps> = {
    notify: async (uid, message) => { bell.push({ uid, message }); },
    resolveEmail: async () => (ownerHasEmail ? 'creator@example.com' : null),
    email: async (to, subject, body) => {
      if (!emailAvailable) return false;
      mail.push({ to, subject, body });
      return true;
    },
  };
  return {
    deps, bell, mail,
    setEmailAvailable: (v: boolean) => { emailAvailable = v; },
    setOwnerHasEmail: (v: boolean) => { ownerHasEmail = v; },
  };
}

describe('notifyStoreApproval — the orchestration, without a network', () => {
  it('writes the bell notification and sends the email when both are available', async () => {
    const h = harness();
    await notifyStoreApproval('u1', 'XStudy Help', 'apk', h.deps);
    expect(h.bell).toHaveLength(1);
    expect(h.bell[0].uid).toBe('u1');
    expect(h.bell[0].message).toContain('XStudy Help');
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0].to).toBe('creator@example.com');
    expect(h.mail[0].subject).toContain('XStudy Help');
  });

  it('still writes the bell notification when email is not configured', async () => {
    const h = harness();
    h.setEmailAvailable(false);
    await notifyStoreApproval('u1', 'App', 'web', h.deps);
    expect(h.bell).toHaveLength(1);
    expect(h.mail).toHaveLength(0);
  });

  it('never emails an unverified/missing owner address, but the bell still fires', async () => {
    const h = harness();
    h.setOwnerHasEmail(false);
    await notifyStoreApproval('u1', 'App', 'web', h.deps);
    expect(h.bell).toHaveLength(1);
    expect(h.mail).toHaveLength(0);
  });

  it('a blank app name falls back to a generic, still-honest name rather than an empty quote', async () => {
    const h = harness();
    await notifyStoreApproval('u1', '', 'apk', h.deps);
    expect(h.bell[0].message).toContain('Your app');
  });

  it('never throws even when every dependency rejects', async () => {
    const failing: Partial<NotifyApprovalDeps> = {
      notify: async () => { throw new Error('bell down'); },
      resolveEmail: async () => { throw new Error('auth down'); },
      email: async () => { throw new Error('provider down'); },
    };
    await expect(notifyStoreApproval('u1', 'App', 'apk', failing)).resolves.toBeUndefined();
  });
});
