import React, { useState, useEffect, useRef } from 'react';
import { Users, Video, Wifi, MessageSquare, Share2, Plus, Trash2, X, Check, Copy, Clock, Edit2, Globe, RefreshCw } from 'lucide-react';
import { db } from '../../App';
import { doc, setDoc, getDoc, onSnapshot, collection, addDoc, getDocs, query, orderBy, limit, Timestamp } from 'firebase/firestore';

interface Collaborator {
  id: string;
  name: string;
  color: string;
  online: boolean;
  lastSeen: number;
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
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
const STORAGE_KEY = 'navbharat_collab_room';

function genId() { return Math.random().toString(36).slice(2, 10); }

function shortId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

export function LiveCollaboration({ generatedCode, onCodeUpdate, userId, userName }: Props) {
  const [roomId, setRoomId] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sharedCode, setSharedCode] = useState(generatedCode);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [myName] = useState(userName || 'User_' + genId().slice(0, 4));
  const [myId] = useState(userId || genId());
  const [myColor] = useState(COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [isEditing, setIsEditing] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubChatRef = useRef<(() => void) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setRoomId(saved);
    return () => {
      unsubscribeRef.current?.();
      unsubChatRef.current?.();
    };
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const createRoom = async () => {
    const id = shortId();
    setStatus('connecting');
    try {
      await setDoc(doc(db, 'collab_rooms', id), {
        code: generatedCode,
        createdAt: Date.now(),
        createdBy: myId,
        collaborators: [{ id: myId, name: myName, color: myColor, online: true, lastSeen: Date.now() }],
      });
      localStorage.setItem(STORAGE_KEY, id);
      setRoomId(id);
      await joinRoom(id);
    } catch (e: any) {
      setStatus('error');
      setErrorMsg('Room could not be created: ' + (e.message || 'Unknown error'));
    }
  };

  const joinRoom = async (id: string) => {
    setStatus('connecting');
    try {
      const roomRef = doc(db, 'collab_rooms', id);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        setStatus('error');
        setErrorMsg('Room not found. Check the ID.');
        return;
      }
      const data = roomSnap.data();
      const collabs: Collaborator[] = data.collaborators || [];
      const exists = collabs.find(c => c.id === myId);
      const updated = exists
        ? collabs.map(c => c.id === myId ? { ...c, online: true, lastSeen: Date.now() } : c)
        : [...collabs, { id: myId, name: myName, color: myColor, online: true, lastSeen: Date.now() }];
      await setDoc(roomRef, { ...data, collaborators: updated });

      unsubscribeRef.current = onSnapshot(roomRef, (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setCollaborators(d.collaborators || []);
        if (!isEditing) { setSharedCode(d.code || ''); onCodeUpdate(d.code || ''); }
      });

      const chatRef = collection(db, 'collab_rooms', id, 'chat');
      const chatQ = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
      unsubChatRef.current = onSnapshot(chatQ, (snap) => {
        const msgs: ChatMessage[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
        setChatMessages(msgs);
      });

      setSharedCode(data.code || '');
      onCodeUpdate(data.code || '');
      setActiveRoom(id);
      localStorage.setItem(STORAGE_KEY, id);
      setStatus('connected');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg('Failed to join room: ' + (e.message || 'Check Firestore rules'));
    }
  };

  const leaveRoom = async () => {
    if (!activeRoom) return;
    try {
      const roomRef = doc(db, 'collab_rooms', activeRoom);
      const snap = await getDoc(roomRef);
      if (snap.exists()) {
        const d = snap.data();
        const updated = (d.collaborators || []).map((c: Collaborator) =>
          c.id === myId ? { ...c, online: false, lastSeen: Date.now() } : c
        );
        await setDoc(roomRef, { ...d, collaborators: updated });
      }
    } catch {}
    unsubscribeRef.current?.();
    unsubChatRef.current?.();
    setActiveRoom(null);
    setStatus('idle');
    setCollaborators([]);
    setChatMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleCodeChange = (code: string) => {
    setSharedCode(code);
    setIsEditing(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsEditing(false);
      if (!activeRoom) return;
      try {
        await setDoc(doc(db, 'collab_rooms', activeRoom), { code }, { merge: true });
        onCodeUpdate(code);
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
          <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-pulse' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-white/20'}`} />
          <span className={`text-xs ${status === 'connected' ? 'text-emerald-400' : status === 'connecting' ? 'text-amber-400' : 'text-white/40'}`}>
            {status === 'connected' ? `Room: ${activeRoom}` : status === 'connecting' ? 'Connecting...' : 'Not connected'}
          </span>
        </div>
      </div>

      {status !== 'connected' ? (
        /* — Room Setup Screen — */
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
            <Users className="w-8 h-8 text-blue-400" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-white mb-1">Code with your team</h3>
            <p className="text-sm text-white/40">Create a room or join an existing one</p>
          </div>

          {status === 'error' && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-2 max-w-sm w-full">
              <X className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{errorMsg}</p>
            </div>
          )}

          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={createRoom}
              disabled={status === 'connecting'}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            >
              <Plus className="w-4 h-4" /> New Room
            </button>
          </div>

          <div className="flex gap-2 w-full max-w-sm">
            <input
              className="flex-1 bg-[#161b22] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50"
              placeholder="Paste Room ID (e.g. AB1C2D)"
              value={joinInput}
              onChange={e => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter' && joinInput.trim()) joinRoom(joinInput.trim()); }}
            />
            <button
              onClick={() => joinInput.trim() && joinRoom(joinInput.trim())}
              disabled={!joinInput.trim() || status === 'connecting'}
              className="px-4 py-2.5 bg-[#161b22] hover:bg-white/5 border border-white/10 rounded-xl text-sm text-white/60 disabled:opacity-40 transition-all"
            >
              Join
            </button>
          </div>

          <p className="text-[10px] text-white/20 text-center max-w-xs">
            Uses Firestore real-time sync. Share the Room ID with your teammates.
          </p>
        </div>
      ) : (
        /* — Active Room — */
        <div className="flex flex-1 overflow-hidden">
          {/* Code Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-[#161b22]">
              <div className="flex items-center gap-2">
                <Edit2 className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs text-white/50">Shared Code</span>
                {isEditing && <span className="text-[9px] text-amber-400 animate-pulse">Syncing...</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={copyLink} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all ${copied ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-white/40 bg-white/5'}`}>
                  {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Share Room ID</>}
                </button>
                <button onClick={leaveRoom} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 transition-all">
                  <X className="w-3 h-3" /> Leave
                </button>
              </div>
            </div>
            <textarea
              className="flex-1 bg-[#0d1117] font-mono text-xs text-white/80 p-4 resize-none focus:outline-none"
              value={sharedCode}
              onChange={e => handleCodeChange(e.target.value)}
              placeholder="Write code here — all members see it live..."
            />
          </div>

          {/* Right Panel: Collaborators + Chat */}
          <div className="w-64 flex flex-col border-l border-white/5 bg-[#161b22]">
            {/* Collaborators */}
            <div className="p-3 border-b border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Online ({collaborators.filter(c => c.online).length})</p>
              <div className="space-y-1.5">
                {collaborators.map(c => (
                  <div key={c.id} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: c.color }}>
                      {c.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-white truncate">{c.name} {c.id === myId ? '(you)' : ''}</p>
                    </div>
                    <div className={`w-1.5 h-1.5 rounded-full ${c.online ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  </div>
                ))}
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
        </div>
      )}
    </div>
  );
}
