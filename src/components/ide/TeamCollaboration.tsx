import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MentionInbox } from './MentionInbox';
import { teamAuthHeader } from './teamAuth';
import {
  Users,
  Mail,
  Copy,
  MoreVertical,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Crown,
  Edit3,
  Eye,
  Video,
  UserMinus,
  Shield,
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { TeamLibraryPanel } from './TeamLibraryPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'Admin' | 'Editor' | 'Viewer';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  online: boolean;
  lastSeen?: string;
  isYou?: boolean;
  avatarColor: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  sentAt: string;
  /** Real, durable, copyable invite link (P-COLLAB.1) — resolves + accepts via the backend. */
  inviteUrl?: string;
}

export interface TeamCollaborationProps {
  userId?: string;
  projectName?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#e91e63',
];

const ROLE_STYLES: Record<Role, { bg: string; text: string; label: string }> = {
  Admin:  { bg: 'bg-red-500/20',  text: 'text-red-400',  label: 'Admin'  },
  Editor: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Editor' },
  Viewer: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Viewer' },
};

// P-COLLAB.1 — members now load from the real backend (`GET /api/team/:teamId/members`); no mock roster.
/** The current user's own member entry (the team owner). */
function makeSelf(userId?: string): TeamMember {
  return { id: userId || 'you', name: 'You', email: '', role: 'Admin', online: true, isYou: true, avatarColor: AVATAR_COLORS[5] };
}

/** Map a backend RBAC role string to the display Role. */
function displayRole(role: string): Role {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'owner') return 'Admin';
  if (r === 'editor') return 'Editor';
  return 'Viewer';
}

