import React, { useState } from 'react';
import { GitBranch, Play, Check, X, Plus, Trash2, Download, RefreshCw, ChevronRight, Zap, Server, Shield, Rocket, Settings, Copy, AlertCircle } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

type StepType = 'checkout' | 'install' | 'test' | 'build' | 'deploy' | 'notify' | 'custom';
type StepStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip';
type Platform = 'github' | 'cloudbuild' | 'gitlab';

interface EnvVar { key: string; value: string; }

interface PipelineStep {
  id: string;
  type: StepType;
  name: string;
  command: string;
  enabled: boolean;
  status: StepStatus;
  duration?: number;
  log?: string;
  envVars: EnvVar[];
}

const STEP_ICONS: Record<StepType, any> = { checkout: GitBranch, install: Download, test: Shield, build: Settings, deploy: Rocket, notify: Zap, custom: Settings };
const STEP_COLORS: Record<StepType, string> = { checkout: 'text-blue-400', install: 'text-amber-400', test: 'text-emerald-400', build: 'text-violet-400', deploy: 'text-rose-400', notify: 'text-cyan-400', custom: 'text-white/40' };
const STATUS_COLORS: Record<StepStatus, string> = { idle: 'bg-white/10 text-white/40', running: 'bg-amber-500/20 text-amber-400', pass: 'bg-emerald-500/20 text-emerald-400', fail: 'bg-red-500/20 text-red-400', skip: 'bg-white/5 text-white/20' };

const DEFAULT_STEPS: PipelineStep[] = [
  { id: '1', type: 'checkout', name: 'Checkout Code', command: 'git checkout $BRANCH', enabled: true, status: 'idle', envVars: [{ key: 'BRANCH', value: 'main' }] },
  { id: '2', type: 'install', name: 'Install Dependencies', command: 'npm ci', enabled: true, status: 'idle', envVars: [] },
  { id: '3', type: 'test', name: 'Run Tests', command: 'npm test -- --watchAll=false', enabled: true, status: 'idle', envVars: [] },
  { id: '4', type: 'build', name: 'Build App', command: 'npm run build', enabled: true, status: 'idle', envVars: [{ key: 'NODE_ENV', value: 'production' }] },
  { id: '5', type: 'deploy', name: 'Deploy to Cloud Run', command: 'gcloud run deploy $SERVICE --image gcr.io/$PROJECT/$SERVICE', enabled: true, status: 'idle', envVars: [{ key: 'SERVICE', value: 'navbharat-ai-prod' }, { key: 'PROJECT', value: 'your-project' }] },
];

const STEP_TYPE_OPTIONS: { type: StepType; label: string; defaultCmd: string }[] = [
  { type: 'checkout', label: 'Checkout', defaultCmd: 'git checkout $BRANCH' },
  { type: 'install', label: 'Install', defaultCmd: 'npm ci' },
  { type: 'test', label: 'Test', defaultCmd: 'npm test' },
  { type: 'build', label: 'Build', defaultCmd: 'npm run build' },
  { type: 'deploy', label: 'Deploy', defaultCmd: 'gcloud run deploy' },
  { type: 'notify', label: 'Notify', defaultCmd: 'curl -X POST $WEBHOOK_URL' },
  { type: 'custom', label: 'Custom', defaultCmd: 'echo "custom step"' },
];


