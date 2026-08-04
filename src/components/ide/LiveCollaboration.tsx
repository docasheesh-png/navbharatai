import React, { useState, useEffect, useRef } from 'react';
import { Users, Video, Wifi, MessageSquare, Share2, Plus, Trash2, X, Check, Copy, Clock, Edit2, Globe, RefreshCw, MessageCircle, CheckCircle2, Sparkles, Bot, Send, Code2, Briefcase, ChevronDown, Zap } from 'lucide-react';
import { db } from '../../App';
import { doc, setDoc, getDoc, deleteDoc, onSnapshot, collection, addDoc, getDocs, query, orderBy, limit, Timestamp } from 'firebase/firestore';
import { lineOfOffset, offsetRangeOfLine, buildAnnotation, sortAnnotations, type CommentAnnotation } from '../../lib/collabAnnotations';
import { isNativeApp } from '../../lib/mobileNative';
import { medicalFeaturesHidden } from '../../lib/playCompliance';

/** A shared in-room AI message — every member sees the same AI thread (Phase 1a). */
interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  authorId: string;
  authorName: string;
  color: string;
  text: string;
  timestamp: number;
}

// Header AI switcher (admin 2026-07-28): the room's header picks WHICH AI the team uses.
//  - 'free'         → shared NavBharatAI Free chat (real; billed to whoever asks)
//  - 'pro'          → NavBharatAI Pro v5.0 real in-room build (coming soon)
//  - 'professional' → a Professional the OWNER selects from a dropdown (coming soon)
//  - 'team'         → members / approvals / chat (kept)
type RoomTab = 'free' | 'pro' | 'professional' | 'team';

// Professionals the room owner can pick for the Professional tab.
const ROOM_PROFESSIONALS_ALL: { id: string; label: string }[] = [
  { id: 'doctor', label: 'Doctor AI' },
  { id: 'teacher', label: 'Teacher AI' },
  { id: 'lawyer', label: 'Lawyer AI' },
  { id: 'ca', label: 'CA / Accountant AI' },
  { id: 'astrologer', label: 'Astrologer AI' },
  { id: 'kisan', label: 'Kisan (Farmer) AI' },
];
// Play compliance (admin 2026-08-04): the native shell must not advertise a medical assistant even in
// a coming-soon dropdown — the shipped app declares no medical features and copy must match.
const ROOM_PROFESSIONALS = medicalFeaturesHidden(isNativeApp())
  ? ROOM_PROFESSIONALS_ALL.filter((p) => p.id !== 'doctor')
  : ROOM_PROFESSIONALS_ALL;

/** A remote collaborator's live cursor position (which line they're editing). */
interface RemotePresence {
  id: string;
  name: string;
  color: string;
  caretLine: number;
  online: boolean;
  updatedAt: number;
}

// A room member. `status` drives owner approval: a joiner starts 'pending' and cannot read the
// shared code / chat / AI or write anything until the owner sets them 'approved'. The owner can
// also kick a member (delete their member doc), which revokes access immediately (rules-enforced).
interface Member {
  id: string;
  name: string;
  color: string;
  status: 'pending' | 'approved';
  requestedAt: number;
}

interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number;
  color: string;
}

