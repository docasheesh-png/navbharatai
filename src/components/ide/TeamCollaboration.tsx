import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Mail,
  Copy,
  RefreshCw,
  MoreVertical,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Crown,
  Edit3,
  Eye,
  Video,
  Bell,
  Link,
  UserMinus,
  Shield,
  Loader2,
  QrCode,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'Admin' | 'Editor' | 'Viewer';
type LinkExpiry = 'never' | '7days' | '30days';
type LinkAccess = 'anyone' | 'team';

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
}

interface ActivityEntry {
  id: string;
  member: string;
  action: string;
  time: string;
}

interface NotificationPrefs {
  emailJoins: boolean;
  emailDeploys: boolean;
  inApp: boolean;
  weeklySummary: boolean;
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

const DEFAULT_MEMBERS: TeamMember[] = [
  { id: 'u1', name: 'You',          email: 'you@example.com',          role: 'Admin',  online: true,  isYou: true,  avatarColor: AVATAR_COLORS[5] },
  { id: 'u2', name: 'Priya Sharma', email: 'priya@example.com',        role: 'Editor', online: false, lastSeen: '2 hours ago',  avatarColor: AVATAR_COLORS[3] },
  { id: 'u3', name: 'Rahul Dev',    email: 'rahul@example.com',        role: 'Viewer', online: false, lastSeen: '1 day ago',    avatarColor: AVATAR_COLORS[6] },
];

const DEFAULT_ACTIVITIES: ActivityEntry[] = [
  { id: 'a1',  member: 'Priya Sharma', action: 'ne file edit kiya',         time: '5 min ago'    },
  { id: 'a2',  member: 'You',          action: 'ne app deploy kiya',         time: '1 hour ago'   },
  { id: 'a3',  member: 'Rahul Dev',    action: 'joined the project',         time: '2 hours ago'  },
  { id: 'a4',  member: 'Priya Sharma', action: 'ne component banaya',        time: '3 hours ago'  },
  { id: 'a5',  member: 'You',          action: 'ne new branch create kiya',  time: '5 hours ago'  },
  { id: 'a6',  member: 'Rahul Dev',    action: 'ne comment add kiya',        time: '6 hours ago'  },
  { id: 'a7',  member: 'Priya Sharma', action: 'ne build run kiya',          time: '8 hours ago'  },
  { id: 'a8',  member: 'You',          action: 'ne settings update kiya',    time: '10 hours ago' },
  { id: 'a9',  member: 'Priya Sharma', action: 'ne file delete kiya',        time: '12 hours ago' },
  { id: 'a10', member: 'Rahul Dev',    action: 'ne project dekha',           time: '1 day ago'    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const initials = (name: string) =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

const generateProjectId = () =>
  Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

const localKey = (uid?: string) => `navbharatai_team_${uid ?? 'anon'}`;

// ─── Simple ASCII QR placeholder ─────────────────────────────────────────────

const QrDisplay: React.FC<{ url: string }> = ({ url }) => {
  const cells = Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      // Corner squares pattern
      const inCorner =
        (r < 2 && c < 2) || (r < 2 && c > 4) || (r > 4 && c < 2);
      // Simple hash pattern for data cells
      const hash = ((url.charCodeAt((r * 7 + c) % url.length) + r + c) % 3) === 0;
      return inCorner || hash;
    })
  );
  return (
    <div className="inline-grid gap-px p-2 rounded bg-white" style={{ gridTemplateColumns: 'repeat(7, 8px)' }}>
      {cells.flat().map((filled, i) => (
        <div key={i} className={`w-2 h-2 ${filled ? 'bg-black' : 'bg-white'}`} />
      ))}
    </div>
  );
};

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
  const [members, setMembers] = useState<TeamMember[]>(DEFAULT_MEMBERS);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // — Share state
  const [projectId] = useState(() => generateProjectId());
  const [linkExpiry, setLinkExpiry] = useState<LinkExpiry>('never');
  const [linkAccess, setLinkAccess] = useState<LinkAccess>('anyone');
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [shareLink, setShareLink] = useState('');

  // — Notifications state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    emailJoins: true,
    emailDeploys: false,
    inApp: true,
    weeklySummary: false,
  });

  // — Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // — Load from Firestore or localStorage
  useEffect(() => {
    const loadTeam = async () => {
      try {
        const { getFirestore, collection, getDocs } = await import('firebase/firestore');
        const { getApp } = await import('firebase/app');
        const db = getFirestore(getApp());
        const snap = await getDocs(collection(db, `projects/${userId}/team`));
        if (!snap.empty) {
          const data = snap.docs.map(d => d.data() as TeamMember);
          setMembers(data);
          return;
        }
      } catch {
        // Firestore unavailable — fall through to localStorage
      }
      const saved = localStorage.getItem(localKey(userId));
      if (saved) {
        try { setMembers(JSON.parse(saved)); } catch { /* ignore */ }
      }
    };
    loadTeam();
  }, [userId]);

  // Build share link
  useEffect(() => {
    setShareLink(`https://navbharat.ai/shared/${projectId}`);
  }, [projectId]);

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
      showToast('Valid email address enter karein', 'error');
      return;
    }
    if (members.some(m => m.email === inviteEmail)) {
      showToast('Yeh member already team mein hai', 'error');
      return;
    }
    setInviting(true);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, projectId, userId }),
      });
      if (!res.ok) throw new Error('API failed');
      showToast(`Invite bheja gaya: ${inviteEmail}`);
    } catch {
      // Mock fallback
      showToast(`Invite (mock) bheja gaya: ${inviteEmail}`);
    }
    const invite: PendingInvite = {
      id: Math.random().toString(36).slice(2),
      email: inviteEmail,
      role: inviteRole,
      sentAt: 'Just now',
    };
    setPendingInvites(prev => [invite, ...prev]);
    setInviteEmail('');
    setInviting(false);
  };

  const revokeInvite = (id: string) => {
    setPendingInvites(prev => prev.filter(i => i.id !== id));
    showToast('Invite revoke ho gaya');
  };

  // — Role change
  const changeMemberRole = (memberId: string, newRole: Role) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
    setMenuOpen(null);
    showToast('Role update ho gaya');
  };

  // — Remove member
  const removeMember = (memberId: string) => {
    setMembers(prev => prev.filter(m => m.id !== memberId));
    setMenuOpen(null);
    showToast('Member remove ho gaya');
  };

  // — Copy link
  const copyLink = () => {
    navigator.clipboard.writeText(shareLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // — Regenerate link
  const handleRegenerate = async () => {
    if (!confirmRegenerate) { setConfirmRegenerate(true); return; }
    setRegenerating(true);
    await new Promise(r => setTimeout(r, 800));
    setShareLink(`https://navbharat.ai/shared/${generateProjectId()}`);
    setRegenerating(false);
    setConfirmRegenerate(false);
    showToast('New link generate ho gaya');
  };

  const currentUserIsAdmin = members.find(m => m.isYou)?.role === 'Admin';
  const onlineMembers = members.filter(m => m.online);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 p-4 font-sans">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users size={20} className="text-blue-400" />
            Team Collaboration
            {projectName && <span className="text-sm font-normal text-gray-400 ml-1">— {projectName}</span>}
          </h1>
          <p className="text-gray-500 text-sm mt-1">Team manage karein, invite karein, aur project share karein</p>
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
                    {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                    {inviting ? 'Bhejna...' : 'Invite Karo'}
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
                        <div>
                          <p className="text-xs text-gray-300 truncate max-w-[160px]">{inv.email}</p>
                          <p className="text-xs text-gray-600">{inv.role} · {inv.sentAt}</p>
                        </div>
                        <button
                          onClick={() => revokeInvite(inv.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors ml-2"
                          title="Revoke invite"
                        >
                          <X size={13} />
                        </button>
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
                      <div><span className="text-red-400 font-medium">Admin:</span> Full access, invite/remove members, deploy kar sakta hai</div>
                    </div>
                    <div className="flex items-start gap-2 p-2 bg-[#0d1117] rounded-lg">
                      <Edit3 size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                      <div><span className="text-blue-400 font-medium">Editor:</span> Code edit kar sakta hai, files create aur builds run kar sakta hai</div>
                    </div>
                    <div className="flex items-start gap-2 p-2 bg-[#0d1117] rounded-lg">
                      <Eye size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <div><span className="text-gray-400 font-medium">Viewer:</span> Read-only access, comments de sakta hai</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ═══ RIGHT COLUMN ═══════════════════════════════════════════════ */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

            {/* — Share Project Link */}
            <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Link size={14} className="text-purple-400" /> Project Share Link
              </h2>
              <div className="flex gap-2 mb-3">
                <input
                  readOnly
                  value={shareLink}
                  className="flex-1 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-400 font-mono focus:outline-none"
                />
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors border border-white/10"
                >
                  {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <div className="flex flex-wrap gap-4 mb-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Expiry</p>
                  <div className="flex gap-2">
                    {(['never', '7days', '30days'] as LinkExpiry[]).map(v => (
                      <button
                        key={v}
                        onClick={() => setLinkExpiry(v)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${linkExpiry === v ? 'border-blue-500/60 bg-blue-500/10 text-blue-300' : 'border-white/10 text-gray-500 hover:border-white/20'}`}
                      >
                        {v === 'never' ? 'Never' : v === '7days' ? '7 Days' : '30 Days'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Access</p>
                  <div className="flex gap-2">
                    {([['anyone', 'Anyone with link'], ['team', 'Team only']] as [LinkAccess, string][]).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setLinkAccess(v)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${linkAccess === v ? 'border-green-500/60 bg-green-500/10 text-green-300' : 'border-white/10 text-gray-500 hover:border-white/20'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <QrDisplay url={shareLink} />
                  <div className="text-xs text-gray-600">
                    <QrCode size={14} className="inline mr-1 text-gray-500" />
                    QR scan karein
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {confirmRegenerate && (
                    <p className="text-xs text-yellow-400">Purana link expire ho jayega. Confirm?</p>
                  )}
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${confirmRegenerate ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20' : 'border-white/10 text-gray-400 hover:bg-white/5'}`}
                  >
                    {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {confirmRegenerate ? 'Confirm Regenerate' : 'Regenerate Link'}
                  </button>
                  {confirmRegenerate && (
                    <button onClick={() => setConfirmRegenerate(false)} className="text-xs text-gray-600 hover:text-gray-400">Cancel</button>
                  )}
                </div>
              </div>
            </div>

            {/* — Activity Feed */}
            <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Bell size={14} className="text-yellow-400" /> Activity Feed
              </h2>
              <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-1 custom-scroll">
                {DEFAULT_ACTIVITIES.map(entry => {
                  const member = members.find(m => m.name === entry.member);
                  const color = member?.avatarColor ?? AVATAR_COLORS[0];
                  return (
                    <div key={entry.id} className="flex items-center gap-2.5 py-1.5 border-b border-white/5 last:border-0">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        {initials(entry.member)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-300">
                          <span className="font-medium text-white">{entry.member}</span>{' '}
                          {entry.action}
                        </span>
                      </div>
                      <span className="text-xs text-gray-600 flex-shrink-0">{entry.time}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* — Bottom row: Live Presence + Notifications */}
            <div className="flex gap-4 flex-col sm:flex-row">

              {/* Live Presence */}
              <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 flex-1">
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
                    <p className="text-xs text-gray-600">Abhi koi online nahi</p>
                  )}
                </div>
                <div className="relative group inline-block">
                  <button
                    disabled
                    className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-white/10 text-gray-600 cursor-not-allowed"
                  >
                    <Video size={13} /> Start Video Call
                  </button>
                  <div className="absolute bottom-full left-0 mb-1.5 bg-[#0d1117] border border-white/10 text-gray-400 text-xs px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
                    Coming Soon
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 flex-1">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Bell size={14} className="text-blue-400" /> Notifications
                </h2>
                <div className="flex flex-col gap-2.5">
                  {(
                    [
                      ['emailJoins',    'Email — team joins'],
                      ['emailDeploys',  'Email — deployments'],
                      ['inApp',         'In-app notifications'],
                      ['weeklySummary', 'Weekly summary email'],
                    ] as [keyof NotificationPrefs, string][]
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 cursor-pointer group">
                      <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">{label}</span>
                      <button
                        role="switch"
                        aria-checked={notifPrefs[key]}
                        onClick={() => setNotifPrefs(p => ({ ...p, [key]: !p[key] }))}
                        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${notifPrefs[key] ? 'bg-blue-600' : 'bg-white/10'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${notifPrefs[key] ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamCollaboration;
