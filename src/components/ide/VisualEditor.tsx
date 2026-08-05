import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MousePointer2, Layers, ChevronRight, ChevronDown,
  Type, Palette, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, Bold, Italic, RotateCcw, PanelRight,
  PanelRightClose, ListTree
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { LAYOUT_MODES, isFlex, isLayoutMode } from './visualLayout';

interface VisualEditorProps {
  html: string;
  onHtmlChange: (html: string) => void;
}

interface ElementInfo {
  tag: string;
  id: string | null;
  classes: string[];
  path: number[];
  styles: Record<string, string>;
  textContent: string;
}

interface TreeNode {
  tag: string;
  id: string | null;
  classes: string[];
  path: number[];
  children: TreeNode[];
}

// Injected into iframe to enable visual selection and editing
const EDITOR_SCRIPT = `
<script id="__navbharat_ve__">(function(){
  if(window.__ve_init__) return; window.__ve_init__ = true;
  let sel=null, hov=null;
  const s=document.createElement('style');
  s.id='__ve_style__';
  s.textContent='.__ve_h__{outline:2px dashed #6366f1!important;outline-offset:2px!important;cursor:pointer!important;}.__ve_s__{outline:3px solid #6366f1!important;outline-offset:2px!important;}.__ve_e__{outline:2px solid #10b981!important;background:rgba(16,185,129,.06)!important;}';
  document.head.appendChild(s);

  function getPath(el){
    const p=[];let cur=el;
    while(cur&&cur!==document.body){
      const par=cur.parentElement;if(!par)break;
      p.unshift(Array.from(par.children).indexOf(cur));cur=par;
    }
    return p;
  }
  function byPath(path){
    let el=document.body;
    for(const i of path){if(!el.children[i])return null;el=el.children[i];}
    return el;
  }
  function toHex(rgb){
    if(!rgb||rgb==='transparent'||rgb==='rgba(0, 0, 0, 0)')return null;
    const m=rgb.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if(!m)return null;
    return '#'+[m[1],m[2],m[3]].map(n=>parseInt(n).toString(16).padStart(2,'0')).join('');
  }
  function getStyles(el){
    const cs=window.getComputedStyle(el);
    return{
      color:toHex(cs.color)||'#000000',
      backgroundColor:toHex(cs.backgroundColor)||'transparent',
      fontSize:cs.fontSize,fontWeight:cs.fontWeight,
      textAlign:cs.textAlign,
      padding:cs.padding,paddingTop:cs.paddingTop,paddingRight:cs.paddingRight,
      paddingBottom:cs.paddingBottom,paddingLeft:cs.paddingLeft,
      borderRadius:cs.borderRadius,opacity:cs.opacity,
      display:cs.display,width:cs.width,height:cs.height,
      marginTop:cs.marginTop,marginRight:cs.marginRight,
      marginBottom:cs.marginBottom,marginLeft:cs.marginLeft,
      flexDirection:cs.flexDirection,justifyContent:cs.justifyContent,
      alignItems:cs.alignItems,flexWrap:cs.flexWrap,gap:cs.gap||cs.columnGap,
    };
  }
  function sendSel(el){
    window.parent.postMessage({
      type:'veElementSelected',tag:el.tagName.toLowerCase(),
      id:el.id||null,classes:Array.from(el.classList).filter(c=>!c.startsWith('__ve_')),
      path:getPath(el),styles:getStyles(el),
      textContent:(el.textContent||'').trim().slice(0,120),
    },'*');
  }
  function buildTree(el,d){
    if(d>4)return null;
    const tag=el.tagName.toLowerCase();
    if(['script','style','meta','link','noscript'].includes(tag))return null;
    const ch=[];
    for(const c of el.children){const n=buildTree(c,d+1);if(n)ch.push(n);}
    return{tag,id:el.id||null,classes:Array.from(el.classList).filter(c=>!c.startsWith('__ve_')),path:getPath(el),children:ch};
  }
  function sendTree(){
    const tree=[];
    for(const c of document.body.children){const n=buildTree(c,0);if(n)tree.push(n);}
    window.parent.postMessage({type:'veTree',tree},'*');
  }
  function cloneHtml(){
    const clone=document.documentElement.cloneNode(true);
    const vs=clone.querySelector('#__ve_style__');if(vs)vs.remove();
    const sc=clone.querySelector('#__navbharat_ve__');if(sc)sc.remove();
    clone.querySelectorAll('.__ve_s__,.__ve_h__,.__ve_e__').forEach(el=>{
      el.classList.remove('__ve_s__','__ve_h__','__ve_e__');
    });
    window.parent.postMessage({type:'veHtmlUpdate',html:'<!DOCTYPE html>'+clone.outerHTML},'*');
  }
  const SEL='[id],section,div,header,main,footer,nav,article,p,h1,h2,h3,h4,h5,h6,button,a,span,li,ul,ol,form,input,img,table,tr,td,th';
  document.body.addEventListener('mouseover',e=>{
    const el=e.target.closest(SEL);
    if(!el||el===document.body)return;
    if(hov&&hov!==sel)hov.classList.remove('__ve_h__');
    if(el!==sel){hov=el;el.classList.add('__ve_h__');}
  },true);
  document.body.addEventListener('mouseout',e=>{
    if(hov&&hov!==sel){hov.classList.remove('__ve_h__');hov=null;}
  },true);
  document.body.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    const el=e.target.closest(SEL);
    if(!el||el===document.body)return;
    if(sel){sel.classList.remove('__ve_s__');}
    sel=el;el.classList.add('__ve_s__');
    sendSel(el);
  },true);
  document.body.addEventListener('dblclick',e=>{
    e.preventDefault();e.stopPropagation();
    const el=e.target.closest('p,h1,h2,h3,h4,h5,h6,span,a,li,button,td,th,label,div');
    if(!el)return;
    el.contentEditable='true';el.classList.add('__ve_e__');el.focus();
    const onBlur=()=>{
      el.contentEditable='false';el.classList.remove('__ve_e__');
      el.removeEventListener('blur',onBlur);cloneHtml();
    };
    el.addEventListener('blur',onBlur);
  },true);
  window.addEventListener('message',e=>{
    if(!e.data||e.data.__src!=='nbve')return;
    if(e.data.type==='applyStyle'&&sel){
      const{prop,val}=e.data;
      sel.style[prop]=val;
      cloneHtml();sendSel(sel);
    }
    if(e.data.type==='getTree')sendTree();
    if(e.data.type==='selectByPath'){
      const el=byPath(e.data.path);
      if(el){if(sel)sel.classList.remove('__ve_s__');sel=el;el.classList.add('__ve_s__');el.scrollIntoView({behavior:'smooth',block:'nearest'});sendSel(el);}
    }
    if(e.data.type==='resetSel'){
      if(sel){sel.classList.remove('__ve_s__');sel=null;}
    }
  });
  if(document.readyState==='complete'||document.readyState==='interactive')sendTree();
  else window.addEventListener('load',sendTree);
})();<\/script>`;

