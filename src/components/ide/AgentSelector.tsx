import React, { useState, useEffect } from 'react';
import { Bot, ChevronDown, CheckCircle2, Zap, ShieldAlert, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface Agent {
  id: string;
  name: string;
  icon: React.ElementType;
  description: string;
  color: string;
}

const AGENTS: Agent[] = [
  { id: 'navbharatai', name: 'NavBharat AI', icon: Bot, description: 'Efficient & Reliable', color: 'text-indigo-400' },
];

interface AgentSelectorProps {
  activeAgent: string;
  onAgentChange: (agent: string) => void;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({ activeAgent, onAgentChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const active = AGENTS.find(a => a.id === activeAgent) || AGENTS[0];

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 bg-black/20 hover:bg-black/30 border border-white/5 rounded px-2 h-6 transition-all"
        title="Select AI Agent"
      >
        <span className="text-[10px] text-white font-bold">{active.name.split(' ')[1]}</span>
        <ChevronDown className="w-3 h-3 text-white/50" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute right-0 top-8 w-60 bg-[#161b22] border border-[#2b2b2b] rounded-xl shadow-2xl p-2 z-50"
            >
              <div className="text-[9px] font-black uppercase text-white/40 px-3 py-2">Select AI Model</div>
              {AGENTS.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => {
                    onAgentChange(agent.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                    activeAgent === agent.id ? "bg-white/10" : "hover:bg-white/5"
                  )}
                >
                  <agent.icon className={cn("w-5 h-5", agent.color)} />
                  <div className="flex-1">
                    <div className="text-xs font-bold text-white">{agent.name}</div>
                    <div className="text-[9px] text-white/60">{agent.description}</div>
                  </div>
                  {activeAgent === agent.id && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
