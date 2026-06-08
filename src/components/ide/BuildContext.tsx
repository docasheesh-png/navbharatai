import React, { createContext, useContext, useState } from 'react';
import { BuildStep } from './AgentProgress';

interface BuildContextType {
  buildSteps: BuildStep[];
  setBuildSteps: React.Dispatch<React.SetStateAction<BuildStep[]>>;
}

const BuildContext = createContext<BuildContextType | undefined>(undefined);

export const BuildProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);
  return (
    <BuildContext.Provider value={{ buildSteps, setBuildSteps }}>
      {children}
    </BuildContext.Provider>
  );
};

export const useBuild = () => {
  const context = useContext(BuildContext);
  if (!context) throw new Error('useBuild must be used within a BuildProvider');
  return context;
};
