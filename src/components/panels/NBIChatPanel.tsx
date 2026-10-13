import React from 'react';
import { SURFACE_TITLE_CLASS } from '../chat/conversation';
import { cn } from '../../lib/utils';
import { AIChat } from '../ide/AIChat';
import type { ThemeMode } from '../../lib/theme';
import type { Message, ChatSession, AgentMode } from '../../types';
import type { User as FirebaseUser } from 'firebase/auth';

export interface NBIChatPanelProps {
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
  isAppBuilt: boolean;
  theme: ThemeMode;
  onPreviewClick: () => void;
  /** Downloads the files a reply built — the deploy row under a build (Q-781). */
  onDownloadZip?: (files: Record<string, string>, appName: string) => void;
  wallet: any;
  setPreferredLanguage: (lang: any) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /**
   * Start a fresh conversation. Absent ⇒ the control is not rendered at all — a New chat button with
   * nothing behind it is the dead button this codebase keeps deleting.
   */
  onNewChat?: () => void;
  /**
   * Open the Mode picker from the composer (desktop). Absent ⇒ no button — App.tsx omits it while
   * the mobile bottom bar, which already carries Mode, is on screen. See AIChat's prop of the same name.
   */
  onOpenModePicker?: () => void;
  /**
   * Open chat history from the composer (desktop). Absent ⇒ no button — App.tsx omits it while the
   * mobile bottom bar, which already carries History, is on screen. See HistoryButton.tsx.
   */
  onOpenHistory?: () => void;
}

export const NBIChatPanel: React.FC<NBIChatPanelProps> = ({
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
  isAppBuilt,
  theme,
  onPreviewClick,
  onDownloadZip,
  wallet,
  setPreferredLanguage,
  setMessages,
  onNewChat,
  onOpenModePicker,
  onOpenHistory,
}) => {
  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className={cn(
      "flex-1 overflow-hidden h-full min-h-0 max-h-full relative group flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-line bg-surface"
    )}>
      {/* NBI Chat column */}
      <div className="flex-1 flex flex-col h-full min-h-0 max-h-full overflow-hidden min-w-0">
        {/* A quiet title bar (admin 2026-10-13, "claude jaisa"): the name in the serif, no caps, no ping. */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-line text-sm text-muted">
          <div className="flex items-center gap-2">
            <span className={SURFACE_TITLE_CLASS}>NavBharatAI</span>
          </div>
          <div className="flex items-center gap-2">
            {/* START A NEW CHAT (admin 2026-08-23: "free me new chat kaise start hogi? koi option
                banaya hai? nahi banaya hai").

                🔒 SAFE BY CONSTRUCTION, and worth saying why. `startNewChat` mints a NEW session id
                before it clears anything. That ordering is the whole thing: the transcript is
                auto-saved to History keyed by the CURRENT id, so clearing the messages WITHOUT a new
                id would make the user's next message overwrite the conversation they just left. With
                the new id, the old chat stays in History, intact and reopenable — which is also why
                this needs no "are you sure": nothing is lost to confirm about.

                Shown only when the caller supplies the handler, so it can never be a dead button. */}
            {onNewChat && (
              <button
                onClick={onNewChat}
                title="Start a new chat — this conversation stays saved in History"
                className="flex items-center gap-1 px-2.5 py-1 rounded-full border bg-raised border-line text-xs font-medium text-muted hover:text-ink transition-colors"
              >
                <span>＋</span>
                <span className="hidden sm:inline">New</span>
              </button>
            )}
            <button
              onClick={() => setTeachMode(p => !p)}
              title={teachMode ? 'Teaching Mode ON — click to turn off' : 'Teaching Mode OFF — click to enable beginner explanations'}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                teachMode ? 'bg-amber-500/20 border-amber-500/40 text-warn' : 'bg-raised border-line text-muted hover:text-ink'
              }`}
            >
              <span>{teachMode ? '📚' : '🎓'}</span>
              <span className="hidden sm:inline">Teach</span>
            </button>
          </div>
        </div>
        <AIChat
          messages={messages}
          // The greeting addresses the account by its first name (chat/greeting.ts).
          userName={user?.displayName ?? null}
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
          onOpenModePicker={onOpenModePicker}
          onOpenHistory={onOpenHistory}
          activeAgent={activeAgent}
          isAppBuilt={isAppBuilt}
          theme={theme}
          onPreviewClick={onPreviewClick}
          onDownloadZip={onDownloadZip}
          userId={user?.uid}
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
