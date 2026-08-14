import React from 'react';
import { cn } from '../../lib/utils';
import { AIChat } from '../ide/AIChat';
import type { ThemeMode } from '../../lib/theme';
import type { Message, ChatSession, AgentMode } from '../../types';
import type { User as FirebaseUser } from 'firebase/auth';

export interface NBIChatPanelProps {
  themeClasses: {
    bg: string;
    text: string;
    border: string;
    accent: string;
    card: string;
    raw: { bg: string; text: string; border: string; card: string };
  };
  teachMode: boolean;
  setTeachMode: React.Dispatch<React.SetStateAction<boolean>>;
  sessions: ChatSession[];
  currentSessionId: string;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  onSend: (files?: File[]) => void;
  /** Stop the reply that is streaming now (admin 2026-08-13). */
  onStop?: () => void;
  /** Take back the last message (stop + remove the last exchange). */
  onUnsend?: () => void;
  isLoading: boolean;
  activeIntent: string;
  togglePin: (sessionId: string) => void;
  user: FirebaseUser | null;
  setShowAuth: (v: boolean) => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  activeAgent: string;
  pendingGHEdit: { path: string; content: string; message: string; sha?: string } | null;
  onConfirmPush: () => void;
  isPushing: boolean;
  isAppBuilt: boolean;
  theme: ThemeMode;
  onPreviewClick: () => void;
  onRestoreUci?: (uci: string) => Promise<boolean>;
  wallet: any;
  setPreferredLanguage: (lang: any) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export const NBIChatPanel: React.FC<NBIChatPanelProps> = ({
  themeClasses,
  teachMode,
  setTeachMode,
  sessions,
  currentSessionId,
  messages,
  input,
  setInput,
  onSend,
  onStop,
  onUnsend,
  isLoading,
  activeIntent,
  togglePin,
  user,
  setShowAuth,
  mode,
  setMode,
  activeAgent,
  pendingGHEdit,
  onConfirmPush,
  isPushing,
  isAppBuilt,
  theme,
  onPreviewClick,
  onRestoreUci,
  wallet,
  setPreferredLanguage,
  setMessages,
}) => {
  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className={cn(
      "flex-1 overflow-hidden h-full min-h-0 max-h-full relative group flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/10",
      themeClasses.bg
    )}>
      {/* NBI Chat column */}
      <div className="flex-1 flex flex-col h-full min-h-0 max-h-full overflow-hidden min-w-0">
        <div className="flex items-center justify-between px-3 py-1 bg-indigo-950/20 border-b border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-[#8b949e]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping shrink-0" />
            <span>NAVBHARATAI</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTeachMode(p => !p)}
              title={teachMode ? 'Teaching Mode ON — click to turn off' : 'Teaching Mode OFF — click to enable beginner explanations'}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-widest transition-all ${
                teachMode ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-white/5 border-white/10 text-[#484f58] hover:text-white'
              }`}
            >
              <span>{teachMode ? '📚' : '🎓'}</span>
              <span className="hidden sm:inline">Teach</span>
            </button>
            <span className="font-mono text-indigo-400 hidden sm:inline">{currentSession?.uci || ''}</span>
          </div>
        </div>
        <AIChat
          messages={messages}
          input={input}
          onInputChange={setInput}
          onSend={onSend}
          onStop={onStop}
          onUnsend={onUnsend}
          // Lets the chat's Clear and its per-message delete/edit act for real (admin 2026-08-10).
          // Clear previously fired a magic-string sentinel through a prop nothing ever passed, so
          // the button did nothing at all; this panel owns setMessages, so it can simply honour it.
          onMessagesChange={(next) => setMessages(next)}
          isLoading={isLoading}
          activeIntent={activeIntent}
          isPinned={currentSession?.isPinned || false}
          onTogglePin={() => togglePin(currentSessionId)}
          isLoggedIn={!!user}
          onShowLogin={() => setShowAuth(true)}
          mode={mode}
          onModeChange={setMode}
          activeAgent={activeAgent}
          pendingGHEdit={pendingGHEdit}
          onConfirmPush={onConfirmPush}
          isPushing={isPushing}
          isAppBuilt={isAppBuilt}
          theme={theme}
          onPreviewClick={onPreviewClick}
          userId={user?.uid}
          activeUci={user ? (currentSession?.uci || '') : ''}
          onRestoreUci={user ? onRestoreUci : undefined}
          restoredMessages={currentSession?.restoredMessages || []}
          memorySummary={currentSession?.memorySummary || ''}
          wallet={wallet}
          onLanguagePick={(lang) => {
            setPreferredLanguage(lang as any);
            setMessages(prev => [
              ...prev.filter(m => m.id !== 'lang-picker'),
              {
                id: 'lang-confirmed',
                text: `✅ Language set! I'll now communicate with you in **${
                  lang === 'hindi' ? '🇮🇳 Hindi'
                  : lang === 'hinglish' ? '🔀 Hinglish'
                  : lang === 'english' ? '🇬🇧 English'
                  : '🌐 your language (auto-detect)'
                }**.\n\nCode will always be written in professional English.\n\nHow can I help you?`,
                sender: 'ai',
                timestamp: new Date(),
                modelUsed: 'navBharatAI',
              },
            ]);
          }}
        />
      </div>
    </div>
  );
};