/** Map a backend member record (uid/email/role/joinedAt) to the display TeamMember shape. */
function mapBackendMember(m: { uid: string; email?: string; role?: string }): TeamMember {
  const name = (m.email && m.email.split('@')[0]) || 'Member';
  let hash = 0;
  const key = String(m.uid || name);
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return {
    id: String(m.uid),
    name,
    email: String(m.email || ''),
    role: displayRole(String(m.role || 'viewer')),
    online: false,
    avatarColor: AVATAR_COLORS[hash % AVATAR_COLORS.length],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const initials = (name: string) =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

const localKey = (uid?: string) => `navbharatai_team_${uid ?? 'anon'}`;

// teamAuthHeader now lives in ./teamAuth (shared by MentionInbox too — one auth path, no circular import).

// ─── Avatar ───────────────────────────────────────────────────────────────────

const Avatar: React.FC<{ member: TeamMember; size?: 'sm' | 'md'; ring?: boolean }> = ({
  member, size = 'md', ring,
}) => {
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div
      className={`${sz} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 relative ${ring ? 'ring-2 ring-green-400' : ''}`}
      style={{ backgroundColor: member.avatarColor }}
      title={member.name}
    >
      {initials(member.name)}
      {member.online && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 border-2 border-[#161b22] rounded-full" />
      )}
    </div>
  );
};

// ─── Role Badge ───────────────────────────────────────────────────────────────

const RoleBadge: React.FC<{ role: Role }> = ({ role }) => {
  const s = ROLE_STYLES[role];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
};

// ─── Toast ────────────────────────────────────────────────────────────────────

const Toast: React.FC<{ msg: string; type: 'success' | 'error' }> = ({ msg, type }) => (
  <div
    className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-all
      ${type === 'success' ? 'bg-green-500/20 border border-green-500/40 text-green-300' : 'bg-red-500/20 border border-red-500/40 text-red-300'}`}
  >
    {type === 'success' ? <Check size={14} /> : <X size={14} />}
    {msg}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const TeamCollaboration: React.FC<TeamCollaborationProps> = ({ userId, projectName }) => {
  // — Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Editor');
  const [inviting, setInviting] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  // — Team state
  const [members, setMembers] = useState<TeamMember[]>(() => [makeSelf(userId)]);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // — Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // — Load the real team from the backend (P-COLLAB.1). Members = you (owner) + everyone who accepted
  // an invite (`teams/{teamId}/members`). Falls back to the local cache when offline/unauthenticated.
  useEffect(() => {
    const self = makeSelf(userId);
    const loadTeam = async () => {
      if (userId) {
        try {
          const authHeader = await teamAuthHeader();
          const res = await fetch(`/api/team/${encodeURIComponent(userId)}/members`, { headers: authHeader });
          if (res.ok) {
            const data = await res.json();
            const backend: TeamMember[] = Array.isArray(data.members)
              ? data.members.filter((m: any) => m && m.uid && m.uid !== userId).map(mapBackendMember)
              : [];
            const composed = [self, ...backend];
            setMembers(composed);
            try { localStorage.setItem(localKey(userId), JSON.stringify(composed)); } catch { /* ignore */ }
            return;
          }
        } catch {
          // backend unavailable — fall through to the local cache
        }
      }
      const saved = localStorage.getItem(localKey(userId));
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length) { setMembers(parsed); return; }
        } catch { /* ignore */ }
      }
      setMembers([self]);
    };
    loadTeam();
  }, [userId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // — Persist to localStorage when members change
  useEffect(() => {
    localStorage.setItem(localKey(userId), JSON.stringify(members));
  }, [members, userId]);

  // — Invite handler
  const handleInvite = async () => {
    if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    if (members.some(m => m.email === inviteEmail)) {
      showToast('This member is already in the team', 'error');
      return;
    }
    setInviting(true);
    let inviteUrl: string | undefined;
    let ok = false;
    try {
      // The invite route is RBAC-gated (owner/admin), so it needs the signed-in owner's ID token.
      const authHeader = await teamAuthHeader();
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, userId }),
      });
      if (res.status === 401 || res.status === 403) {
        showToast('Sign in as the team owner to send invites', 'error');
        setInviting(false);
        return;
      }
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      ok = !!data.ok;
      // Make the backend's relative `/?join=<token>` link absolute so it can be shared as-is.
      if (data.inviteUrl) {
        try { inviteUrl = new URL(data.inviteUrl, window.location.origin).toString(); }
        catch { inviteUrl = `${window.location.origin}${data.inviteUrl}`; }
      }
      // Honest: no SMTP infra, so we share a real, working invite LINK rather than claim an email was sent.
      showToast(inviteUrl ? `Invite link ready for ${inviteEmail} — copy & share it` : `Invite recorded for ${inviteEmail}`);
    } catch {
      showToast('Could not create the invite. Check your connection and try again.', 'error');
    }
    if (ok) {
      const invite: PendingInvite = {
        id: Math.random().toString(36).slice(2),
        email: inviteEmail,
        role: inviteRole,
        sentAt: 'Just now',
        inviteUrl,
      };
      setPendingInvites(prev => [invite, ...prev]);
      setInviteEmail('');
    }
    setInviting(false);
  };

  // Copy a pending invite's shareable link to the clipboard.
  const copyInviteLink = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    showToast('Invite link copied');
  };

  const revokeInvite = async (id: string) => {
    const invite = pendingInvites.find(i => i.id === id);
    setPendingInvites(prev => prev.filter(i => i.id !== id));
    // Also revoke on the backend so the link truly stops working (not just hidden locally).
    const token = invite?.inviteUrl ? new URLSearchParams(new URL(invite.inviteUrl).search).get('join') : null;
    if (token) {
      try {
        const authHeader = await teamAuthHeader();
        await fetch(`/api/team/invite/${encodeURIComponent(token)}/revoke`, { method: 'POST', headers: authHeader });
      } catch { /* local removal already done; backend revoke is best-effort */ }
    }
    showToast('Invite revoked');
  };

  // — Role change (persists to the backend for real members; the RBAC role is updated too).
  const changeMemberRole = async (memberId: string, newRole: Role) => {
    const target = members.find(m => m.id === memberId);
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
    setMenuOpen(null);
    if (target && !target.isYou && userId) {
      try {
        const authHeader = await teamAuthHeader();
        await fetch('/api/team/member/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ teamId: userId, uid: memberId, role: newRole }),
        });
      } catch { /* local update stands; backend is best-effort */ }
    }
    showToast('Role updated');
  };

  // — Remove member (also removes on the backend for real members).
  const removeMember = async (memberId: string) => {
    const target = members.find(m => m.id === memberId);
    setMembers(prev => prev.filter(m => m.id !== memberId));
    setMenuOpen(null);
    if (target && !target.isYou && userId) {
      try {
        const authHeader = await teamAuthHeader();
        await fetch('/api/team/member/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ teamId: userId, uid: memberId }),
        });
      } catch { /* local removal stands; backend is best-effort */ }
    }
    showToast('Member removed');
  };

  const currentUserIsAdmin = members.find(m => m.isYou)?.role === 'Admin';
  const onlineMembers = members.filter(m => m.online);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#0d1117] text-gray-100 p-4 font-sans">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Users size={20} className="text-blue-400" />
              Team Collaboration
              {projectName && <span className="text-sm font-normal text-gray-400 ml-1">— {projectName}</span>}
            </h1>
            <p className="text-gray-500 text-sm mt-1">Manage your team, send invites, and share the project</p>
          </div>
          {/* T1-mention-inbox — @mentions delivered to your inbox */}
          <MentionInbox />
        </div>

        <div className="flex gap-4 flex-col lg:flex-row">
          {/* ═══ LEFT COLUMN ═══════════════════════════════════════════════ */}
          <div className="flex flex-col gap-4" style={{ width: '360px', minWidth: '320px', flexShrink: 0 }}>

            {/* — Invite Section */}
            <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Mail size={14} className="text-blue-400" /> Invite Member
              </h2>
              <div className="flex flex-col gap-2">
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInvite()}
                  className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as Role)}
                    className="flex-1 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/60"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Editor">Editor</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                  <button
                    onClick={handleInvite}
                    disabled={inviting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-3 py-2 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {inviting ? <TirangaLoader size={14} /> : <Mail size={14} />}
                    {inviting ? 'Sending...' : 'Invite'}
                  </button>
                </div>
              </div>

              {/* Pending Invites */}
              {pendingInvites.length > 0 && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Pending Invites</p>
                  <div className="flex flex-col gap-1.5">
                    {pendingInvites.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between bg-[#0d1117] rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-300 truncate max-w-[160px]">{inv.email}</p>
                          <p className="text-xs text-gray-600">{inv.role} · {inv.sentAt}</p>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          {inv.inviteUrl && (
                            <button
                              onClick={() => copyInviteLink(inv.inviteUrl!)}
                              className="text-gray-500 hover:text-indigo-400 transition-colors"
                              title="Copy invite link"
                            >
                              <Copy size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => revokeInvite(inv.id)}
                            className="text-gray-600 hover:text-red-400 transition-colors"
                            title="Revoke invite"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* — Active Members */}
            <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Users size={14} className="text-green-400" />
                Team Members
                <span className="ml-auto bg-white/10 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                  {members.length}
                </span>
              </h2>

              <div className="flex flex-col gap-2" ref={menuRef}>
                {members.map(member => (
                  <div key={member.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors relative group">
                    <Avatar member={member} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-200 truncate">{member.name}</span>
                        {member.isYou && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">You</span>
                        )}
                        <RoleBadge role={member.role} />
                      </div>
                      <p className="text-xs text-gray-600 truncate">{member.email}</p>
                      {member.online
                        ? <span className="text-xs text-green-400">● Online</span>
                        : <span className="text-xs text-gray-600">Last seen {member.lastSeen}</span>
                      }
                    </div>

                    {/* 3-dot menu (Admin only, not self) */}
                    {currentUserIsAdmin && !member.isYou && (
                      <div className="relative">
                        <button
                          onClick={() => setMenuOpen(menuOpen === member.id ? null : member.id)}
                          className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <MoreVertical size={14} />
                        </button>
                        {menuOpen === member.id && (
                          <div className="absolute right-0 top-7 z-30 bg-[#0d1117] border border-white/10 rounded-lg shadow-xl min-w-[160px] py-1">
                            <p className="text-xs text-gray-600 px-3 py-1 font-medium uppercase tracking-wide">Change Role</p>
                            {(['Admin', 'Editor', 'Viewer'] as Role[]).map(r => (
                              <button
                                key={r}
                                onClick={() => changeMemberRole(member.id, r)}
                                className={`w-full text-left text-sm px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 ${member.role === r ? 'text-blue-400' : 'text-gray-300'}`}
                              >
                                {member.role === r && <Check size={12} />}
                                {member.role !== r && <div className="w-3" />}
                                {r}
                              </button>
                            ))}
                            <div className="border-t border-white/10 my-1" />
                            <button
                              onClick={() => removeMember(member.id)}
                              className="w-full text-left text-sm px-3 py-1.5 hover:bg-white/5 text-red-400 flex items-center gap-2"
                            >
                              <UserMinus size={12} /> Remove from Team
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Role descriptions — collapsible */}
              <div className="mt-3 border-t border-white/10 pt-3">
                <button
                  onClick={() => setRolesOpen(r => !r)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full"
                >
                  <Shield size={12} /> Role Permissions
                  {rolesOpen ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
                </button>
                {rolesOpen && (
                  <div className="mt-2 flex flex-col gap-1.5 text-xs text-gray-400">
                    <div className="flex items-start gap-2 p-2 bg-[#0d1117] rounded-lg">
                      <Crown size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                      <div><span className="text-red-400 font-medium">Admin:</span> Full access, can invite/remove members and deploy</div>
                    </div>
                    <div className="flex items-start gap-2 p-2 bg-[#0d1117] rounded-lg">
                      <Edit3 size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                      <div><span className="text-blue-400 font-medium">Editor:</span> Can edit code, create files, and run builds</div>
                    </div>
                    <div className="flex items-start gap-2 p-2 bg-[#0d1117] rounded-lg">
                      <Eye size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <div><span className="text-gray-400 font-medium">Viewer:</span> Read-only access, can add comments</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ═══ RIGHT COLUMN ═══════════════════════════════════════════════ */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

            {/* — P-COLLAB.4: Team-scoped shared library (prompts/templates/components) — */}
            {userId && <TeamLibraryPanel teamId={userId} />}

            {/* — Live Presence (real: your own live session; teammate presence is not yet tracked) */}
            <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Currently Online
                <span className="ml-auto bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full">
                  {onlineMembers.length} online
                </span>
              </h2>
              <div className="flex gap-2 flex-wrap mb-3">
                {onlineMembers.map(m => (
                  <Avatar key={m.id} member={m} ring />
                ))}
                {onlineMembers.length === 0 && (
                  <p className="text-xs text-gray-600">No one online right now</p>
                )}
              </div>
              {/* The unavailable state must be READABLE, not hover-only. A tooltip never fires on a
                  touch device, and NavBharatAI is mobile-first (the Play Store app is the main surface) —
                  so a phone user saw a dead grey button with no reason at all. The reason now sits in the
                  label itself, and the honest alternative (what DOES work today) is named. */}
              <div className="inline-flex flex-col gap-1">
                <button
                  disabled
                  title="Video calling is not built yet"
                  className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-white/10 text-gray-600 cursor-not-allowed"
                >
                  <Video size={13} /> Start Video Call — not available yet
                </button>
                <p className="text-[10px] text-gray-500 leading-snug max-w-xs">
                  Video calling isn&apos;t built yet — we won&apos;t show a button that does nothing. Use the
                  room chat and @mentions to work together in the meantime.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamCollaboration;
