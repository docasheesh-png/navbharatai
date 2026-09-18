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
        "bg-card border border-line rounded-2xl shadow-3xl overflow-hidden select-none backdrop-blur-2xl flex flex-col",
        "w-[260px] pointer-events-auto"
      )}
    >
      {/* Row 1: Controller Hub */}
      <div className="grid grid-cols-3 border-b border-line bg-raised">
        <button 
          onClick={() => { if(editor) editor.focus(); onClose(); }}
          className="flex flex-col items-center justify-center gap-1.5 py-4 hover:bg-raised border-r border-line transition-all group"
        >
          <Keyboard className="w-4 h-4 text-muted group-hover:text-ink" />
          <span className="text-[7px] font-black uppercase tracking-widest text-faint group-hover:text-muted">Keyboard</span>
        </button>

        <button 
          onClick={() => { onToggleKeyboard(); onClose(); }}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-4 border-r border-line transition-all group",
            isKeyboardOpen ? "bg-indigo-500/10" : "hover:bg-raised"
          )}
        >
          <Layers className={cn("w-4 h-4 group-hover:text-ink", isKeyboardOpen ? "text-accent-text" : "text-muted")} />
          <span className="text-[7px] font-black uppercase tracking-widest text-faint group-hover:text-muted">Shortcut</span>
        </button>

        <button 
          onClick={() => handleAction('undo')}
          className="flex flex-col items-center justify-center gap-1.5 py-4 hover:bg-amber-500/10 transition-all group"
        >
          <RotateCcw className="w-4 h-4 text-muted group-hover:text-warn group-active:rotate-[-90deg] transition-transform" />
          <span className="text-[7px] font-black uppercase tracking-widest text-faint group-hover:text-warn">Undo</span>
        </button>
      </div>

      {/* Row 2: Logic Block */}
      <div className="grid grid-cols-3 border-b border-line bg-well">
        <button 
          onClick={() => toggleMode('select')}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-3 border-r border-line transition-all group",
            mode === 'select' ? "bg-indigo-500/20 text-accent-text" : "hover:bg-raised text-faint hover:text-muted"
          )}
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span className="text-[7px] font-black uppercase tracking-widest opacity-60">Select</span>
        </button>

        <button 
          onClick={() => toggleMode('deselect')}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-3 border-r border-line transition-all group",
            mode === 'deselect' ? "bg-red-500/20 text-danger" : "hover:bg-raised text-faint hover:text-muted"
          )}
        >
          <Eraser className="w-3.5 h-3.5" />
          <span className="text-[7px] font-black uppercase tracking-widest opacity-60">Deselect</span>
        </button>

        <button 
          onClick={() => setIsChordActive(!isChordActive)}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-3 transition-all",
            isChordActive ? "bg-red-600 text-on-accent shadow-inner font-black" : "hover:bg-raised text-faint hover:text-ink"
          )}
        >
          <span className="text-xs font-black italic">C</span>
          <span className="text-[7px] font-black uppercase tracking-widest opacity-40">Chord</span>
        </button>
      </div>

      {/* Row 3: Navigation Strip */}
      <div className="flex items-center p-1.5 gap-1.5 bg-well">
        <div className="flex-1 grid grid-cols-5 gap-1">
          <button 
            onClick={() => handleAction('left')}
            className="flex h-9 items-center justify-center bg-raised border border-line rounded-xl hover:bg-raised-hover active:scale-90 transition-all text-faint hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('right')}
            className="flex h-9 items-center justify-center bg-raised border border-line rounded-xl hover:bg-raised-hover active:scale-90 transition-all text-faint hover:text-ink"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('up')}
            className="flex h-9 items-center justify-center bg-raised border border-line rounded-xl hover:bg-raised-hover active:scale-90 transition-all text-faint hover:text-ink"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('down')}
            className="flex h-9 items-center justify-center bg-raised border border-line rounded-xl hover:bg-raised-hover active:scale-90 transition-all text-faint hover:text-ink"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('all')}
            className="flex h-9 items-center justify-center bg-indigo-500/10 border border-indigo-500/20 rounded-xl hover:bg-indigo-500/20 text-accent-text text-[8px] font-black uppercase tracking-[0.2em] active:scale-90 transition-all"
          >
            ALL
          </button>
        </div>
      </div>

      {/* Footer / Meta */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-raised border-t border-line overflow-visible">
        <div className="flex items-center gap-2">
           <span className="text-[7px] font-black uppercase tracking-[0.4em] text-[#21262d] italic">Bharat Arc Node</span>
           <div className="h-2 w-px bg-raised" />
           <div className="relative">
              <button 
                onClick={() => setIsSizeDropdownOpen(!isSizeDropdownOpen)}
                className="text-[8px] font-black text-faint hover:text-muted flex items-center gap-0.5"
              >
                {scale}x <ChevronDown className="w-2 h-2" />
              </button>
              <AnimatePresence>
                {isSizeDropdownOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-0 mb-2 bg-surface border border-line rounded-lg shadow-2xl overflow-hidden min-w-[60px] z-[10001]"
                  >
                    {[0.5, 1, 2].map(s => (
                      <button
                        key={s}
                        onClick={() => { setScale(s); setIsSizeDropdownOpen(false); }}
                        className={cn(
                          "w-full px-2 py-1.5 text-[8px] font-black text-left hover:bg-raised transition-colors",
                          scale === s ? "text-accent-text bg-indigo-500/10" : "text-muted"
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
          className="p-1 hover:bg-raised rounded text-faint hover:text-danger transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
};
