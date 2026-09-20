// WHAT THE USER MUST DO — the panel's side of it (admin 2026-09-20).
//
// Holds the durable list, folds in whatever the running build is asking for right now, and decides
// when the tray opens itself. Extracted from `AgentV3Panel` deliberately: that file is five thousand
// lines and several sessions edit it at once, and the rules below are worth testing on their own.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authJsonHeaders } from '../../lib/authHeaders';
import {
  isOpen, mergeLiveActions,
  type LiveAsks, type UserActionView,
} from './userActionView';

export interface UserActionsApi {
  actions: UserActionView[];
  /** What the badge shows. Zero ⇒ no badge is rendered at all. */
  openCount: number;
  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  busyId: string | null;
  refresh: () => Promise<void>;
  close: (action: UserActionView, status: 'done' | 'not_needed') => Promise<void>;
}

export function useUserActions(
  workspaceId: string | null | undefined,
  live: LiveAsks,
  /** Changes whenever something might have added an ask — a finished build, a new gate. */
  refreshKey: string,
): UserActionsApi {
  const [stored, setStored] = useState<UserActionView[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const autoOpened = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/agentv3/user-actions?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: await authJsonHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json() as { actions?: UserActionView[] };
      setStored(Array.isArray(data?.actions) ? data.actions : []);
    } catch {
      // A list we could not read stays as it was. It must never become an empty one: the live asks
      // below are what keep a waiting build answerable, and clearing them here would hide a gate.
    }
  }, [workspaceId]);

  const close = useCallback(async (action: UserActionView, status: 'done' | 'not_needed') => {
    if (!workspaceId) return;
    setBusyId(action.id);
    try {
      const res = await fetch('/api/agentv3/user-actions/close', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, id: action.id, status }),
      });
      if (res.ok) {
        const data = await res.json() as { actions?: UserActionView[] };
        if (Array.isArray(data?.actions)) setStored(data.actions);
      }
    } catch {
      /* the row stays open — a decision we could not store must not look stored */
    } finally {
      setBusyId(null);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const actions = useMemo(() => mergeLiveActions(stored, live, Date.now()), [stored, live]);
  const openCount = useMemo(() => actions.filter(isOpen).length, [actions]);

  /**
   * THE ONE CASE THAT OPENS ITSELF — a build that is genuinely stopped.
   *
   * A gate auto-denies after its timeout, so a blocking ask sitting unseen behind a badge would make
   * this feature the cause of the failure it exists to prevent. Everything else merely lights the
   * badge: opening a panel over someone for "do this later" work is exactly how a user learns to
   * dismiss it without reading, which is the admin's first rule.
   *
   * Once per row, for ever — a user who closed the tray has answered the interruption, and reopening
   * it on the next render would be the same nagging in a faster loop.
   */
  useEffect(() => {
    const blocking = actions.find((a) => isOpen(a) && a.blocking);
    if (!blocking || autoOpened.current.has(blocking.id)) return;
    autoOpened.current.add(blocking.id);
    setTrayOpen(true);
  }, [actions]);

  return { actions, openCount, trayOpen, setTrayOpen, busyId, refresh, close };
}