interface Props {
  generatedCode: string;
  onCodeUpdate: (code: string) => void;
  userId?: string;
  userName?: string;
  /** Signed-in user's email — sent as the billing identity so an in-room AI turn is charged
   *  to the member who triggered it (client-relayed, "everyone pays their own"). */
  userEmail?: string;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
const STORAGE_KEY = 'navbharat_collab_room';

function genId() { return Math.random().toString(36).slice(2, 10); }

function shortId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

export function LiveCollaboration({ onCodeUpdate, userId, userName, userEmail }: Props) {
  // `generatedCode` is intentionally NOT read: a room is a clean scratchpad and must never seed
  // itself from the app's preview/boot document (admin-decided 2026-07-28). The prop stays on the
  // interface for API stability / a future opt-in "Load my app" action.
  const [roomId, setRoomId] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [roomOwner, setRoomOwner] = useState('');      // createdBy uid of the active/pending room
  const [bootedMsg, setBootedMsg] = useState('');      // set when the owner rejects or kicks you
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  // A room is a CLEAN shared scratchpad (admin-decided 2026-07-28): it starts EMPTY — it never
  // auto-dumps the app's preview/boot document — and it never blanks the user's own app preview
  // (onCodeUpdate is only pushed for genuinely non-empty shared code, below).
  const [sharedCode, setSharedCode] = useState('');
  const [copied, setCopied] = useState(false);
  // 'pending' = waiting for the owner to approve your join request.
  const [status, setStatus] = useState<'idle' | 'connecting' | 'pending' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [myName] = useState(userName || 'User_' + genId().slice(0, 4));
  const [myId] = useState(userId || genId());
  const [myColor] = useState(COLORS[Math.floor(Math.random() * COLORS.length)]);
  // Collaboration rooms require a signed-in identity: the secure Firestore rules bind every write
  // to request.auth.uid (createdBy / presence / message authorship), so an anonymous visitor is
  // refused. Gate the UI honestly instead of letting a denied write surface as a permission error.
  const signedIn = !!userId;
  const [isEditing, setIsEditing] = useState(false);
  // P-DESIGN.7 — live cursors + line-anchored comments.
  const [presence, setPresence] = useState<RemotePresence[]>([]);
  const [comments, setComments] = useState<CommentAnnotation[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [caretLine, setCaretLine] = useState(1);
  // Phase 1a — shared in-room AI thread + mobile tab layout.
  const [roomTab, setRoomTab] = useState<RoomTab>('free');
  const [selectedProfessional, setSelectedProfessional] = useState(ROOM_PROFESSIONALS[0]?.id ?? 'teacher'); // owner picks (Professional tab)
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubChatRef = useRef<(() => void) | null>(null);
  const unsubPresenceRef = useRef<(() => void) | null>(null);
  const unsubCommentsRef = useRef<(() => void) | null>(null);
  const unsubAiRef = useRef<(() => void) | null>(null);
  const unsubMembersRef = useRef<(() => void) | null>(null);  // roster (owner + approved)
  const unsubMyMemberRef = useRef<(() => void) | null>(null); // my own request doc (pending → approved / kicked)
  const aiBottomRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCaretLineRef = useRef(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Publish my cursor line to the room's presence subcollection, throttled so we don't hammer
  // Firestore on every keystroke (~300ms). Best-effort — a failed presence write never breaks editing.
  const publishCaret = (line: number) => {
    if (!activeRoom) return;
    if (presenceThrottleRef.current) return; // a write is already scheduled this window
    presenceThrottleRef.current = setTimeout(async () => {
      presenceThrottleRef.current = null;
      try {
        await setDoc(
          doc(db, 'collab_rooms', activeRoom, 'presence', myId),
          { id: myId, name: myName, color: myColor, caretLine: lastCaretLineRef.current, online: true, updatedAt: Date.now() },
          { merge: true },
        );
      } catch { /* best-effort presence */ }
    }, 300);
  };

  // Track the caret's line as the user moves/edits, and broadcast it.
  const handleCaret = () => {
    const el = textareaRef.current;
    if (!el) return;
    const line = lineOfOffset(el.value, el.selectionStart ?? 0);
    lastCaretLineRef.current = line;
    setCaretLine(line);
    publishCaret(line);
  };

  // Add a comment anchored to the caret's current line.
  const addComment = async () => {
    if (!commentInput.trim() || !activeRoom) return;
    const record = buildAnnotation({ id: genId(), line: caretLine, text: commentInput, authorId: myId, authorName: myName, color: myColor, timestamp: Date.now() });
    setCommentInput('');
    try {
      await addDoc(collection(db, 'collab_rooms', activeRoom, 'comments'), {
        line: record.line, text: record.text, authorId: record.authorId, authorName: record.authorName,
        color: record.color, timestamp: record.timestamp, resolved: false,
      });
    } catch { /* best-effort — the onSnapshot listener reflects the write when it lands */ }
  };

  // Mark a comment resolved.
  const resolveComment = async (id: string) => {
    if (!activeRoom) return;
    try {
      await setDoc(doc(db, 'collab_rooms', activeRoom, 'comments', id), { resolved: true }, { merge: true });
    } catch { /* best-effort */ }
  };

  // Jump the editor selection to a commented line.
  const jumpToLine = (line: number) => {
    const el = textareaRef.current;
    if (!el) return;
    const [start, end] = offsetRangeOfLine(el.value, line);
    el.focus();
    el.setSelectionRange(start, end);
    setCaretLine(line);
  };

  // Phase 1a — ask the shared in-room AI. The prompt AND the reply are written to the room's
  // ai_chat subcollection so EVERY member sees the same conversation live. The AI call is real
  // (the same Free chat engine the solo NavBharatAI chat uses) and billed to the member who
  // triggered it (their own account, via the x-user-* identity headers) — "everyone pays their own".
  const sendAiPrompt = async () => {
    const text = aiInput.trim();
    if (!text || !activeRoom || aiBusy) return;
    setAiInput('');
    setAiError('');
    setAiBusy(true);
    try {
      // 1) publish the prompt so all members see who asked what.
      await addDoc(collection(db, 'collab_rooms', activeRoom, 'ai_chat'), {
        role: 'user', authorId: myId, authorName: myName, color: myColor, text: text.slice(0, 20000), timestamp: Date.now(),
      });
      // 2) call the real Free AI, billed to the triggering member.
      const history = aiMessages.slice(-16).map(m => ({ sender: m.role === 'user' ? 'user' : 'ai', text: String(m.text || '').slice(0, 2000) }));
      const res = await fetch('/api/chat/navbharat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': myId,
          'x-user-email': userEmail || '',
          'x-user-name': myName,
        },
        body: JSON.stringify({ message: text, history, agent: 'navbharatai', stream: false }),
      });
      const data = await res.json().catch(() => null);
      const reply = data && typeof data.reply === 'string' ? data.reply.trim() : '';
      if (!res.ok || !reply) {
        throw new Error((data && (data.error || data.reply)) || 'The AI could not respond. Please try again.');
      }
      // 3) publish the reply so all members see the same answer.
      await addDoc(collection(db, 'collab_rooms', activeRoom, 'ai_chat'), {
        role: 'assistant', authorId: myId, authorName: myName, color: myColor, text: reply.slice(0, 20000), timestamp: Date.now(),
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI request failed. Please try again.');
      setTimeout(() => setAiError(''), 5000);
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setRoomId(saved);
    return () => {
      unsubscribeRef.current?.();
      unsubChatRef.current?.();
      unsubPresenceRef.current?.();
      unsubCommentsRef.current?.();
      unsubAiRef.current?.();
      unsubMembersRef.current?.();
      unsubMyMemberRef.current?.();
      if (presenceThrottleRef.current) clearTimeout(presenceThrottleRef.current);
    };
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    aiBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  // Tear down all listeners + reset room state (no writes).
  const teardown = () => {
    unsubscribeRef.current?.(); unsubChatRef.current?.(); unsubPresenceRef.current?.();
    unsubCommentsRef.current?.(); unsubAiRef.current?.(); unsubMembersRef.current?.(); unsubMyMemberRef.current?.();
    unsubMyMemberRef.current = null;
    if (presenceThrottleRef.current) { clearTimeout(presenceThrottleRef.current); presenceThrottleRef.current = null; }
    setActiveRoom(null);
    setMembers([]); setChatMessages([]); setPresence([]); setComments([]); setAiMessages([]);
    setSharedCode(''); setRoomTab('free');
    localStorage.removeItem(STORAGE_KEY);
  };

  // Booted — the owner rejected the request or kicked you. Tear down and show an honest message.
  const handleBooted = (msg: string) => {
    teardown();
    setStatus('error');
    setBootedMsg(msg);
    setErrorMsg(msg);
  };

  // Enter a room I'm allowed in (owner or approved): wire up all the live subscriptions.
  const enterRoom = (id: string, ownerUid: string) => {
    setRoomOwner(ownerUid);

    // Shared code — approval-gated content doc (clean scratchpad, never the app's preview dump).
    unsubscribeRef.current = onSnapshot(doc(db, 'collab_rooms', id, 'content', 'shared'), (snap) => {
      const code = (snap.exists() ? (snap.data().code as string) : '') || '';
      if (!isEditing) { setSharedCode(code); if (code) onCodeUpdate(code); }
    });

    const chatQ = query(collection(db, 'collab_rooms', id, 'chat'), orderBy('timestamp', 'asc'), limit(50));
    unsubChatRef.current = onSnapshot(chatQ, (snap) => {
      setChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)));
    });

    // Live cursors — other members' current line.
    unsubPresenceRef.current = onSnapshot(collection(db, 'collab_rooms', id, 'presence'), (snap) => {
      const now = Date.now();
      const others: RemotePresence[] = [];
      snap.forEach((d) => {
        const p = d.data() as Partial<RemotePresence>;
        if (p.id && p.id !== myId && p.online !== false && typeof p.updatedAt === 'number' && now - p.updatedAt < 30000) {
          others.push({ id: String(p.id), name: String(p.name || 'User'), color: String(p.color || '#6366f1'), caretLine: Math.max(1, Number(p.caretLine) || 1), online: true, updatedAt: p.updatedAt });
        }
      });
      setPresence(others);
    });

    unsubCommentsRef.current = onSnapshot(collection(db, 'collab_rooms', id, 'comments'), (snap) => {
      const list: CommentAnnotation[] = snap.docs.map((d) => {
        const c = d.data() as Partial<CommentAnnotation>;
        return buildAnnotation({ id: d.id, line: Number(c.line) || 1, text: String(c.text || ''), authorId: String(c.authorId || ''), authorName: String(c.authorName || 'User'), color: String(c.color || '#6366f1'), timestamp: Number(c.timestamp) || 0 });
      }).map((c, i) => ({ ...c, resolved: (snap.docs[i].data() as any).resolved === true }));
      setComments(sortAnnotations(list));
    });

    const aiQ = query(collection(db, 'collab_rooms', id, 'ai_chat'), orderBy('timestamp', 'asc'), limit(100));
    unsubAiRef.current = onSnapshot(aiQ, (snap) => {
      setAiMessages(snap.docs.map(d => {
        const m = d.data() as Partial<AiMessage>;
        return { id: d.id, role: m.role === 'assistant' ? 'assistant' : 'user', authorId: String(m.authorId || ''), authorName: String(m.authorName || 'User'), color: String(m.color || '#6366f1'), text: String(m.text || ''), timestamp: Number(m.timestamp) || 0 };
      }));
    });

    // Roster + kick-detection: watch the members collection. If MY approved membership disappears
    // while I'm in the room (owner kicked me), boot me out immediately (rules would also deny me).
    unsubMembersRef.current = onSnapshot(collection(db, 'collab_rooms', id, 'members'), (snap) => {
      const list: Member[] = snap.docs.map(d => {
        const m = d.data() as Partial<Member>;
        return { id: d.id, name: String(m.name || 'User'), color: String(m.color || '#6366f1'), status: m.status === 'approved' ? 'approved' : 'pending', requestedAt: Number(m.requestedAt) || 0 };
      });
      setMembers(list);
      if (myId !== ownerUid) {
        const me = list.find(m => m.id === myId);
        if (!me || me.status !== 'approved') handleBooted('You were removed from the room by the owner.');
      }
    });

    // Register my presence (best-effort).
    setDoc(doc(db, 'collab_rooms', id, 'presence', myId), { id: myId, name: myName, color: myColor, caretLine: 1, online: true, updatedAt: Date.now() }, { merge: true }).catch(() => {});

    setActiveRoom(id);
    localStorage.setItem(STORAGE_KEY, id);
    setStatus('connected');
  };

  const createRoom = async () => {
    if (!signedIn) { setStatus('error'); setErrorMsg('Please sign in to create a collaboration room.'); return; }
    const id = shortId();
    setStatus('connecting');
    setBootedMsg('');
    try {
      // Room metadata only (the shared CODE lives in the approval-gated content doc, not here).
      await setDoc(doc(db, 'collab_rooms', id), { createdAt: Date.now(), createdBy: myId, ownerName: myName });
      await setDoc(doc(db, 'collab_rooms', id, 'content', 'shared'), { code: '' });
      // The creator is an auto-approved member (the owner).
      await setDoc(doc(db, 'collab_rooms', id, 'members', myId), { id: myId, name: myName, color: myColor, status: 'approved', requestedAt: Date.now() });
      setRoomId(id);
      enterRoom(id, myId);
    } catch (e: any) {
      setStatus('error');
      setErrorMsg('Room could not be created: ' + (e.message || 'Unknown error'));
    }
  };

  const joinRoom = async (id: string) => {
    if (!signedIn) { setStatus('error'); setErrorMsg('Please sign in to join a collaboration room.'); return; }
    setStatus('connecting');
    setBootedMsg('');
    try {
      const roomSnap = await getDoc(doc(db, 'collab_rooms', id));
      if (!roomSnap.exists()) { setStatus('error'); setErrorMsg('Room not found. Check the ID.'); return; }
      const ownerUid = String(roomSnap.data().createdBy || '');
      setRoomOwner(ownerUid);
      setRoomId(id);

      // The owner always enters directly.
      if (myId === ownerUid) { enterRoom(id, ownerUid); return; }

      // Already an approved member? Enter. Otherwise create/keep a pending request and wait.
      const meRef = doc(db, 'collab_rooms', id, 'members', myId);
      const meSnap = await getDoc(meRef);
      if (meSnap.exists() && meSnap.data().status === 'approved') { enterRoom(id, ownerUid); return; }
      if (!meSnap.exists()) {
        await setDoc(meRef, { id: myId, name: myName, color: myColor, status: 'pending', requestedAt: Date.now() });
      }
      setStatus('pending');
      // Watch my own request doc: approved → enter; deleted (rejected) → declined.
      unsubMyMemberRef.current = onSnapshot(meRef, (snap) => {
        if (!snap.exists()) { handleBooted('Your request to join was declined by the owner.'); return; }
        if (snap.data().status === 'approved') {
          unsubMyMemberRef.current?.(); unsubMyMemberRef.current = null;
          enterRoom(id, ownerUid);
        }
      });
    } catch (e: any) {
      setStatus('error');
      setErrorMsg('Failed to join room: ' + (e.message || 'Check Firestore rules'));
    }
  };

  // Owner-only: approve a pending request, or reject/kick a member (delete their member doc).
  const approveMember = async (uid: string) => {
    if (!activeRoom || myId !== roomOwner) return;
    try { await setDoc(doc(db, 'collab_rooms', activeRoom, 'members', uid), { status: 'approved' }, { merge: true }); } catch {}
  };
  const removeMember = async (uid: string) => {
    if (!activeRoom || myId !== roomOwner || uid === roomOwner) return;
    try {
      await deleteDoc(doc(db, 'collab_rooms', activeRoom, 'members', uid));
      await deleteDoc(doc(db, 'collab_rooms', activeRoom, 'presence', uid)).catch(() => {});
    } catch {}
  };

  const leaveRoom = async () => {
    const id = activeRoom;
    try {
      if (id) {
        await setDoc(doc(db, 'collab_rooms', id, 'presence', myId), { online: false, updatedAt: Date.now() }, { merge: true }).catch(() => {});
        // A non-owner leaving gives up their membership (they'd need re-approval to return).
        if (myId !== roomOwner) await deleteDoc(doc(db, 'collab_rooms', id, 'members', myId)).catch(() => {});
      }
    } catch {}
    teardown();
    setStatus('idle');
    setRoomOwner('');
  };

  const handleCodeChange = (code: string) => {
    setSharedCode(code);
    setIsEditing(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsEditing(false);
      if (!activeRoom) return;
      try {
        await setDoc(doc(db, 'collab_rooms', activeRoom, 'content', 'shared'), { code }, { merge: true });
        if (code) onCodeUpdate(code); // only mirror non-empty shared code into the app preview
      } catch {}
    }, 1000);
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !activeRoom) return;
    const msg = { authorId: myId, authorName: myName, color: myColor, text: chatInput.trim(), timestamp: Date.now() };
    setChatInput('');
    try {
      await addDoc(collection(db, 'collab_rooms', activeRoom, 'chat'), msg);
    } catch {
      setChatMessages(prev => [...prev, { id: genId(), ...msg }]);
    }
  };

