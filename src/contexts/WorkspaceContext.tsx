// Tasks 1.2 + 1.3 — React Context API + Centralized WorkspaceContext
// Holds the core shared state that crosses module boundaries.
// App.tsx wraps its tree with <WorkspaceProvider> and reads state via useWorkspace().

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ViewType, FileSystem, Message } from '../types';
import type { User as FirebaseUser } from 'firebase/auth';

const BLANK_PREVIEW = '<!DOCTYPE html><html><body style="background:#0d1117;color:#8b949e;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0"><div><h2 style="color:white">Waiting for magic...</h2><p>Ask Navbharat to build something!</p></div></body></html>';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceContextValue {
  // Auth
  user: FirebaseUser | null;
  setUser: (u: FirebaseUser | null) => void;
  loadingUser: boolean;
  setLoadingUser: (v: boolean) => void;

  // Navigation
  activeView: ViewType;
  setActiveView: (v: ViewType) => void;
  openTabs: ViewType[];
  setOpenTabs: React.Dispatch<React.SetStateAction<ViewType[]>>;

  // Agent
  activeAgent: string;
  setActiveAgent: (agent: string) => void;

  // Messages — single source of truth (Task 1.4)
  messagesMap: Record<string, Message[]>;
  setTabMessages: (tabId: string, msgs: Message[] | ((prev: Message[]) => Message[])) => void;
  getTabMessages: (tabId: string) => Message[];

  // Preview
  generatedCode: string;
  setGeneratedCode: (code: string) => void;
  hasGeneratedCode: boolean;
  setHasGeneratedCode: (v: boolean) => void;
  isAppBuilt: boolean;
  setIsAppBuilt: (v: boolean) => void;

  // Files
  files: FileSystem;
  setFiles: React.Dispatch<React.SetStateAction<FileSystem>>;
  activeFile: string;
  setActiveFile: (f: string) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeView, setActiveView] = useState<ViewType>('home');
  const [openTabs, setOpenTabs] = useState<ViewType[]>([]);
  const [activeAgent, _setActiveAgent] = useState<string>(
    () => localStorage.getItem('activeAgent') || 'navbharatai'
  );

  // Task 1.4 — messagesMap: single source of truth per tab
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({
    nbi_chat:     [],
    nbi_pro_chat: [],
  });

  const setTabMessages = useCallback(
    (tabId: string, msgs: Message[] | ((prev: Message[]) => Message[])) => {
      setMessagesMap(prev => ({
        ...prev,
        [tabId]: typeof msgs === 'function' ? msgs(prev[tabId] || []) : msgs,
      }));
    },
    []
  );

  const getTabMessages = useCallback(
    (tabId: string): Message[] => messagesMap[tabId] || [],
    [messagesMap]
  );

  // Preview
  const [generatedCode, setGeneratedCode] = useState<string>(BLANK_PREVIEW);
  const [hasGeneratedCode, setHasGeneratedCode] = useState(false);
  const [isAppBuilt, setIsAppBuilt] = useState(false);

  // Files
  const [files, setFiles] = useState<FileSystem>({ 'index.html': '' });
  const [activeFile, setActiveFile] = useState<string>('index.html');

  const setActiveAgent = useCallback((agent: string) => {
    _setActiveAgent(agent);
    localStorage.setItem('activeAgent', agent);
  }, []);

  const value: WorkspaceContextValue = {
    user, setUser, loadingUser, setLoadingUser,
    activeView, setActiveView, openTabs, setOpenTabs,
    activeAgent, setActiveAgent,
    messagesMap, setTabMessages, getTabMessages,
    generatedCode, setGeneratedCode, hasGeneratedCode, setHasGeneratedCode,
    isAppBuilt, setIsAppBuilt,
    files, setFiles, activeFile, setActiveFile,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