function injectEditorScript(html: string): string {
  if (!html) return html;
  // Remove any previous injection
  const cleaned = html.replace(/<script id="__navbharat_ve__">[\s\S]*?<\/script>/g, '');
  // Inject before </body> or at end
  if (cleaned.includes('</body>')) {
    return cleaned.replace('</body>', EDITOR_SCRIPT + '</body>');
  }
  return cleaned + EDITOR_SCRIPT;
}

function parsePx(val: string): number {
  return parseFloat(val) || 0;
}

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
}
const PropertyRow: React.FC<PropertyRowProps> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2 py-1.5 border-b border-white/5">
    <span className="text-[10px] text-[#8b949e] uppercase tracking-widest font-bold shrink-0 w-20">{label}</span>
    <div className="flex items-center gap-1 flex-1 justify-end">{children}</div>
  </div>
);

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  onSelect: (path: number[]) => void;
  selectedPath: number[];
}
const TreeItem: React.FC<TreeItemProps> = ({ node, depth, onSelect, selectedPath }) => {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = JSON.stringify(node.path) === JSON.stringify(selectedPath);
  const label = node.id ? `#${node.id}` : node.classes[0] ? `.${node.classes[0]}` : `<${node.tag}>`;
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          'flex items-center gap-1 py-1 cursor-pointer hover:bg-white/5 rounded-md transition-colors text-[11px] group select-none',
          isSelected && 'bg-indigo-600/20 text-indigo-300'
        )}
        onClick={() => onSelect(node.path)}
      >
        {hasChildren ? (
          <button
            className="w-4 h-4 text-[#484f58] hover:text-white shrink-0 flex items-center justify-center"
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={cn('font-mono text-[10px]', isSelected ? 'text-indigo-300' : 'text-[#8b949e] group-hover:text-[#c9d1d9]')}>
          {label}
        </span>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <TreeItem key={i} node={child} depth={depth + 1} onSelect={onSelect} selectedPath={selectedPath} />
          ))}
        </div>
      )}
    </div>
  );
};