  const copyLink = () => {
    if (!activeRoom) return;
    navigator.clipboard.writeText(`Room ID: ${activeRoom}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const relativeTime = (ts: number) => {
    const d = Date.now() - ts;
    if (d < 60000) return 'now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    return `${Math.floor(d / 3600000)}h ago`;
  };

  const isOwner = !!roomOwner && myId === roomOwner;
  const approvedMembers = members.filter(m => m.status === 'approved');
  const pendingMembers = members.filter(m => m.status === 'pending');
  // Online = me, or anyone with a fresh presence heartbeat.
  const onlineCount = approvedMembers.filter(m => m.id === myId || presence.some(p => p.id === m.id)).length;

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center">
          <Users className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">Live Collaboration</h2>
          <p className="text-xs text-white/40">Real-time code sharing — build together with your team</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-pulse' : (status === 'connecting' || status === 'pending') ? 'bg-amber-400 animate-pulse' : 'bg-white/20'}`} />
          <span className={`text-xs ${status === 'connected' ? 'text-emerald-400' : (status === 'connecting' || status === 'pending') ? 'text-amber-400' : 'text-white/40'}`}>
            {status === 'connected' ? `Room: ${activeRoom}` : status === 'pending' ? 'Awaiting approval…' : status === 'connecting' ? 'Connecting...' : 'Not connected'}
          </span>
        </div>
      </div>

      {status === 'pending' ? (
        /* — Waiting for the owner to approve the join request — */
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5 text-center">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
            <Clock className="w-8 h-8 text-amber-400 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Waiting for approval</h3>
            <p className="text-sm text-white/40 max-w-xs">You asked to join room <span className="text-white/70 font-mono">{roomId}</span>. The room owner needs to approve you before you can see the code and chat.</p>
          </div>
          <button onClick={leaveRoom} className="px-4 py-2 bg-[#161b22] border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-all">
            Cancel request
          </button>
        </div>
      ) : status !== 'connected' ? (
        /* — Room Setup Screen — */
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
            <Users className="w-8 h-8 text-blue-400" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-white mb-1">Code with your team</h3>
            <p className="text-sm text-white/40">Create a room or join — joining needs the owner's approval</p>
          </div>

          {!signedIn && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center gap-2 max-w-sm w-full">
              <Users className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">Sign in to create or join a collaboration room.</p>
            </div>
          )}

          {status === 'error' && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-2 max-w-sm w-full">
              <X className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{errorMsg}</p>
            </div>
          )}

          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={createRoom}
              disabled={status === 'connecting' || !signedIn}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            >
              <Plus className="w-4 h-4" /> New Room
            </button>
          </div>

          <div className="flex gap-2 w-full max-w-sm">
            <input
              className="flex-1 bg-[#161b22] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 disabled:opacity-50"
              placeholder="Paste Room ID (e.g. AB1C2D)"
              value={joinInput}
              disabled={!signedIn}
              onChange={e => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter' && joinInput.trim()) joinRoom(joinInput.trim()); }}
            />
            <button
              onClick={() => joinInput.trim() && joinRoom(joinInput.trim())}
              disabled={!joinInput.trim() || status === 'connecting' || !signedIn}
              className="px-4 py-2.5 bg-[#161b22] hover:bg-white/5 border border-white/10 rounded-xl text-sm text-white/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Join
            </button>
          </div>

          <p className="text-[10px] text-white/20 text-center max-w-xs">
            Uses Firestore real-time sync. Share the Room ID with your teammates.
          </p>
        </div>
      ) : (
        /* — Active Room (mobile-friendly tabs: Code / AI / Team) — */
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar — AI switcher: Free / Pro v5 / Professional / Team (scrolls on small phones) */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5 bg-[#161b22]">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {([{ key: 'free', label: 'Free', icon: Sparkles }, { key: 'pro', label: 'Pro v5', icon: Zap }, { key: 'professional', label: 'Professional', icon: Briefcase }, { key: 'team', label: 'Team', icon: Users }] as { key: RoomTab; label: string; icon: any }[]).map(t => {
                const Icon = t.icon; const active = roomTab === t.key; const online = onlineCount;
                return (
                  <button key={t.key} onClick={() => setRoomTab(t.key)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                    <Icon className="w-3.5 h-3.5" /> {t.label}
                    {t.key === 'team' && online > 0 && <span className="text-[9px] bg-white/20 rounded-full px-1.5">{online}</span>}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <button onClick={copyLink} className={`flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-lg border transition-all ${copied ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-white/40 bg-white/5 hover:text-white'}`}>
                {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> <span className="hidden sm:inline">Share ID</span></>}
              </button>
              <button onClick={leaveRoom} className="flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-lg border border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 transition-all">
                <X className="w-3 h-3" /> <span className="hidden sm:inline">Leave</span>
              </button>
            </div>
          </div>

          {/* ── Pro v5 tab — real in-room build (coming soon) ── */}
          {roomTab === 'pro' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <div className="w-14 h-14 bg-violet-500/10 rounded-2xl flex items-center justify-center border border-violet-500/20">
              <Zap className="w-7 h-7 text-violet-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">NavBharatAI Pro v5.0 — in the room</h3>
            <p className="text-xs text-white/40 max-w-xs">Build a real app together — the whole team watches Pro v5.0 build live. <span className="text-amber-400/80 font-medium">Coming soon.</span></p>
          </div>
          )}

          {/* ── Professional tab — owner picks a professional (chat coming soon) ── */}
          {roomTab === 'professional' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#161b22]">
              <Briefcase className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-white/50">Professional</span>
            </div>
            <div className="p-3 border-b border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">
                {isOwner ? 'Choose the professional (owner)' : 'Professional selected by the owner'}
              </p>
              <div className="relative max-w-xs">
                <select
                  value={selectedProfessional}
                  onChange={e => setSelectedProfessional(e.target.value)}
                  disabled={!isOwner}
                  className="w-full appearance-none bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 pr-9 text-sm text-white focus:outline-none focus:border-emerald-500/50 disabled:opacity-60"
                >
                  {ROOM_PROFESSIONALS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 text-white/30 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              {!isOwner && <p className="text-[9px] text-white/25 mt-1.5">Only the room owner can change this.</p>}
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
              <Briefcase className="w-8 h-8 text-emerald-400/40" />
              <p className="text-xs text-white/40 max-w-xs">Shared chat with <span className="text-white/70 font-medium">{ROOM_PROFESSIONALS.find(p => p.id === selectedProfessional)?.label || 'the professional'}</span> for the whole room. <span className="text-amber-400/80 font-medium">Coming soon.</span></p>
            </div>
          </div>
          )}

          {/* ── Free tab — shared NavBharatAI Free thread (Phase 1a) ── */}
          {roomTab === 'free' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#161b22]">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-white/50">NavBharatAI Free — shared</span>
              <span className="text-[9px] text-white/25 ml-auto hidden sm:inline">Everyone pays for their own asks</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {aiMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                  <Sparkles className="w-8 h-8 text-blue-400/40" />
                  <p className="text-xs text-white/30 max-w-xs">Ask NavBharatAI anything — the whole team sees the question and the answer, live.</p>
                </div>
              ) : aiMessages.map(m => (
                <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <span className="text-[8px] text-white/30 mb-0.5 flex items-center gap-1">
                    {m.role === 'assistant' ? <><Bot className="w-2.5 h-2.5 text-blue-400" /> NavBharatAI</> : m.authorName}
                  </span>
                  <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[11px] whitespace-pre-wrap break-words ${m.role === 'assistant' ? 'bg-blue-500/10 border border-blue-500/20 text-white/90' : 'text-white'}`} style={m.role === 'user' ? { backgroundColor: m.color + '30' } : undefined}>
                    {m.text}
                  </div>
                </div>
              ))}
              {aiBusy && (
                <div className="flex items-center gap-2 text-[10px] text-blue-300"><RefreshCw className="w-3 h-3 animate-spin" /> NavBharatAI is thinking…</div>
              )}
              <div ref={aiBottomRef} />
            </div>
            {aiError && <p className="px-3 py-1.5 text-[10px] text-red-300 bg-red-500/10 border-t border-red-500/20">{aiError}</p>}
            <div className="p-2 border-t border-white/5 bg-[#161b22]">
              <div className="flex gap-1.5">
                <input
                  className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-blue-500/40 disabled:opacity-50"
                  placeholder="Ask the shared AI…"
                  value={aiInput}
                  disabled={aiBusy}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendAiPrompt(); }}
                />
                <button onClick={sendAiPrompt} disabled={!aiInput.trim() || aiBusy} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl transition-all">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
          )}

          {/* ── Team tab — members + chat ── */}
          {roomTab === 'team' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#161b22]">
            {/* Join requests — OWNER ONLY: approve or reject pending members */}
            {isOwner && pendingMembers.length > 0 && (
              <div className="p-3 border-b border-white/5 bg-amber-500/5">
                <p className="text-[10px] text-amber-300/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Join requests ({pendingMembers.length})
                </p>
                <div className="space-y-1.5">
                  {pendingMembers.map(m => (
                    <div key={m.id} className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: m.color }}>
                        {m.name[0].toUpperCase()}
                      </div>
                      <p className="text-[10px] text-white truncate flex-1">{m.name}</p>
                      <button onClick={() => approveMember(m.id)} title="Approve" className="px-2 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-[9px] font-medium transition-all flex items-center gap-1">
                        <Check className="w-3 h-3" /> Approve
                      </button>
                      <button onClick={() => removeMember(m.id)} title="Reject" className="p-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Members — approved roster, with live cursor line + owner Kick */}
            <div className="p-3 border-b border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Members ({approvedMembers.length})</p>
              <div className="space-y-1.5">
                {approvedMembers.map(c => {
                  const isMe = c.id === myId;
                  const remote = !isMe ? presence.find(p => p.id === c.id) : null;
                  const online = isMe || !!remote;
                  const line = isMe ? caretLine : remote?.caretLine;
                  return (
                    <div key={c.id} className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: c.color }}>
                        {c.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-white truncate">
                          {c.name} {isMe ? '(you)' : ''}{c.id === roomOwner ? <span className="text-amber-400/80"> · owner</span> : ''}
                        </p>
                        {line != null && (isMe || remote) && (
                          <p className="text-[8px] text-white/35">✎ line {line}</p>
                        )}
                      </div>
                      <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-white/20'}`} title={online ? 'online' : 'offline'} />
                      {isOwner && !isMe && c.id !== roomOwner && (
                        <button onClick={() => removeMember(c.id)} title="Remove from room" className="p-1 rounded hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors shrink-0">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chat */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <p className="text-[10px] text-white/30 uppercase tracking-wider px-3 py-2 border-b border-white/5">Chat</p>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {chatMessages.length === 0 ? (
                  <p className="text-[10px] text-white/20 text-center py-4">Send the first message!</p>
                ) : (
                  chatMessages.map(msg => (
                    <div key={msg.id} className={`flex flex-col ${msg.authorId === myId ? 'items-end' : 'items-start'}`}>
                      <span className="text-[8px] text-white/30 mb-0.5">{msg.authorName}</span>
                      <div className="max-w-[85%] px-2 py-1.5 rounded-xl text-[10px] text-white" style={{ backgroundColor: msg.authorId === myId ? msg.color + '40' : '#ffffff10' }}>
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatBottomRef} />
              </div>
              <div className="p-2 border-t border-white/5">
                <div className="flex gap-1.5">
                  <input
                    className="flex-1 bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white placeholder-white/20 focus:outline-none focus:border-blue-500/40"
                    placeholder="Message..."
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
                  />
                  <button onClick={sendMessage} disabled={!chatInput.trim()} className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-all">
                    <Share2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
