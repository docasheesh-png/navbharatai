import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, 
  RotateCcw, ChevronDown, X, Layers, Keyboard,
  CheckSquare, Eraser
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface CursorPopupProps {
  editor: any;
  onClose: () => void;
  onToggleKeyboard: () => void;
  isKeyboardOpen: boolean;
}

export const CursorPopup: React.FC<CursorPopupProps> = ({ 
  editor, 
  onClose, 
  onToggleKeyboard,
  isKeyboardOpen
}) => {
  const [isChordActive, setIsChordActive] = useState(false);
  const [mode, setMode] = useState<'select' | 'deselect' | 'neutral'>('neutral');
  const [scale, setScale] = useState(1);
  const [isSizeDropdownOpen, setIsSizeDropdownOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const handleAction = (type: 'up' | 'down' | 'left' | 'right' | 'undo' | 'all') => {
    if (!editor) return;
    editor.focus();

    if (type === 'undo') {
      editor.trigger('keyboard', 'undo', {});
      return;
    }

    if (type === 'all') {
      const model = editor.getModel();
      if (!model) return;

      if (isChordActive) {
        editor.executeEdits('cursor-popup', [{
          range: model.getFullModelRange(),
          text: '',
          forceMoveMarkers: true
        }]);
        return;
      }

      const lastLine = model.getLineCount();
      const lastColumn = model.getLineMaxColumn(lastLine);
      editor.setSelection({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: lastLine,
        endColumn: lastColumn
      });
      return;
    }

    if (isChordActive) {
      if (type === 'left') {
        editor.trigger('keyboard', 'deleteLeft', {});
      } else if (type === 'right') {
        editor.trigger('keyboard', 'deleteRight', {});
      } else {
        const commandId = { up: 'cursorUp', down: 'cursorDown' }[type];
        editor.trigger('keyboard', commandId, {});
      }
      return;
    }

    if (mode === 'neutral') {
      const commandId = {
        left: 'cursorLeft',
        right: 'cursorRight',
        up: 'cursorUp',
        down: 'cursorDown',
      }[type];
      editor.trigger('keyboard', commandId, {});
    } else if (mode === 'select') {
      const commandId = {
        left: 'cursorLeftSelect',
        right: 'cursorRightSelect',
        up: 'cursorUpSelect',
        down: 'cursorDownSelect',
      }[type];
      editor.trigger('keyboard', commandId, {});
    } else if (mode === 'deselect') {
      const selection = editor.getSelection();
      let { startLineNumber, startColumn, endLineNumber, endColumn } = selection;
      const model = editor.getModel();
      if (!model) return;

      switch (type) {
        case 'left':
          if (startLineNumber < endLineNumber || startColumn < endColumn) {
            if (startColumn < model.getLineMaxColumn(startLineNumber)) startColumn++;
            else if (startLineNumber < model.getLineCount()) { startLineNumber++; startColumn = 1; }
          }
          break;
        case 'right':
          if (endLineNumber > startLineNumber || endColumn > startColumn) {
            if (endColumn > 1) endColumn--;
            else if (endLineNumber > 1) { endLineNumber--; endColumn = model.getLineMaxColumn(endLineNumber); }
          }
          break;
        case 'up':
           if (endLineNumber > startLineNumber) endLineNumber--;
           else if (endColumn > startColumn) endColumn = startColumn;
           break;
        case 'down':
           if (startLineNumber < endLineNumber) startLineNumber++;
           else if (startColumn < endColumn) startColumn = endColumn;
           break;
      }
      editor.setSelection({ startLineNumber, startColumn, endLineNumber, endColumn });
    }
  };

  const toggleMode = (newMode: 'select' | 'deselect') => {
    setMode(prev => prev === newMode ? 'neutral' : newMode);
  };

  return (
    <motion.div
      ref={popupRef}
      drag
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: scale, y: 0 }}
      exit={{ opacity: 0, scale: 0.5 }}
      style={{
         position: 'absolute',
         zIndex: 9999,
         left: '50%',
         top: '50%',
         transform: 'translate(-50%, -50%)',
      }}
      className={cn(
        "bg-[#161b22]/98 border border-white/10 rounded-2xl shadow-3xl overflow-hidden select-none backdrop-blur-2xl flex flex-col",
        "w-[260px] pointer-events-auto"
      )}
    >
      {/* Row 1: Controller Hub */}
      <div className="grid grid-cols-3 border-b border-white/5 bg-white/[0.02]">
        <button 
          onClick={() => { if(editor) editor.focus(); onClose(); }}
          className="flex flex-col items-center justify-center gap-1.5 py-4 hover:bg-white/5 border-r border-white/5 transition-all group"
        >
          <Keyboard className="w-4 h-4 text-[#8b949e] group-hover:text-white" />
          <span className="text-[7px] font-black uppercase tracking-widest text-[#484f58] group-hover:text-[#8b949e]">Keyboard</span>
        </button>

        <button 
          onClick={() => { onToggleKeyboard(); onClose(); }}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-4 border-r border-white/5 transition-all group",
            isKeyboardOpen ? "bg-indigo-500/10" : "hover:bg-white/5"
          )}
        >
          <Layers className={cn("w-4 h-4 group-hover:text-white", isKeyboardOpen ? "text-indigo-400" : "text-[#8b949e]")} />
          <span className="text-[7px] font-black uppercase tracking-widest text-[#484f58] group-hover:text-[#8b949e]">Shortcut</span>
        </button>

        <button 
          onClick={() => handleAction('undo')}
          className="flex flex-col items-center justify-center gap-1.5 py-4 hover:bg-amber-500/10 transition-all group"
        >
          <RotateCcw className="w-4 h-4 text-[#8b949e] group-hover:text-amber-500 group-active:rotate-[-90deg] transition-transform" />
          <span className="text-[7px] font-black uppercase tracking-widest text-[#484f58] group-hover:text-amber-500">Undo</span>
        </button>
      </div>

      {/* Row 2: Logic Block */}
      <div className="grid grid-cols-3 border-b border-white/5 bg-black/10">
        <button 
          onClick={() => toggleMode('select')}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-3 border-r border-white/5 transition-all group",
            mode === 'select' ? "bg-indigo-500/20 text-indigo-400" : "hover:bg-white/5 text-[#484f58] hover:text-[#8b949e]"
          )}
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span className="text-[7px] font-black uppercase tracking-widest opacity-60">Select</span>
        </button>

        <button 
          onClick={() => toggleMode('deselect')}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-3 border-r border-white/5 transition-all group",
            mode === 'deselect' ? "bg-red-500/20 text-red-400" : "hover:bg-white/5 text-[#484f58] hover:text-[#8b949e]"
          )}
        >
          <Eraser className="w-3.5 h-3.5" />
          <span className="text-[7px] font-black uppercase tracking-widest opacity-60">Deselect</span>
        </button>

        <button 
          onClick={() => setIsChordActive(!isChordActive)}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-3 transition-all",
            isChordActive ? "bg-red-600 text-white shadow-inner font-black" : "hover:bg-white/5 text-[#484f58] hover:text-white"
          )}
        >
          <span className="text-xs font-black italic">C</span>
          <span className="text-[7px] font-black uppercase tracking-widest opacity-40">Chord</span>
        </button>
      </div>

      {/* Row 3: Navigation Strip */}
      <div className="flex items-center p-1.5 gap-1.5 bg-black/40">
        <div className="flex-1 grid grid-cols-5 gap-1">
          <button 
            onClick={() => handleAction('left')}
            className="flex h-9 items-center justify-center bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 active:scale-90 transition-all text-white/40 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('right')}
            className="flex h-9 items-center justify-center bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 active:scale-90 transition-all text-white/40 hover:text-white"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('up')}
            className="flex h-9 items-center justify-center bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 active:scale-90 transition-all text-white/40 hover:text-white"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('down')}
            className="flex h-9 items-center justify-center bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 active:scale-90 transition-all text-white/40 hover:text-white"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('all')}
            className="flex h-9 items-center justify-center bg-indigo-500/10 border border-indigo-500/20 rounded-xl hover:bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase tracking-[0.2em] active:scale-90 transition-all"
          >
            ALL
          </button>
        </div>
      </div>

      {/* Footer / Meta */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-t border-white/5 overflow-visible">
        <div className="flex items-center gap-2">
           <span className="text-[7px] font-black uppercase tracking-[0.4em] text-[#21262d] italic">Bharat Arc Node</span>
           <div className="h-2 w-px bg-white/5" />
           <div className="relative">
              <button 
                onClick={() => setIsSizeDropdownOpen(!isSizeDropdownOpen)}
                className="text-[8px] font-black text-[#484f58] hover:text-[#8b949e] flex items-center gap-0.5"
              >
                {scale}x <ChevronDown className="w-2 h-2" />
              </button>
              <AnimatePresence>
                {isSizeDropdownOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-0 mb-2 bg-[#0d1117] border border-white/10 rounded-lg shadow-2xl overflow-hidden min-w-[60px] z-[10001]"
                  >
                    {[0.5, 1, 2].map(s => (
                      <button
                        key={s}
                        onClick={() => { setScale(s); setIsSizeDropdownOpen(false); }}
                        className={cn(
                          "w-full px-2 py-1.5 text-[8px] font-black text-left hover:bg-white/5 transition-colors",
                          scale === s ? "text-indigo-400 bg-indigo-500/10" : "text-[#8b949e]"
                        )}
                      >
                        {s}X
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
           </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1 hover:bg-white/5 rounded text-[#484f58] hover:text-red-500 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
};
