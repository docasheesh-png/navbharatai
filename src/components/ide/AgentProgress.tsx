import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

export type BuildStepStatus = 'pending' | 'running' | 'complete' | 'error';

export interface BuildStep {
  id: string;
  label: string;
  status: BuildStepStatus;
}

interface AgentProgressProps {
  steps: BuildStep[];
}

export const AgentProgress: React.FC<AgentProgressProps> = ({ steps }) => {
  return (
    <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-3">
            <StatusIcon status={step.status} />
            <span className={`text-xs font-medium ${step.status === 'running' ? 'text-white' : 'text-gray-400'}`}>
              {step.label}
            </span>
          </div>
        ))}
    </div>
  );
};

const StatusIcon: React.FC<{ status: BuildStepStatus }> = ({ status }) => {
  switch (status) {
    case 'complete': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case 'running': return <TirangaLoader className="w-4 h-4" />;
    case 'error': return <AlertCircle className="w-4 h-4 text-rose-500" />;
    default: return <Circle className="w-4 h-4 text-gray-700" />;
  }
};
