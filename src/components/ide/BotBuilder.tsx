import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Play, Download, Webhook, Trash2, Plus, X, ChevronRight,
  MessageSquare, GitBranch, Globe, Zap, StopCircle, RotateCcw,
  Send, Bot, User, Copy, Check
} from 'lucide-react';
import { botFlowToBuildPrompt } from '../../lib/botFlowPrompt';

type NodeType = 'start' | 'message' | 'menu' | 'condition' | 'api' | 'end';

interface BotNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  data: {
    text?: string;
    options?: string[];
    condition?: string;
    apiUrl?: string;
    method?: string;
    responseVar?: string;
  };
}

interface BotEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

type Platform = 'whatsapp' | 'telegram' | 'both';

const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;

const nodeConfig: Record<NodeType, { label: string; color: string; border: string; bg: string; icon: React.ReactNode; desc: string }> = {
  start:     { label: 'Start',       color: '#22c55e', border: 'border-green-500',  bg: 'bg-green-500/20',  icon: <Play size={14} />,        desc: 'Entry point' },
  message:   { label: 'Message',     color: '#3b82f6', border: 'border-blue-500',   bg: 'bg-blue-500/20',   icon: <MessageSquare size={14}/>, desc: 'Send text' },
  menu:      { label: 'Button Menu', color: '#a855f7', border: 'border-purple-500', bg: 'bg-purple-500/20', icon: <ChevronRight size={14}/>,  desc: 'Show options' },
  condition: { label: 'Condition',   color: '#eab308', border: 'border-yellow-500', bg: 'bg-yellow-500/20', icon: <GitBranch size={14}/>,     desc: 'If/else branch' },
  api:       { label: 'API Call',    color: '#f97316', border: 'border-orange-500', bg: 'bg-orange-500/20', icon: <Globe size={14}/>,         desc: 'Fetch external data' },
  end:       { label: 'End',         color: '#ef4444', border: 'border-red-500',    bg: 'bg-red-500/20',    icon: <StopCircle size={14}/>,    desc: 'Conversation end' },
};

const defaultNodes: BotNode[] = [
  { id: 'n1', type: 'start',   x: 80,  y: 80,  data: { text: 'Start' } },
  { id: 'n2', type: 'message', x: 80,  y: 220, data: { text: 'Welcome! How can I help you today?' } },
  { id: 'n3', type: 'menu',    x: 80,  y: 360, data: { text: 'Choose an option:', options: ['Track Order', 'Support', 'Pricing'] } },
  { id: 'n4', type: 'message', x: 360, y: 260, data: { text: 'Your order is on its way! ETA: 2 days.' } },
  { id: 'n5', type: 'message', x: 360, y: 380, data: { text: 'Connecting you to our support team...' } },
  { id: 'n6', type: 'message', x: 360, y: 500, data: { text: 'Our plans start at ₹999/month. Visit our website!' } },
  { id: 'n7', type: 'end',     x: 360, y: 640, data: { text: 'Goodbye!' } },
];

const defaultEdges: BotEdge[] = [
  { id: 'e1', from: 'n1', to: 'n2' },
  { id: 'e2', from: 'n2', to: 'n3' },
  { id: 'e3', from: 'n3', to: 'n4', label: 'Track Order' },
  { id: 'e4', from: 'n3', to: 'n5', label: 'Support' },
  { id: 'e5', from: 'n3', to: 'n6', label: 'Pricing' },
  { id: 'e6', from: 'n4', to: 'n7' },
  { id: 'e7', from: 'n5', to: 'n7' },
  { id: 'e8', from: 'n6', to: 'n7' },
];

function genId() {
  return 'n' + Math.random().toString(36).slice(2, 8);
}

function nodeCenter(node: BotNode) {
  return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 };
}

function nodeBottom(node: BotNode) {
  return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT };
}

function nodeTop(node: BotNode) {
  return { x: node.x + NODE_WIDTH / 2, y: node.y };
}