function generateYAML(steps: PipelineStep[], platform: Platform, appName: string, envName: string): string {
  if (platform === 'github') {
    const stepsYml = steps.filter(s => s.enabled).map(s => {
      const envLines = s.envVars.map(e => `          ${e.key}: ${e.value}`).join('\n');
      return `      - name: ${s.name}\n        run: ${s.command}${envLines ? '\n        env:\n' + envLines : ''}`;
    }).join('\n\n');
    return `name: ${appName} CI/CD\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\njobs:\n  ${envName.toLowerCase()}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '20'\n\n${stepsYml}`;
  }
  if (platform === 'cloudbuild') {
    const steps2 = steps.filter(s => s.enabled).map(s => {
      const parts = s.command.split(' ');
      const args = parts.slice(1).map(a => `    - '${a}'`).join('\n');
      return `- name: 'gcr.io/cloud-builders/npm'\n  entrypoint: '${parts[0]}'\n  args:\n${args || "    - ''"}\n  id: '${s.name}'`;
    }).join('\n');
    return `steps:\n${steps2}\n\nlogsBucket: gs://your-bucket/logs\ntimeout: 1200s`;
  }
  // gitlab
  const stagesYml = steps.filter(s => s.enabled).map(s => `  - ${s.type}`).join('\n');
  const jobsYml = steps.filter(s => s.enabled).map(s => {
    const envLines = s.envVars.map(e => `  ${e.key}: "${e.value}"`).join('\n');
    return `${s.name.toLowerCase().replace(/\s+/g, '_')}:\n  stage: ${s.type}\n  script:\n    - ${s.command}${envLines ? '\n  variables:\n' + envLines : ''}`;
  }).join('\n\n');
  return `stages:\n${stagesYml}\n\n${jobsYml}`;
}