export const VisualEditor: React.FC<VisualEditorProps> = ({ html, onHtmlChange }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [selectedEl, setSelectedEl] = useState<ElementInfo | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [showTree, setShowTree] = useState(true);
  const [showProps, setShowProps] = useState(true);
  const [injectedHtml, setInjectedHtml] = useState('');
  const pendingUpdate = useRef(false);

  // Inject editor script whenever html changes
  useEffect(() => {
    setInjectedHtml(injectEditorScript(html));
  }, [html]);

  // After iframe loads, request tree
  const onIframeLoad = useCallback(() => {
    setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage({ __src: 'nbve', type: 'getTree' }, '*');
    }, 100);
  }, []);

  // Listen for messages from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      const { type } = e.data;
      if (type === 'veElementSelected') {
        setSelectedEl({
          tag: e.data.tag,
          id: e.data.id,
          classes: e.data.classes,
          path: e.data.path,
          styles: e.data.styles,
          textContent: e.data.textContent,
        });
      } else if (type === 'veTree') {
        setTree(e.data.tree || []);
      } else if (type === 'veHtmlUpdate') {
        if (!pendingUpdate.current) {
          pendingUpdate.current = true;
          // Defer slightly so iframe finishes its style apply
          setTimeout(() => {
            onHtmlChange(e.data.html);
            pendingUpdate.current = false;
          }, 50);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onHtmlChange]);

  const applyStyle = useCallback((prop: string, val: string) => {
    iframeRef.current?.contentWindow?.postMessage({ __src: 'nbve', type: 'applyStyle', prop, val }, '*');
    // Optimistically update local state
    setSelectedEl(prev => prev ? { ...prev, styles: { ...prev.styles, [prop]: val } } : prev);
  }, []);

  const selectByPath = useCallback((path: number[]) => {
    iframeRef.current?.contentWindow?.postMessage({ __src: 'nbve', type: 'selectByPath', path }, '*');
  }, []);

  const getNumericStyle = (key: string) => {
    const val = selectedEl?.styles[key] || '0px';
    return parsePx(val);
  };

  const getColorStyle = (key: string) => {
    const val = selectedEl?.styles[key] || '';
    if (!val || val === 'transparent') return '#ffffff';
    return val;
  };

  return (
    <div className="flex h-full bg-[#0d1117] overflow-hidden">
      {/* Component Tree */}
      {showTree && (
        <div className="w-48 border-r border-white/5 flex flex-col shrink-0 bg-[#0d1117]">
          <div className="h-9 flex items-center justify-between px-3 border-b border-white/5 shrink-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#484f58] flex items-center gap-1.5">
              <ListTree className="w-3 h-3" /> Structure
            </span>
          </div>
          <div className="flex-1 overflow-y-auto py-1 px-1 scrollbar-thin">
            {tree.length === 0 ? (
              <p className="text-[10px] text-[#484f58] px-3 py-4 text-center">No elements yet</p>
            ) : (
              tree.map((node, i) => (
                <TreeItem
                  key={i}
                  node={node}
                  depth={0}
                  onSelect={selectByPath}
                  selectedPath={selectedEl?.path || []}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Main iframe */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Toolbar */}
        <div className="h-9 bg-[#161b22] border-b border-white/5 flex items-center px-3 gap-2 shrink-0">
          <button
            onClick={() => setShowTree(s => !s)}
            title="Toggle Structure Tree"
            className={cn('p-1.5 rounded-md transition-colors', showTree ? 'bg-indigo-600/20 text-indigo-400' : 'text-[#484f58] hover:text-white hover:bg-white/5')}
          >
            <ListTree className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1 flex items-center gap-1 min-w-0">
            {selectedEl ? (
              <div className="flex items-center gap-1 text-[10px] font-mono text-[#8b949e] min-w-0">
                <MousePointer2 className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="text-indigo-300">&lt;{selectedEl.tag}&gt;</span>
                {selectedEl.id && <span className="text-amber-400">#{selectedEl.id}</span>}
                {selectedEl.classes.slice(0, 2).map(c => (
                  <span key={c} className="text-emerald-400">.{c}</span>
                ))}
                {selectedEl.textContent && (
                  <span className="text-[#484f58] truncate ml-1">"{selectedEl.textContent.slice(0, 30)}"</span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-[#484f58]">Click any element to select</span>
            )}
          </div>
          {selectedEl && (
            <button
              onClick={() => {
                iframeRef.current?.contentWindow?.postMessage({ __src: 'nbve', type: 'resetSel' }, '*');
                setSelectedEl(null);
              }}
              className="p-1.5 rounded-md text-[#484f58] hover:text-white hover:bg-white/5 transition-colors"
              title="Deselect"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setShowProps(s => !s)}
            title="Toggle Properties Panel"
            className={cn('p-1.5 rounded-md transition-colors', showProps ? 'bg-indigo-600/20 text-indigo-400' : 'text-[#484f58] hover:text-white hover:bg-white/5')}
          >
            {showProps ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRight className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Hint */}
        {!selectedEl && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-600/90 backdrop-blur-sm rounded-full text-[11px] text-white font-medium shadow-lg shadow-indigo-900/40">
              <MousePointer2 className="w-3.5 h-3.5" />
              Click any element to edit • Double-click to edit text
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          title="Visual Editor"
          srcDoc={injectedHtml}
          className="flex-1 w-full border-none bg-white"
          sandbox="allow-scripts allow-modals allow-same-origin"
          onLoad={onIframeLoad}
        />
      </div>

      {/* Property Panel */}
      {showProps && (
        <div className="w-64 border-l border-white/5 flex flex-col shrink-0 bg-[#0d1117] overflow-y-auto scrollbar-thin">
          <div className="h-9 flex items-center px-3 border-b border-white/5 shrink-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#484f58] flex items-center gap-1.5">
              <Layers className="w-3 h-3" /> Properties
            </span>
          </div>

          {!selectedEl ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <MousePointer2 className="w-8 h-8 text-[#484f58]" />
              <p className="text-[11px] text-[#484f58]">Select an element in the preview to edit its properties</p>
            </div>
          ) : (
            <div className="flex-1 px-3 py-2 space-y-0">
              {/* Typography */}
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] pt-2 pb-1">Typography</p>

              <PropertyRow label="Color">
                <input
                  type="color"
                  value={getColorStyle('color')}
                  onChange={e => applyStyle('color', e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border border-white/10 bg-transparent"
                />
                <input
                  type="text"
                  value={getColorStyle('color')}
                  onChange={e => applyStyle('color', e.target.value)}
                  className="w-20 bg-black/40 border border-white/10 rounded px-2 py-0.5 text-[10px] font-mono text-[#c9d1d9] outline-none focus:border-indigo-500"
                />
              </PropertyRow>

              <PropertyRow label="Font Size">
                <input
                  type="range"
                  min={8} max={80} step={1}
                  value={getNumericStyle('fontSize')}
                  onChange={e => applyStyle('fontSize', e.target.value + 'px')}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-[10px] text-[#8b949e] w-10 text-right font-mono">{getNumericStyle('fontSize')}px</span>
              </PropertyRow>

              <PropertyRow label="Weight">
                {(['400', '600', '700', '800'] as const).map(w => (
                  <button
                    key={w}
                    onClick={() => applyStyle('fontWeight', w)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-bold transition-colors border',
                      (selectedEl.styles.fontWeight === w || (w === '400' && selectedEl.styles.fontWeight === 'normal'))
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-black/20 border-white/10 text-[#8b949e] hover:text-white'
                    )}
                  >{w === '400' ? 'N' : w === '600' ? 'SB' : w === '700' ? 'B' : 'XB'}</button>
                ))}
              </PropertyRow>

              <PropertyRow label="Align">
                {([
                  { val: 'left', Icon: AlignLeft },
                  { val: 'center', Icon: AlignCenter },
                  { val: 'right', Icon: AlignRight },
                  { val: 'justify', Icon: AlignJustify },
                ] as const).map(({ val, Icon }) => (
                  <button
                    key={val}
                    onClick={() => applyStyle('textAlign', val)}
                    className={cn(
                      'p-1.5 rounded transition-colors border',
                      selectedEl.styles.textAlign === val
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-black/20 border-white/10 text-[#8b949e] hover:text-white'
                    )}
                  >
                    <Icon className="w-3 h-3" />
                  </button>
                ))}
              </PropertyRow>

              {/* Background */}
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] pt-3 pb-1">Background</p>

              <PropertyRow label="Color">
                <input
                  type="color"
                  value={getColorStyle('backgroundColor') === 'transparent' ? '#ffffff' : getColorStyle('backgroundColor')}
                  onChange={e => applyStyle('backgroundColor', e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border border-white/10 bg-transparent"
                />
                <input
                  type="text"
                  value={getColorStyle('backgroundColor')}
                  onChange={e => applyStyle('backgroundColor', e.target.value)}
                  className="w-20 bg-black/40 border border-white/10 rounded px-2 py-0.5 text-[10px] font-mono text-[#c9d1d9] outline-none focus:border-indigo-500"
                />
              </PropertyRow>

              {/* Spacing */}
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] pt-3 pb-1">Spacing</p>

              {(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const).map(side => (
                <PropertyRow key={side} label={side.replace('padding', 'P-').replace('Top', 'T').replace('Right', 'R').replace('Bottom', 'B').replace('Left', 'L')}>
                  <input
                    type="range"
                    min={0} max={80} step={2}
                    value={getNumericStyle(side)}
                    onChange={e => applyStyle(side, e.target.value + 'px')}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-[10px] text-[#8b949e] w-10 text-right font-mono">{getNumericStyle(side)}px</span>
                </PropertyRow>
              ))}

              {(['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const).map(side => (
                <PropertyRow key={side} label={side.replace('margin', 'M-').replace('Top', 'T').replace('Right', 'R').replace('Bottom', 'B').replace('Left', 'L')}>
                  <input
                    type="range"
                    min={0} max={80} step={2}
                    value={getNumericStyle(side)}
                    onChange={e => applyStyle(side, e.target.value + 'px')}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-[10px] text-[#8b949e] w-10 text-right font-mono">{getNumericStyle(side)}px</span>
                </PropertyRow>
              ))}

              {/* Layout — the most common thing a non-technical user wants to change and, until now,
                  the one thing they had to ASK THE AI for: "put these side by side", "centre this",
                  "add a gap". A round-trip through the builder for a flex-direction is slow and costs
                  tokens; here it is instant and free. */}
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] pt-3 pb-1">Layout</p>

              <PropertyRow label="Arrange">
                <div className="flex gap-1 flex-1 justify-end">
                  {LAYOUT_MODES.map(mode => (
                    <button
                      key={mode.id}
                      title={mode.title}
                      onClick={() => mode.apply(applyStyle)}
                      className={cn(
                        'px-2 py-1 rounded-md text-[10px] transition-colors border',
                        isLayoutMode(selectedEl.styles, mode.id)
                          ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                          : 'border-white/10 bg-white/5 text-[#8b949e] hover:text-white',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </PropertyRow>

              {/* The alignment and gap controls only mean anything once the element is a flex
                  container — showing them on a plain block would offer settings that do nothing. */}
              {isFlex(selectedEl.styles) && (
                <>
                  <PropertyRow label="Align">
                    <div className="flex gap-1 flex-1 justify-end">
                      {(['flex-start', 'center', 'flex-end', 'space-between'] as const).map(val => (
                        <button
                          key={val}
                          title={`justify-content: ${val}`}
                          onClick={() => applyStyle('justifyContent', val)}
                          className={cn(
                            'px-1.5 py-1 rounded-md text-[10px] transition-colors border',
                            (selectedEl.styles.justifyContent || 'flex-start') === val
                              ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                              : 'border-white/10 bg-white/5 text-[#8b949e] hover:text-white',
                          )}
                        >
                          {val === 'space-between' ? '↔' : val === 'center' ? '‖' : val === 'flex-end' ? '⇥' : '⇤'}
                        </button>
                      ))}
                    </div>
                  </PropertyRow>

                  <PropertyRow label="Cross">
                    <div className="flex gap-1 flex-1 justify-end">
                      {(['flex-start', 'center', 'flex-end', 'stretch'] as const).map(val => (
                        <button
                          key={val}
                          title={`align-items: ${val}`}
                          onClick={() => applyStyle('alignItems', val)}
                          className={cn(
                            'px-1.5 py-1 rounded-md text-[10px] transition-colors border',
                            (selectedEl.styles.alignItems || 'stretch') === val
                              ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                              : 'border-white/10 bg-white/5 text-[#8b949e] hover:text-white',
                          )}
                        >
                          {val === 'stretch' ? '⇕' : val === 'center' ? '‖' : val === 'flex-end' ? '⇩' : '⇧'}
                        </button>
                      ))}
                    </div>
                  </PropertyRow>

                  <PropertyRow label="Gap">
                    <input
                      type="range"
                      min={0} max={48} step={2}
                      value={getNumericStyle('gap')}
                      onChange={e => applyStyle('gap', e.target.value + 'px')}
                      className="flex-1 accent-indigo-500"
                    />
                    <span className="text-[10px] text-[#8b949e] w-10 text-right font-mono">{getNumericStyle('gap')}px</span>
                  </PropertyRow>

                  {/* Wrapping is what keeps a row from overflowing a phone — off by default in CSS,
                      which is why a flex row built on a desktop so often breaks on mobile. */}
                  <PropertyRow label="Wrap">
                    <div className="flex gap-1 flex-1 justify-end">
                      {(['nowrap', 'wrap'] as const).map(val => (
                        <button
                          key={val}
                          onClick={() => applyStyle('flexWrap', val)}
                          className={cn(
                            'px-2 py-1 rounded-md text-[10px] transition-colors border',
                            (selectedEl.styles.flexWrap || 'nowrap') === val
                              ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                              : 'border-white/10 bg-white/5 text-[#8b949e] hover:text-white',
                          )}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </PropertyRow>
                </>
              )}

              {/* Border */}
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] pt-3 pb-1">Border</p>

              <PropertyRow label="Radius">
                <input
                  type="range"
                  min={0} max={50} step={1}
                  value={getNumericStyle('borderRadius')}
                  onChange={e => applyStyle('borderRadius', e.target.value + 'px')}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-[10px] text-[#8b949e] w-10 text-right font-mono">{getNumericStyle('borderRadius')}px</span>
              </PropertyRow>

              {/* Effects */}
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] pt-3 pb-1">Effects</p>

              <PropertyRow label="Opacity">
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={parseFloat(selectedEl.styles.opacity || '1')}
                  onChange={e => applyStyle('opacity', e.target.value)}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-[10px] text-[#8b949e] w-10 text-right font-mono">{Math.round(parseFloat(selectedEl.styles.opacity || '1') * 100)}%</span>
              </PropertyRow>

              <div className="pb-4" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