function edgePath(from: BotNode, to: BotNode) {
  const start = nodeBottom(from);
  const end = nodeTop(to);
  const cp1x = start.x;
  const cp1y = start.y + 60;
  const cp2x = end.x;
  const cp2y = end.y - 60;
  return `M ${start.x},${start.y} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${end.x},${end.y}`;
}

// ——— Simulator helpers ———
interface SimMessage { role: 'bot' | 'user'; text: string }

function getNodeById(nodes: BotNode[], id: string) {
  return nodes.find(n => n.id === id);
}

function getStartNode(nodes: BotNode[]) {
  return nodes.find(n => n.type === 'start');
}

function getNextNodes(edges: BotEdge[], fromId: string, nodes: BotNode[]) {
  return edges
    .filter(e => e.from === fromId)
    .map(e => ({ node: getNodeById(nodes, e.to), label: e.label }))
    .filter(x => x.node) as { node: BotNode; label?: string }[];
}

interface BotBuilderProps {
  /**
   * Hands the designed flow to the REAL build engine (admin autopsy 2026-07-20): converts the
   * nodes/edges into a full NavBharatAI Pro v5.0 build prompt (composer prefill + view switch) so
   * "Build Bot App" produces a genuinely working chatbot app — the designer previously ended at a
   * JSON download and never built anything.
   */
  onBuildViaV5?: (prompt: string) => void;
}