export function CICDPipeline() {
  const [steps, setSteps] = useState<PipelineStep[]>(DEFAULT_STEPS.map(s => ({ ...s })));
  const [platform, setPlatform] = useState<Platform>('github');
  const [appName, setAppName] = useState('NavBharat AI');
  const [envName, setEnvName] = useState('production');
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [yamlCopied, setYamlCopied] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [newStepType, setNewStepType] = useState<StepType>('custom');

  const yaml = generateYAML(steps, platform, appName, envName);

  // The fake runPipeline / stopPipeline simulation was removed (admin autopsy 2026-07-21): it
  // fabricated pass/fail + console logs in the browser without executing anything. This tool builds
  // real, committable CI YAML (downloadYaml / copyYaml) — the provider runs it for real.

  const toggleStep = (id: string) => setSteps(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));

  const deleteStep = (id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
    if (selectedStep === id) setSelectedStep(null);
  };

  const addStep = () => {
    const opt = STEP_TYPE_OPTIONS.find(o => o.type === newStepType)!;
    const ns: PipelineStep = { id: Date.now().toString(), type: newStepType, name: opt.label + ' Step', command: opt.defaultCmd, enabled: true, status: 'idle', envVars: [] };
    setSteps(prev => [...prev, ns]);
    setShowAddStep(false);
  };

  const updateSelected = (patch: Partial<PipelineStep>) => {
    setSteps(prev => prev.map(s => s.id === selectedStep ? { ...s, ...patch } : s));
  };

  const addEnvVar = () => {
    const step = steps.find(s => s.id === selectedStep);
    if (!step) return;
    updateSelected({ envVars: [...step.envVars, { key: 'NEW_VAR', value: '' }] });
  };

  const updateEnvVar = (idx: number, field: 'key' | 'value', val: string) => {
    const step = steps.find(s => s.id === selectedStep);
    if (!step) return;
    const envVars = step.envVars.map((e, i) => i === idx ? { ...e, [field]: val } : e);
    updateSelected({ envVars });
  };

  const removeEnvVar = (idx: number) => {
    const step = steps.find(s => s.id === selectedStep);
    if (!step) return;
    updateSelected({ envVars: step.envVars.filter((_, i) => i !== idx) });
  };

  const downloadYaml = () => {
    const filename = platform === 'github' ? '.github/workflows/cicd.yml' : platform === 'cloudbuild' ? 'cloudbuild.yaml' : '.gitlab-ci.yml';
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename.split('/').pop()!; a.click();
    URL.revokeObjectURL(url);
  };

  const copyYaml = () => {
    navigator.clipboard.writeText(yaml).then(() => { setYamlCopied(true); setTimeout(() => setYamlCopied(false), 2000); });
  };

  const selectedStepData = steps.find(s => s.id === selectedStep);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center">
          <Rocket className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">CI/CD Pipeline</h2>
          <p className="text-xs text-white/40">Visual pipeline builder — GitHub Actions, Cloud Build, GitLab CI</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* This is a pipeline BUILDER — the real deliverable is the CI YAML, which your provider
              runs (admin autopsy 2026-07-21). The old "Run Pipeline" button faked pass/fail + console
              logs in the browser; nothing was ever executed. Download the real YAML instead. */}
          <button onClick={downloadYaml} className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-all">
            <Download className="w-4 h-4" /> Download YAML
          </button>
        </div>
      </div>

      {/* Sub-header: config */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-[#161b22] flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/40">App:</span>
          <input className="bg-transparent border-b border-white/20 text-xs text-white px-1 py-0.5 focus:outline-none focus:border-violet-500/50 w-28" value={appName} onChange={e => setAppName(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/40">Env:</span>
          <input className="bg-transparent border-b border-white/20 text-xs text-white px-1 py-0.5 focus:outline-none focus:border-violet-500/50 w-24" value={envName} onChange={e => setEnvName(e.target.value)} />
        </div>
        <div className="flex gap-1 ml-auto">
          {(['github', 'cloudbuild', 'gitlab'] as Platform[]).map(p => (
            <button key={p} onClick={() => setPlatform(p)} className={`text-[10px] px-2.5 py-1 rounded-lg border capitalize transition-all ${platform === p ? 'border-violet-500/50 bg-violet-500/10 text-violet-300' : 'border-white/10 text-white/30 hover:border-white/20'}`}>
              {p === 'github' ? 'GitHub Actions' : p === 'cloudbuild' ? 'Cloud Build' : 'GitLab CI'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Pipeline Steps */}
        <div className="w-72 flex flex-col border-r border-white/5 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Steps ({steps.filter(s => s.enabled).length} active)</span>
            <button onClick={() => setShowAddStep(!showAddStep)} className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>

          {showAddStep && (
            <div className="mx-2 my-1.5 bg-[#161b22] border border-violet-500/20 rounded-xl p-2.5">
              <select className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white mb-2 focus:outline-none" value={newStepType} onChange={e => setNewStepType(e.target.value as StepType)}>
                {STEP_TYPE_OPTIONS.map(o => <option key={o.type} value={o.type}>{o.label}</option>)}
              </select>
              <div className="flex gap-1.5">
                <button onClick={addStep} className="flex-1 py-1 bg-violet-600 rounded-lg text-[10px]"><Check className="w-3 h-3 inline mr-1" />Add</button>
                <button onClick={() => setShowAddStep(false)} className="px-2 py-1 bg-white/5 rounded-lg text-[10px] text-white/40"><X className="w-3 h-3" /></button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1 relative">
            {/* Connector line */}
            <div className="absolute left-[28px] top-4 bottom-4 w-px bg-white/5" />
            {steps.map((step, idx) => {
              const Icon = STEP_ICONS[step.type];
              const isSelected = selectedStep === step.id;
              return (
                <div key={step.id} className="relative pl-7">
                  <div className={`absolute left-3 top-3.5 w-3.5 h-3.5 rounded-full flex items-center justify-center z-10 ${
                    step.status === 'pass' ? 'bg-emerald-500' : step.status === 'fail' ? 'bg-red-500' : step.status === 'running' ? 'bg-amber-500 animate-pulse' : step.status === 'skip' ? 'bg-white/10' : 'bg-[#161b22] border border-white/20'
                  }`}>
                    {step.status === 'pass' && <Check className="w-2 h-2 text-white" />}
                    {step.status === 'fail' && <X className="w-2 h-2 text-white" />}
                    {step.status === 'running' && <TirangaLoader className="w-2 h-2 text-white" />}
                    {(step.status === 'idle' || step.status === 'skip') && <span className="text-[7px] text-white/40">{idx + 1}</span>}
                  </div>
                  <button
                    onClick={() => setSelectedStep(isSelected ? null : step.id)}
                    className={`w-full flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                      isSelected ? 'border-violet-500/40 bg-violet-500/5' : 'border-white/5 bg-[#161b22] hover:border-white/10'
                    } ${!step.enabled ? 'opacity-40' : ''}`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${STEP_COLORS[step.type]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{step.name}</p>
                      <p className="text-[9px] text-white/30 truncate font-mono">{step.command}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {step.duration && <span className="text-[8px] text-white/20">{(step.duration / 1000).toFixed(1)}s</span>}
                      <button onClick={e => { e.stopPropagation(); toggleStep(step.id); }} className={`w-5 h-3 rounded-full transition-all ${step.enabled ? 'bg-violet-500' : 'bg-white/10'}`}>
                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${step.enabled ? 'translate-x-2' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </button>

                  {selectedStep === step.id && step.log && (
                    <div className="mt-1 mx-0.5 bg-[#0d1117] rounded-lg p-2 border border-white/5">
                      <pre className="text-[8px] font-mono text-emerald-300 whitespace-pre-wrap">{step.log}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Editor + YAML */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedStepData ? (
            /* Step Editor */
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                {(() => { const Icon = STEP_ICONS[selectedStepData.type]; return <Icon className={`w-5 h-5 ${STEP_COLORS[selectedStepData.type]}`} />; })()}
                <p className="text-sm font-semibold text-white">Edit Step</p>
                <button onClick={() => deleteStep(selectedStepData.id)} className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5 block">Step Name</label>
                <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50" value={selectedStepData.name} onChange={e => updateSelected({ name: e.target.value })} />
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5 block">Command</label>
                <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-500/50" value={selectedStepData.command} onChange={e => updateSelected({ command: e.target.value })} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] text-white/40 uppercase tracking-wider">Environment Variables</label>
                  <button onClick={addEnvVar} className="text-[10px] text-violet-400 flex items-center gap-0.5"><Plus className="w-3 h-3" /> Add</button>
                </div>
                <div className="space-y-1.5">
                  {selectedStepData.envVars.map((env, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="w-36 bg-[#161b22] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-amber-300 font-mono focus:outline-none" placeholder="KEY" value={env.key} onChange={e => updateEnvVar(i, 'key', e.target.value)} />
                      <span className="text-white/20 text-xs">=</span>
                      <input className="flex-1 bg-[#161b22] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none" placeholder="value" value={env.value} onChange={e => updateEnvVar(i, 'value', e.target.value)} />
                      <button onClick={() => removeEnvVar(i)} className="p-1 text-white/20 hover:text-red-400"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  {selectedStepData.envVars.length === 0 && <p className="text-[10px] text-white/20">No env vars. Add with button above.</p>}
                </div>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                <p className="text-[10px] text-amber-300 mb-1.5">⚠️ Security Tip</p>
                <p className="text-[9px] text-white/40">Keep sensitive values (API keys, passwords) in GitHub Secrets / Secret Manager. Never write them directly in YAML.</p>
              </div>
            </div>
          ) : (
            /* YAML Preview */
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-[#161b22]">
                <span className="text-xs text-white/50">
                  {platform === 'github' ? '.github/workflows/cicd.yml' : platform === 'cloudbuild' ? 'cloudbuild.yaml' : '.gitlab-ci.yml'}
                </span>
                <div className="flex gap-2">
                  <button onClick={copyYaml} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all ${yamlCopied ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-white/40 bg-white/5'}`}>
                    {yamlCopied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </button>
                  <button onClick={downloadYaml} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-white/10 text-white/40 bg-white/5 hover:text-white transition-all">
                    <Download className="w-3 h-3" /> Download
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-[10px] font-mono text-emerald-300 whitespace-pre">{yaml}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
