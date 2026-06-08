import React, { useEffect, useRef } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import { cn } from '../../lib/utils';
import { 
  X, Play, Bug, Save, FileCode, Check, 
  ChevronRight, MoreVertical, Layout
} from 'lucide-react';
import { Tab } from '../../types/ide';

// Configure Monaco to load from a faster CDN or local if possible, 
// using the default which is usually CDN.
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

interface EditorProps {
  content: string;
  language: string;
  fileName: string;
  openTabs: Tab[];
  activeTab: string;
  onChange: (value: string) => void;
  onTabChange: (path: string) => void;
  onTabClose: (path: string) => void;
  onMount?: (editor: any) => void;
  onRun?: () => void;
  onDebug?: () => void;
}

export const Editor: React.FC<EditorProps> = React.memo(({ 
  content, 
  language, 
  fileName,
  openTabs,
  activeTab,
  onChange, 
  onTabChange,
  onTabClose,
  onMount,
  onRun, 
  onDebug 
}) => {
  const editorRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (onMount) onMount(null);
    };
  }, [onMount]);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    if (onMount) onMount(editor);
  };

  const getLanguage = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx': return 'javascript';
      case 'ts':
      case 'tsx': return 'typescript';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'py': return 'python';
      case 'json': return 'json';
      case 'md': return 'markdown';
      default: return 'plaintext';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] overflow-hidden">
      {/* Tab bar */}
      <div className="h-9 bg-[#252526] flex items-center overflow-x-auto no-scrollbar shrink-0 select-none">
        {openTabs.map((tab) => {
          const isActive = tab.path === activeTab;
          return (
            <div
              key={tab.path}
              onClick={() => onTabChange(tab.path)}
              className={cn(
                "h-full flex items-center px-3 gap-2 border-r border-[#1e1e1e] cursor-pointer min-w-[120px] max-w-[200px] transition-all group",
                isActive ? "bg-[#1e1e1e] text-white" : "bg-[#2d2d2d] text-[#969696] hover:bg-[#2a2d2e]"
              )}
            >
              <FileCode className={cn("w-3.5 h-3.5", isActive ? "text-indigo-400" : "text-[#858585]")} />
              <span className={cn("text-[11px] truncate flex-1", isActive ? "font-medium" : "")}>
                {tab.path}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.path);
                }}
                className={cn(
                  "p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity",
                  isActive && "opacity-100"
                )}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor Header / Breadcrumbs */}
      <div className="h-6 bg-[#1e1e1e] border-b border-white/5 flex items-center justify-between px-4 shrink-0 text-[#858585] select-none">
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-tight">
           <span>Project Root</span>
           <ChevronRight className="w-3 h-3" />
           <span className="text-white">{fileName}</span>
        </div>
        <div className="flex items-center gap-3">
            {onDebug && (
               <button 
                 onClick={onDebug}
                 className="hover:text-amber-500 transition-all"
                 title="Preview Debug"
               >
                 <Bug className="w-3.5 h-3.5" />
               </button>
            )}
            {onRun && (
               <button 
                 onClick={onRun}
                 className="text-emerald-500 hover:text-emerald-400 transition-all flex items-center gap-1"
                 title="Run Project"
               >
                 <Play className="w-3.5 h-3.5 fill-current" />
               </button>
            )}
            <Layout className="w-3.5 h-3.5 hover:text-white cursor-pointer" />
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden relative">
        <MonacoEditor
          height="100%"
          path={fileName}
          language={getLanguage(fileName)}
          value={content}
          theme="vs-dark"
          onMount={handleEditorDidMount}
          onChange={(val) => onChange(val || '')}
          options={{
            minimap: { enabled: true },
            fontSize: 14,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 10 },
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            renderLineHighlight: 'all',
            lineNumbers: 'on',
            bracketPairColorization: { enabled: true },
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            formatOnType: true,
            formatOnPaste: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
          }}
        />
      </div>

      {/* Mobile Input Helper Toolbar - Hidden on desktop */}
      <div className="md:hidden h-10 bg-[#252526] border-t border-white/5 flex items-center px-1 overflow-x-auto no-scrollbar gap-1 shrink-0">
          {['{', '}', '(', ')', '[', ']', ';', ':', '"', "'", '<', '>', '/', '=', '+', '-', '*', '_'].map((char, i) => (
            <button
              key={i}
              onClick={() => {
                if (editorRef.current) {
                  const selection = editorRef.current.getSelection();
                  const range = new (window as any).monaco.Range(
                    selection.startLineNumber,
                    selection.startColumn,
                    selection.endLineNumber,
                    selection.endColumn
                  );
                  editorRef.current.executeEdits('helper', [{ range, text: char, forceMoveMarkers: true }]);
                }
              }}
              className="min-w-[32px] h-8 bg-white/5 rounded-lg text-white font-mono text-xs flex items-center justify-center border border-white/5"
            >
              {char}
            </button>
          ))}
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.content === next.content && 
         prev.fileName === next.fileName && 
         prev.activeTab === next.activeTab &&
         prev.openTabs.length === next.openTabs.length;
});
