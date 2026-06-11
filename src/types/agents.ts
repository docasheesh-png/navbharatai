// Task 1.5 — Agent system TypeScript enum
export enum Agent {
  NavBharatAI    = 'navbharatai',
  NavBharatAIPro = 'navbharatai-pro',
  Vishwakarma    = 'vishwakarma_basic',
  VishwakarmaPro = 'vishwakarma_pro',
  VishwakarmaVIP = 'vishwakarma_vip',
}

export const isVishwakarmaAgent = (agent: string): boolean =>
  agent.startsWith('vishwakarma');

export const isProAgent = (agent: string): boolean =>
  agent === Agent.NavBharatAIPro || isVishwakarmaAgent(agent);

export const getAgentEndpoint = (agent: string): string => {
  if (agent === Agent.NavBharatAIPro) return '/api/chat/navbharatai-pro';
  if (isVishwakarmaAgent(agent)) return `/api/chat/${agent}`;
  return '/api/chat/navbharatai';
};

export const DEFAULT_AGENT = Agent.NavBharatAI;