export const BotBuilder: React.FC<BotBuilderProps> = ({ onBuildViaV5 }) => {
  const [nodes, setNodes] = useState<BotNode[]>(defaultNodes);
  const [edges, setEdges] = useState<BotEdge[]>(defaultEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>('whatsapp');
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Drag state
  const dragging = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Simulator state
  const [simMessages, setSimMessages] = useState<SimMessage[]>([]);
  const [simCurrentId, setSimCurrentId] = useState<string | null>(null);
  const [simOptions, setSimOptions] = useState<{ label: string; nextId: string }[]>([]);

  const selectedNode = nodes.find(n => n.id === selectedId) ?? null;

  // ——— Drag handlers ———
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    dragging.current = {
      id,
      ox: e.clientX - rect.left - node.x,
      oy: e.clientY - rect.top - node.y,
    };
  }, [nodes]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - dragging.current.ox);
    const y = Math.max(0, e.clientY - rect.top - dragging.current.oy);
    setNodes(prev => prev.map(n => n.id === dragging.current!.id ? { ...n, x, y } : n));
  }, []);

  const handleCanvasMouseUp = useCallback(() => {
    dragging.current = null;
  }, []);

  // ——— Keyboard delete ———
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !(e.target as HTMLElement).matches('input,textarea')) {
        deleteNode(selectedId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId]);

  function deleteNode(id: string) {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function addNode(type: NodeType) {
    const id = genId();
    const x = 100 + Math.random() * 300;
    const y = 100 + Math.random() * 300;
    const newNode: BotNode = {
      id,
      type,
      x,
      y,
      data: type === 'menu' ? { text: 'Choose:', options: ['Option 1', 'Option 2'] }
           : type === 'api'  ? { apiUrl: 'https://api.example.com', method: 'GET', responseVar: 'result' }
           : type === 'condition' ? { condition: 'user_input == "yes"' }
           : { text: nodeConfig[type].label },
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(id);
  }

  function updateNodeData(id: string, patch: Partial<BotNode['data']>) {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  }

  // ——— Export JSON ———
  function exportJson() {
    const flow = { platform, version: '1.0', nodes, edges, webhookUrl: '' };
    const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bot-flow-${platform}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ——— Webhook modal copy ———
  const webhookSnippet = `POST https://your-server.com/webhook
Content-Type: application/json

{
  "platform": "${platform}",
  "flow": <exported_json>
}`;

  function copyWebhook() {
    navigator.clipboard.writeText(webhookSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ——— Simulator ———
  function startSim() {
    const start = getStartNode(nodes);
    if (!start) return;
    setSimMessages([]);
    setSimOptions([]);
    setSimCurrentId(start.id);
    advanceSim(start.id, []);
    setShowSimulator(true);
  }

  function advanceSim(nodeId: string, msgs: SimMessage[]) {
    const node = getNodeById(nodes, nodeId);
    if (!node) return;
    const newMsgs: SimMessage[] = [...msgs];

    if (node.type === 'start') {
      const nexts = getNextNodes(edges, nodeId, nodes);
      if (nexts.length > 0) advanceSim(nexts[0].node.id, newMsgs);
      return;
    }
    if (node.type === 'end') {
      newMsgs.push({ role: 'bot', text: node.data.text || 'Goodbye!' });
      setSimMessages(newMsgs);
      setSimOptions([]);
      setSimCurrentId(null);
      return;
    }
    if (node.type === 'message') {
      newMsgs.push({ role: 'bot', text: node.data.text || '...' });
      setSimMessages(newMsgs);
      const nexts = getNextNodes(edges, nodeId, nodes);
      if (nexts.length === 1) {
        setTimeout(() => advanceSim(nexts[0].node.id, newMsgs), 400);
      } else {
        setSimOptions([]);
        setSimCurrentId(nodeId);
      }
      return;
    }
    if (node.type === 'menu') {
      newMsgs.push({ role: 'bot', text: node.data.text || 'Choose:' });
      setSimMessages(newMsgs);
      const nexts = getNextNodes(edges, nodeId, nodes);
      const opts = nexts.map(n => ({ label: n.label || n.node.data.text || 'Option', nextId: n.node.id }));
      setSimOptions(opts.length > 0 ? opts : (node.data.options || []).map(o => ({ label: o, nextId: '' })));
      setSimCurrentId(nodeId);
      return;
    }
    if (node.type === 'api') {
      newMsgs.push({ role: 'bot', text: `[API] ${node.data.method || 'GET'} ${node.data.apiUrl || ''}` });
      setSimMessages(newMsgs);
      const nexts = getNextNodes(edges, nodeId, nodes);
      if (nexts.length > 0) setTimeout(() => advanceSim(nexts[0].node.id, newMsgs), 600);
      return;
    }
    if (node.type === 'condition') {
      newMsgs.push({ role: 'bot', text: `[Condition] ${node.data.condition || 'check'}` });
      setSimMessages(newMsgs);
      const nexts = getNextNodes(edges, nodeId, nodes);
      if (nexts.length > 0) setTimeout(() => advanceSim(nexts[0].node.id, newMsgs), 400);
      return;
    }
  }

  function simChoose(nextId: string, label: string) {
    const newMsgs: SimMessage[] = [...simMessages, { role: 'user', text: label }];
    setSimMessages(newMsgs);
    setSimOptions([]);
    if (nextId) advanceSim(nextId, newMsgs);
  }

  // Canvas dimensions
  const canvasW = Math.max(800, ...nodes.map(n => n.x + NODE_WIDTH + 80));
  const canvasH = Math.max(600, ...nodes.map(n => n.y + NODE_HEIGHT + 80));

  return (
    <div className="flex flex-col h-full w-full" style={{ background: '#0d1117', color: '#e6edf3' }}>
      {/* ——— Toolbar ——— */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-shrink-0" style={{ background: '#161b22' }}>
        {/* Platform tabs */}
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['whatsapp', 'telegram', 'both'] as Platform[]).map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1 text-xs capitalize transition-colors ${platform === p ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {p === 'both' ? 'Both' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Node count */}
        <span className="text-xs text-gray-400 border border-white/10 rounded px-2 py-1">{nodes.length} nodes</span>

        {onBuildViaV5 && (
          <button
            onClick={() => onBuildViaV5(botFlowToBuildPrompt(nodes, edges, platform))}
            disabled={nodes.length === 0}
            title="Hand this flow to NavBharatAI Pro v5.0 — press Send there to build the real chatbot app"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            <Bot size={13} /> Build Bot App
          </button>
        )}
        <button
          onClick={startSim}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          <Zap size={13} /> Simulate
        </button>
        <button
          onClick={() => setShowWebhookModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-purple-700 hover:bg-purple-600 text-white transition-colors"
        >
          <Webhook size={13} /> Export Webhook
        </button>
        <button
          onClick={exportJson}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-green-700 hover:bg-green-600 text-white transition-colors"
        >
          <Download size={13} /> Export JSON
        </button>
        <button
          onClick={() => { setNodes([]); setEdges([]); setSelectedId(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>

      {/* ——— Main area ——— */}
      <div className="flex flex-1 min-h-0">
        {/* ——— Left sidebar: Node palette ——— */}
        <div className="w-[200px] flex-shrink-0 border-r border-white/10 flex flex-col p-3 gap-2 overflow-y-auto" style={{ background: '#161b22' }}>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Node Palette</p>
          {(Object.entries(nodeConfig) as [NodeType, typeof nodeConfig[NodeType]][]).map(([type, cfg]) => (
            <button
              key={type}
              onClick={() => addNode(type)}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-white/10 hover:border-white/20 text-left transition-all group"
              style={{ background: '#0d1117' }}
            >
              <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ background: cfg.color + '33', color: cfg.color }}>
                {cfg.icon}
              </div>
              <div>
                <div className="text-xs font-medium text-gray-200">{cfg.label}</div>
                <div className="text-[10px] text-gray-500">{cfg.desc}</div>
              </div>
            </button>
          ))}
          <p className="text-[10px] text-gray-600 mt-2 text-center">Click to add node</p>
        </div>

        {/* ——— Center canvas ——— */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto relative"
          style={{ background: '#0d1117', cursor: dragging.current ? 'grabbing' : 'default' }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={() => setSelectedId(null)}
        >
          {/* Grid background */}
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: canvasW, height: canvasH, pointerEvents: 'none' }}
          >
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Edges */}
            {edges.map(edge => {
              const fromNode = nodes.find(n => n.id === edge.from);
              const toNode = nodes.find(n => n.id === edge.to);
              if (!fromNode || !toNode) return null;
              const path = edgePath(fromNode, toNode);
              const mid = nodeCenter(toNode);
              return (
                <g key={edge.id}>
                  <path d={path} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" markerEnd="url(#arrow)" />
                  {edge.label && (
                    <text x={mid.x} y={toNode.y - 10} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Arrow marker */}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.3)" />
              </marker>
            </defs>
          </svg>

          {/* Nodes */}
          <div style={{ width: canvasW, height: canvasH, position: 'relative' }}>
            {nodes.map(node => {
              const cfg = nodeConfig[node.type];
              const isSelected = selectedId === node.id;
              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    left: node.x,
                    top: node.y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    zIndex: isSelected ? 10 : 1,
                    cursor: 'grab',
                  }}
                  onMouseDown={e => handleNodeMouseDown(e, node.id)}
                  onClick={e => { e.stopPropagation(); setSelectedId(node.id); }}
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(node.id); setSelectedId(node.id); }}
                >
                  <div
                    className={`w-full h-full rounded-lg border-2 flex flex-col justify-center px-3 select-none transition-all ${cfg.border} ${isSelected ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-transparent' : ''}`}
                    style={{ background: '#161b22', borderColor: isSelected ? cfg.color : cfg.color + '66' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex-shrink-0" style={{ color: cfg.color }}>{cfg.icon}</div>
                      <span className="text-[11px] font-semibold truncate" style={{ color: cfg.color }}>{cfg.label}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">
                      {node.data.text || node.data.apiUrl || node.data.condition || ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ——— Right panel: Properties ——— */}
        <div className="w-[280px] flex-shrink-0 border-l border-white/10 flex flex-col" style={{ background: '#161b22' }}>
          {selectedNode ? (
            <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div style={{ color: nodeConfig[selectedNode.type].color }}>{nodeConfig[selectedNode.type].icon}</div>
                  <span className="text-sm font-semibold">{nodeConfig[selectedNode.type].label}</span>
                </div>
                <button
                  onClick={() => deleteNode(selectedNode.id)}
                  className="text-red-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="text-[10px] text-gray-500 font-mono">ID: {selectedNode.id}</div>

              {/* Message node */}
              {(selectedNode.type === 'message' || selectedNode.type === 'start' || selectedNode.type === 'end') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-400">Message Text</label>
                  <textarea
                    className="w-full rounded-lg p-2 text-xs text-gray-200 border border-white/10 resize-none focus:outline-none focus:border-white/30"
                    style={{ background: '#0d1117', minHeight: 80 }}
                    value={selectedNode.data.text || ''}
                    onChange={e => updateNodeData(selectedNode.id, { text: e.target.value })}
                  />
                </div>
              )}

              {/* Menu node */}
              {selectedNode.type === 'menu' && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400">Prompt Text</label>
                    <input
                      className="w-full rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-white/30"
                      style={{ background: '#0d1117' }}
                      value={selectedNode.data.text || ''}
                      onChange={e => updateNodeData(selectedNode.id, { text: e.target.value })}
                    />
                  </div>
                  <label className="text-xs text-gray-400">Button Options</label>
                  {(selectedNode.data.options || []).map((opt, i) => (
                    <div key={i} className="flex gap-1.5">
                      <input
                        className="flex-1 rounded-lg p-1.5 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-white/30"
                        style={{ background: '#0d1117' }}
                        value={opt}
                        onChange={e => {
                          const opts = [...(selectedNode.data.options || [])];
                          opts[i] = e.target.value;
                          updateNodeData(selectedNode.id, { options: opts });
                        }}
                      />
                      <button
                        onClick={() => {
                          const opts = (selectedNode.data.options || []).filter((_, j) => j !== i);
                          updateNodeData(selectedNode.id, { options: opts });
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => updateNodeData(selectedNode.id, { options: [...(selectedNode.data.options || []), 'New Option'] })}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <Plus size={12} /> Add Option
                  </button>
                </div>
              )}

              {/* Condition node */}
              {selectedNode.type === 'condition' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-400">Condition Expression</label>
                  <input
                    className="w-full rounded-lg p-2 text-xs text-gray-200 border border-white/10 font-mono focus:outline-none focus:border-white/30"
                    style={{ background: '#0d1117' }}
                    value={selectedNode.data.condition || ''}
                    onChange={e => updateNodeData(selectedNode.id, { condition: e.target.value })}
                    placeholder='e.g. user_input == "yes"'
                  />
                </div>
              )}

              {/* API node */}
              {selectedNode.type === 'api' && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400">API URL</label>
                    <input
                      className="w-full rounded-lg p-2 text-xs text-gray-200 border border-white/10 font-mono focus:outline-none focus:border-white/30"
                      style={{ background: '#0d1117' }}
                      value={selectedNode.data.apiUrl || ''}
                      onChange={e => updateNodeData(selectedNode.id, { apiUrl: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400">Method</label>
                    <select
                      className="w-full rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-white/30"
                      style={{ background: '#0d1117' }}
                      value={selectedNode.data.method || 'GET'}
                      onChange={e => updateNodeData(selectedNode.id, { method: e.target.value })}
                    >
                      {['GET', 'POST', 'PUT', 'DELETE'].map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400">Response Variable</label>
                    <input
                      className="w-full rounded-lg p-1.5 text-xs text-gray-200 border border-white/10 font-mono focus:outline-none focus:border-white/30"
                      style={{ background: '#0d1117' }}
                      value={selectedNode.data.responseVar || ''}
                      onChange={e => updateNodeData(selectedNode.id, { responseVar: e.target.value })}
                      placeholder="result"
                    />
                  </div>
                </div>
              )}

              {/* Position */}
              <div className="flex gap-2 mt-auto pt-2 border-t border-white/10">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] text-gray-500">X</label>
                  <input
                    type="number"
                    className="w-full rounded p-1 text-xs text-gray-300 border border-white/10 focus:outline-none"
                    style={{ background: '#0d1117' }}
                    value={Math.round(selectedNode.x)}
                    onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, x: Number(e.target.value) } : n))}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] text-gray-500">Y</label>
                  <input
                    type="number"
                    className="w-full rounded p-1 text-xs text-gray-300 border border-white/10 focus:outline-none"
                    style={{ background: '#0d1117' }}
                    value={Math.round(selectedNode.y)}
                    onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, y: Number(e.target.value) } : n))}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
                <Bot size={22} className="text-gray-500" />
              </div>
              <p className="text-sm text-gray-400">Select a node to edit its properties</p>
              <p className="text-xs text-gray-600">Click on any node in the canvas</p>
            </div>
          )}
        </div>
      </div>

      {/* ——— Webhook Modal ——— */}
      {showWebhookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-xl border border-white/10 p-6 w-[480px] flex flex-col gap-4" style={{ background: '#161b22' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Webhook size={16} className="text-purple-400" />
                <h2 className="text-sm font-semibold">Webhook Setup</h2>
              </div>
              <button onClick={() => setShowWebhookModal(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-400">Send your exported JSON flow to your server via a POST request:</p>
            <div className="relative rounded-lg p-4 font-mono text-xs text-green-300 border border-white/10 overflow-x-auto" style={{ background: '#0d1117' }}>
              <pre className="whitespace-pre-wrap">{webhookSnippet}</pre>
              <button
                onClick={copyWebhook}
                className="absolute top-2 right-2 p-1 rounded text-gray-500 hover:text-white transition-colors"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Steps</p>
              {['1. Export your flow as JSON', '2. Host your webhook endpoint', '3. POST the JSON to your endpoint', '4. Parse and execute the flow server-side'].map(s => (
                <div key={s} className="flex items-center gap-2 text-xs text-gray-400">
                  <ChevronRight size={12} className="text-purple-400" /> {s}
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowWebhookModal(false)}
              className="w-full py-2 rounded-lg text-xs bg-purple-700 hover:bg-purple-600 text-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ——— Simulator Modal ——— */}
      {showSimulator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-xl border border-white/10 flex flex-col w-[380px] max-h-[600px]" style={{ background: '#161b22' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-semibold">Bot Simulator</span>
                <span className="text-xs text-gray-500 capitalize">({platform})</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={startSim}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <RotateCcw size={12} /> Restart
                </button>
                <button onClick={() => setShowSimulator(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 min-h-0" style={{ maxHeight: 380 }}>
              {simMessages.length === 0 && (
                <div className="text-center text-xs text-gray-600 py-8">Starting simulation...</div>
              )}
              {simMessages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'bot' && (
                    <div className="w-6 h-6 rounded-full bg-green-600/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot size={12} className="text-green-400" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'text-white rounded-br-sm'
                        : 'text-gray-200 rounded-bl-sm'
                    }`}
                    style={{ background: msg.role === 'user' ? '#1d4ed8' : '#0d1117' }}
                  >
                    {msg.text}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-6 h-6 rounded-full bg-blue-600/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User size={12} className="text-blue-400" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Options / input */}
            <div className="border-t border-white/10 p-3 flex flex-col gap-2">
              {simOptions.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {simOptions.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => opt.nextId ? simChoose(opt.nextId, opt.label) : undefined}
                      className="w-full py-2 px-3 rounded-lg border border-green-500/40 text-xs text-green-300 hover:bg-green-500/10 transition-colors text-left"
                      style={{ background: '#0d1117' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : simCurrentId === null ? (
                <div className="text-center text-xs text-gray-500 py-1">Conversation ended</div>
              ) : (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg px-3 py-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-white/30"
                    style={{ background: '#0d1117' }}
                    placeholder="Type a message..."
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          (e.target as HTMLInputElement).value = '';
                          const nexts = getNextNodes(edges, simCurrentId!, nodes);
                          if (nexts.length > 0) simChoose(nexts[0].node.id, val);
                        }
                      }
                    }}
                  />
                  <button className="px-3 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white transition-colors">
                    <Send size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
