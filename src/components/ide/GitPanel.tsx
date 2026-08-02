import React, { useState, useEffect, useRef } from 'react';
import { 
  GitBranch, Github, History, Plus, 
  Check, ArrowUpCircle, RefreshCcw, Search,
  GitCommit, GitPullRequest, GitMerge, MoreHorizontal,
  LogOut, Loader2, Rocket, Cloud, Terminal, 
  CheckCircle2, AlertCircle, Settings, Key, 
  FolderOpen, Globe, Layout, Layers, 
  Play, Server, Trash2, Cpu, FileText, Download, 
  Copy, AlertTriangle, ChevronDown, Sparkles, Clock, Lock, Unlock, ArrowUpRight
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { TEMPLATE_PROJECTS } from './SyncedTemplates';
import { deployCapability, sanitizeZipName, unavailableDeployMessage, isV5DeployProvider } from '../../lib/deployCapability';
import { isBackendDeployHost, buildBackendConfigInjection } from '../../lib/backendDeployWiring';

interface GitPanelProps {
  token: string | null;
  repoContext: any;
  user: any;
  onConnect: () => void;
  onDisconnect: () => void;
  isSyncing: boolean;
  onPush: (msg: string) => void;
  isPushing: boolean;
  files: Record<string, string>;
  projectId?: string;
  projectName?: string;
  firebaseToken?: string | null;
  firebaseUser?: any;
  onFirebaseConnect?: () => void;
  onFirebaseDisconnect?: () => void;
  
  // Cloud Sync premium callbacks
  onFilesChange?: (newFiles: Record<string, string>) => void;
  onAgentChange?: (agent: string) => void;
  onToggleView?: (view: any) => void;
  onActivatePreview?: () => void;
  onActivateWorkspace?: (agent: string) => void;
  /** Hand a real deploy off to NavBharatAI Pro v5.0's build+deploy pipeline for the given provider. */
  onDeployViaV5?: (provider: string) => void;
}

interface PlatformOption {
  id: string;
  name: string;
  icon: React.ComponentType<any>;
  color: string;
  badge?: string;
  bgHover: string;
  desc: string;
  defaultBuildDir: string;
}

const DEPLOY_PLATFORMS: PlatformOption[] = [
  { id: 'github', name: 'GitHub Sync & Pages', icon: Github, color: 'text-white', bgHover: 'hover:bg-white/5', desc: 'Push commits directly to public/private remote repos.', defaultBuildDir: 'dist' },
  { id: 'firebase', name: 'Firebase Hosting', icon: Cloud, color: 'text-amber-500', bgHover: 'hover:bg-amber-500/10', desc: 'Deploy high-performance static sites & Cloud Functions.', defaultBuildDir: 'public' },
  { id: 'vercel', name: 'Vercel App', icon: Layers, color: 'text-stone-300', bgHover: 'hover:bg-stone-500/15', desc: 'Zero-config global edge deployments with serverless routes.', defaultBuildDir: 'dist' },
  { id: 'netlify', name: 'Netlify Cloud', icon: Globe, color: 'text-teal-400', bgHover: 'hover:bg-teal-400/10', desc: 'Production site hosting with instant cache invalidation.', defaultBuildDir: 'dist' },
  { id: 'cloudflare', name: 'Cloudflare Pages', icon: Server, color: 'text-orange-400', bgHover: 'hover:bg-orange-500/10', desc: 'Build jamstack applications distributed on global CDN.', defaultBuildDir: 'dist' },
  { id: 'gcloud', name: 'Google Cloud Run', icon: Cpu, color: 'text-blue-400', bgHover: 'hover:bg-blue-500/10', desc: 'Run server-side compiled containers on auto-scaling clusters.', defaultBuildDir: 'dist' },
  { id: 'docker', name: 'Docker Hub Registry', icon: Play, color: 'text-[#2496ed]', bgHover: 'hover:bg-blue-600/10', desc: 'Build & package standard OCI images for portable runtimes.', defaultBuildDir: 'dist' },
  { id: 'render', name: 'Render Web Services', icon: RefreshCcw, color: 'text-fuchsia-400', bgHover: 'hover:bg-fuchsia-500/10', desc: 'Continuous hosting for Node full-stack applications.', defaultBuildDir: 'dist' },
  { id: 'railway', name: 'Railway App', icon: Terminal, color: 'text-pink-400', bgHover: 'hover:bg-pink-500/10', desc: 'Instant database and multi-service cloud container host.', defaultBuildDir: 'dist' },
  { id: 'aws', name: 'AWS Amplify', icon: Cloud, color: 'text-yellow-500', bgHover: 'hover:bg-yellow-500/10', desc: 'Secure AWS backend and web app deployment console.', defaultBuildDir: 'dist' },
  { id: 'supabase', name: 'Supabase Edge', icon: Layout, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-500/10', desc: 'PostgreSQL integrated static and edge function pipeline.', defaultBuildDir: 'dist' },
  { id: 'digitalocean', name: 'DigitalOcean App Platform', icon: Server, color: 'text-indigo-400', bgHover: 'hover:bg-indigo-500/10', desc: 'High availability scalable cloud deployments.', defaultBuildDir: 'dist' },
  { id: 'heroku', name: 'Heroku Dynos', icon: Layers, color: 'text-purple-400', bgHover: 'hover:bg-purple-500/10', desc: 'Classic managed cloud Platform as a Service (PaaS).', defaultBuildDir: 'dist' },
  { id: 'surge', name: 'Surge.sh CLI', icon: Globe, color: 'text-cyan-400', bgHover: 'hover:bg-cyan-500/10', badge: 'Fastest', desc: 'Deploy single-command static paths directly onto the web.', defaultBuildDir: 'dist' },
  { id: 'static', name: 'Static Export Store', icon: Download, color: 'text-stone-400', bgHover: 'hover:bg-stone-400/10', desc: 'Bundle static client bundle into a portable zip file.', defaultBuildDir: 'dist' },
  { id: 'remote', name: 'Custom Remote Git', icon: GitBranch, color: 'text-red-400', bgHover: 'hover:bg-red-500/10', desc: 'Push commits to custom git endpoints over Secure Shell (SSH).', defaultBuildDir: 'dist' }
];

export const GitPanel: React.FC<GitPanelProps> = ({
  token,
  repoContext,
  user,
  onConnect,
  onDisconnect,
  isSyncing,
  onPush,
  isPushing,
  files,
  projectId = 'default-project',
  projectName = 'Workspace App',
  firebaseToken = null,
  firebaseUser = null,
  onFirebaseConnect = () => {},
  onFirebaseDisconnect = () => {},
  onFilesChange,
  onAgentChange,
  onToggleView,
  onActivatePreview,
  onActivateWorkspace,
  onDeployViaV5
}) => {
  const [activeTab, setActiveTab2] = useState<'sync' | 'deploy'>('deploy');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Suggest a commit message from the actually-changed files — a deterministic LOCAL heuristic (not an
  // AI/model call, so it is not labelled as one). Writes to the SAME config field the input shows
  // (configs.github.commitMsg via updateConfig) so the suggestion actually appears — previously it set
  // an unused `commitMsg` state, so the button did nothing visible.
  const generateCommitMessage = () => {
    const fileNames = Object.keys(files);
    const exts = [...new Set(fileNames.map(f => f.split('.').pop() || ''))].filter(Boolean);
    const components = fileNames.filter(f => /\.(tsx?|jsx?)$/.test(f)).map(f => f.split('/').pop()?.replace(/\.[^.]+$/, '') || '').filter(Boolean);
    let msg = 'Update project files';
    if (components.length === 1) msg = `Update ${components[0]} component`;
    else if (components.length > 1 && components.length <= 3) msg = `Update ${components.slice(0, 3).join(', ')}`;
    else if (exts.includes('css') && exts.length === 1) msg = 'Update styles';
    else if (exts.includes('json')) msg = 'Update configuration';
    else if (fileNames.some(f => /test|spec/i.test(f))) msg = 'Add tests';
    else if (fileNames.some(f => /readme|docs/i.test(f))) msg = 'Update documentation';
    else if (fileNames.length === 1) msg = `Update ${fileNames[0].split('/').pop()}`;
    updateConfig('github', { commitMsg: msg });
  };

  // Premium Cloud Sync States
  const [selectedSyncPlatform, setSelectedSyncPlatform] = useState<string>('github');
  const [syncDropdownOpen, setSyncDropdownOpen] = useState(false);
  const [syncQuery, setSyncQuery] = useState('');
  
  const [fetchedProjects, setFetchedProjects] = useState<any[]>([]);
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);

  // Sync Progress States
  const [isSyncRunning, setIsSyncRunning] = useState(false);
  const [syncProgressStage, setSyncProgressStage] = useState('');
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [successfullySyncedProject, setSuccessfullySyncedProject] = useState<any>(null);
  
  // Vishwakarma Selection Toggles
  const [showModeModal, setShowModeModal] = useState(false);

  // Load cloud projects securely on change
  useEffect(() => {
    if (activeTab !== 'sync') return;
    
    setIsFetchingProjects(true);
    const presetTemplates = Object.values(TEMPLATE_PROJECTS).map(t => ({
      id: t.id,
      name: t.id,
      displayName: t.name,
      description: t.description,
      isTemplate: true
    }));

    if (selectedSyncPlatform === 'github' && token) {
      fetch('/api/github/repos', {
        headers: { Authorization: `token ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            const repos = data.map((repo: any) => ({
              id: repo.name,
              name: repo.name,
              displayName: repo.full_name,
              description: repo.description || 'Public GitHub Remote Repository',
              owner: repo.owner?.login || 'username',
              isTemplate: false
            }));
            setFetchedProjects([...repos, ...presetTemplates]);
          } else {
            setFetchedProjects(presetTemplates);
          }
        })
        .catch(() => {
          setFetchedProjects(presetTemplates);
        })
        .finally(() => setIsFetchingProjects(false));
    } else if (selectedSyncPlatform === 'firebase') {
      fetch('/api/cloudsync/firebase', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firebaseToken || 'dummy-auth-token'}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data?.status === 'success') {
            const firebaseProjs = data.projects.map((p: any) => ({
              id: p.id,
              name: p.id,
              displayName: p.name,
              description: `Hosting: ${p.hosting ? 'Enabled' : 'Disabled'} • Functions: ${p.functions?.join(', ') || 'N/A'}`,
              isTemplate: true
            }));
            setFetchedProjects(firebaseProjs);
          } else {
            setFetchedProjects(presetTemplates);
          }
        })
        .catch(() => setFetchedProjects(presetTemplates))
        .finally(() => setIsFetchingProjects(false));
    } else if (selectedSyncPlatform === 'vercel') {
      fetch('/api/cloudsync/vercel', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer vercel-api' }
      })
        .then(res => res.json())
        .then(data => {
          if (data?.status === 'success') {
            const vercelProjs = data.deployments.map((d: any) => ({
              id: d.id,
              name: d.name,
              displayName: `${d.name} (${d.env})`,
              description: `URL: ${d.url} • Repo Source: ${d.repo}`,
              isTemplate: true
            }));
            setFetchedProjects(vercelProjs);
          } else {
            setFetchedProjects(presetTemplates);
          }
        })
        .catch(() => setFetchedProjects(presetTemplates))
        .finally(() => setIsFetchingProjects(false));
    } else {
      const customProjs = presetTemplates.map(p => ({
        ...p,
        description: `Optimize, build & sync for continuous edge delivery under ${selectedSyncPlatform.toUpperCase()}. ${p.description}`
      }));
      setFetchedProjects(customProjs);
      setIsFetchingProjects(false);
    }
  }, [selectedSyncPlatform, activeTab, token, firebaseToken]);

  // Honest import: a real GitHub repo is genuinely pulled (server proxy); a template entry loads a real
  // starter template into the workspace. We label each accurately and never fake a "cloud sync" from a
  // platform we don't actually talk to. (Firebase/Vercel project listing returns not_available, so those
  // entries are starter templates.)
  const handleSyncProject = async (product: any) => {
    setIsSyncRunning(true);
    setSuccessfullySyncedProject(null);
    setSyncLogs([]);

    const timestamp = () => new Date().toLocaleTimeString();
    const addLogLine = (msg: string) => setSyncLogs(prev => [...prev, `[${timestamp()}] ${msg}`]);

    let targetFiles: Record<string, string> | null = null;
    const isRealGithubRepo = selectedSyncPlatform === 'github' && !product.isTemplate && !!token;

    if (isRealGithubRepo) {
      addLogLine(`Pulling "${product.displayName || product.name}" from GitHub…`);
      setSyncProgressStage('Pulling from GitHub…');
      try {
        const response = await fetch('/api/cloudsync/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `token ${token}` },
          body: JSON.stringify({ owner: product.owner || user?.login || 'username', repo: product.name, branch: 'main' }),
        });
        const result = await response.json();
        if (response.ok && result.files && Object.keys(result.files).length > 0) {
          targetFiles = result.files;
          addLogLine(`✅ Pulled ${Object.keys(result.files).length} file(s) from ${product.displayName || product.name}.`);
        } else {
          addLogLine(`⚠️ Couldn't read files from that repository${result?.error ? `: ${result.error}` : ''}.`);
        }
      } catch (err: any) {
        addLogLine(`❌ GitHub pull failed: ${err?.message || String(err)}.`);
      }
    } else {
      // A starter template — a real, local set of files we load into the workspace.
      const templateKey = product.id && TEMPLATE_PROJECTS[product.id] ? product.id : 'my-ecommerce-app';
      targetFiles = TEMPLATE_PROJECTS[templateKey].files;
      addLogLine(`Loading the "${product.displayName || product.name}" starter template…`);
      setSyncProgressStage('Loading template…');
    }

    if (targetFiles && Object.keys(targetFiles).length > 0) {
      if (onFilesChange) onFilesChange(targetFiles);
      addLogLine(isRealGithubRepo ? `✅ Imported into Code Studio.` : `✅ Template loaded into Code Studio.`);
      setSyncProgressStage('Done');
      setSuccessfullySyncedProject(product);
      // Surface the imported files IMMEDIATELY: switch the sidebar from this Git panel to the File
      // Explorer so the user actually SEES them. Previously the files loaded into the workspace but the
      // view stayed on the Git panel, so a repo click looked like "nothing happened". CodeStudio then
      // opens the first imported file in the editor (its file-set-change effect).
      onToggleView?.('files');
    } else {
      addLogLine(`Nothing was imported.`);
      setSyncProgressStage('Failed');
    }
    setIsSyncRunning(false);
  };

  // DevOps States
  const [selectedPlatform, setSelectedPlatform] = useState<string>(() => localStorage.getItem('v_deploy_platform') || 'github');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false);
  
  // Platform configuration state maps
  const [configs, setConfigs] = useState<Record<string, any>>({
    github: { repoName: 'navBharat-workspace-app', visibility: 'private', branch: 'main', commitMsg: 'Updated workspace core via navBharatAI', personalAccessToken: '', clientId: '', clientSecret: '' },
    firebase: { projectId: 'navbharat-sandbox-7729', functions: false, hosting: true, region: 'us-central1', customDomain: '', firebaseToken: '', serviceAccountKeyJson: '' },
    vercel: { teamContext: 'personal', env: 'production', outputDir: 'dist', configAutoInstall: true, vercelApiToken: '' },
    netlify: { siteId: 'navbharat-web-node', customBuildCommand: 'npm run build', outputDir: 'dist', webhookSupport: false, netlifyAccessToken: '' },
    cloudflare: { accountId: 'default-cloudflare', projName: 'navbharat-pages', branchRule: 'main', kvBindings: '', cloudflareApiToken: '' },
    gcloud: { projectId: 'gcp-navbharat-core', serviceName: 'navbharat-cloud-run', region: 'us-central1', port: '3000', minScale: '0', gcpServiceAccountJson: '' },
    docker: { imageRegistry: 'docker.io/navbharat-devs', tag: 'latest', autoDockerfile: true, dockerUsername: '', dockerPasswordToken: '' },
    render: { webhookUrl: '', apiSecret: '', serviceType: 'static', buildCmd: 'npm run build' },
    railway: { token: '', envId: 'production', dbEnabled: true },
    aws: { accessKey: '', secretKey: '', appName: 'navbharat-aws-amplify' },
    supabase: { url: 'https://navbharat-project.supabase.co', serviceRoleKey: '', dbConnectString: 'postgresql://...' },
    surge: { domain: 'navbharat-app.surge.sh', surgeToken: '' },
    digitalocean: { doToken: '', projName: 'navbharat-do-cluster', region: 'nyc1' },
    heroku: { herokuApiKey: '', appName: 'navbharat-heroku-web', dynoType: 'eco' },
    static: { zipName: 'navbharat-build-export.zip', minify: true },
    remote: { url: 'git@github.com:navbharat/workspace-terminal.git', privateKey: '' }
  });

  // Synchronize authenticated Firebase configurations
  useEffect(() => {
    if (firebaseToken && firebaseUser) {
      setConfigs(prev => ({
        ...prev,
        firebase: {
          ...prev.firebase,
          projectId: firebaseUser.projectId || prev.firebase.projectId || 'navbharat-sandbox-7729',
          firebaseToken: firebaseUser.token || firebaseToken || '',
          serviceAccountKeyJson: firebaseUser.serviceAccount || ''
        }
      }));
    }
  }, [firebaseToken, firebaseUser]);

  // Load project-specific isolated deployment settings
  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = localStorage.getItem(`v_deploy_configs_${projectId}`);
      if (saved) {
        setConfigs(JSON.parse(saved));
        return;
      }
    } catch (e) {}

    // Fallback/Init of project-specific default repoName
    let baseRepoName = 'navBharat-workspace-app';
    if (projectName) {
      baseRepoName = projectName.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 100);
      if (user?.login) {
        baseRepoName = `${user.login}/${baseRepoName}`;
      } else {
        baseRepoName = `workspace/${baseRepoName}`;
      }
    }

    const defaultConfigs = {
      github: { repoName: baseRepoName, visibility: 'private', branch: 'main', commitMsg: 'Updated workspace core via navBharatAI', personalAccessToken: '', clientId: '', clientSecret: '' },
      firebase: { projectId: 'navbharat-sandbox-7729', functions: false, hosting: true, region: 'us-central1', customDomain: '', firebaseToken: '', serviceAccountKeyJson: '' },
      vercel: { teamContext: 'personal', env: 'production', outputDir: 'dist', configAutoInstall: true, vercelApiToken: '' },
      netlify: { siteId: 'navbharat-web-node', customBuildCommand: 'npm run build', outputDir: 'dist', webhookSupport: false, netlifyAccessToken: '' },
      cloudflare: { accountId: 'default-cloudflare', projName: 'navbharat-pages', branchRule: 'main', kvBindings: '', cloudflareApiToken: '' },
      gcloud: { projectId: 'gcp-navbharat-core', serviceName: 'navbharat-cloud-run', region: 'us-central1', port: '3000', minScale: '0', gcpServiceAccountJson: '' },
      docker: { imageRegistry: 'docker.io/navbharat-devs', tag: 'latest', autoDockerfile: true, dockerUsername: '', dockerPasswordToken: '' },
      render: { webhookUrl: '', apiSecret: '', serviceType: 'static', buildCmd: 'npm run build' },
      railway: { token: '', envId: 'production', dbEnabled: true },
      aws: { accessKey: '', secretKey: '', appName: 'navbharat-aws-amplify' },
      supabase: { url: 'https://navbharat-project.supabase.co', serviceRoleKey: '', dbConnectString: 'postgresql://...' },
      surge: { domain: 'navbharat-app.surge.sh', surgeToken: '' },
      digitalocean: { doToken: '', projName: 'navbharat-do-cluster', region: 'nyc1' },
      heroku: { herokuApiKey: '', appName: 'navbharat-heroku-web', dynoType: 'eco' },
      static: { zipName: 'navbharat-build-export.zip', minify: true },
      remote: { url: 'git@github.com:navbharat/workspace-terminal.git', privateKey: '' }
    };

    localStorage.setItem(`v_deploy_configs_${projectId}`, JSON.stringify(defaultConfigs));
    setConfigs(defaultConfigs);
  }, [projectId, projectName, user?.login]);

  // Saving configs to local storage per-project
  const updateConfig = (platform: string, fields: any) => {
    const updated = {
      ...configs,
      [platform]: {
        ...configs[platform],
        ...fields
      }
    };
    setConfigs(updated);
    if (projectId) {
      localStorage.setItem(`v_deploy_configs_${projectId}`, JSON.stringify(updated));
    } else {
      localStorage.setItem('v_deploy_configs', JSON.stringify(updated));
    }
  };

  useEffect(() => {
    localStorage.setItem('v_deploy_platform', selectedPlatform);
  }, [selectedPlatform]);

  // Deployment Logs state
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deployStatus, setDeployStatus] = useState<'idle' | 'validating' | 'building' | 'deployed' | 'error' | 'unavailable'>('idle');
  const [activeStep, setActiveStep] = useState<number>(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [currentBuildTime, setCurrentBuildTime] = useState<number>(0);
  const [deployedUrl, setDeployedUrl] = useState<string>('');
  // History holds ONLY real deploy events (a real GitHub push). No fabricated/seed entries —
  // an empty history is the honest state for a workspace that has never been pushed.
  const [gitHistory, setGitHistory] = useState<Array<{ id: string; date: string; platform: string; commit: string; status: string; url: string }>>(() => {
    try {
      const saved = localStorage.getItem('v_deploy_history');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  interface ErrorDetails {
    provider: string;
    errorType: string;
    rawDetails: string;
    fixSuggestions: string;
  }
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);

  // Auto-retry countdown and log parameters
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const [isAutoRetryActive, setIsAutoRetryActive] = useState<boolean>(false);
  const [isLogsExpanded, setIsLogsExpanded] = useState<boolean>(false);

  // Timeout references list to safely cancel running steps
  const timeoutRefs = useRef<any[]>([]);
  const clearAllPipelineTimeouts = () => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  };

  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [deployLogs]);

  // Active timing ticker for current build
  useEffect(() => {
    let interval: any;
    if (deployStatus === 'validating' || deployStatus === 'building') {
      setCurrentBuildTime(0);
      const startTime = Date.now();
      interval = setInterval(() => {
        setCurrentBuildTime(Math.round((Date.now() - startTime) / 100) / 10);
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [deployStatus]);

  const handleRetryDeployment = () => {
    setShowErrorModal(false);
    setIsAutoRetryActive(false);
    setRetryCountdown(null);
    
    // Clear console logs & restart
    setDeployLogs([]);
    setTimeout(() => {
      if (selectedPlatform === 'github') {
        executeRealGitHubPush();
      } else {
        triggerPushAndDeploy();
      }
    }, 100);
  };

  const handleReconnectAccount = () => {
    setShowErrorModal(false);
    setIsAutoRetryActive(false);
    setRetryCountdown(null);
    if (selectedPlatform === 'github') {
      onConnect();
    } else if (selectedPlatform === 'firebase') {
      onFirebaseConnect();
    } else {
      // No real OAuth exists for these platforms — show the HONEST "not available" state instead of a
      // faked "handshake initiated" alert (which did nothing).
      showDeployUnavailable();
    }
  };

  const handleCopyLogs = () => {
    const header = `=== DEPLOYMENT FAILURE LOG ===\nPlatform: ${errorDetails?.provider || 'Unknown'}\nError: ${errorDetails?.errorType || 'Unknown'}\nDetails: ${errorDetails?.rawDetails || 'None'}\n\n`;
    navigator.clipboard.writeText(header + deployLogs.join('\n'))
      .then(() => alert('Pruned build and provider error logs copied safely!'))
      .catch((e) => console.error(e));
  };

  const handleCancelAutoRetry = () => {
    setIsAutoRetryActive(false);
    setRetryCountdown(null);
  };

  // Automatic retry countdown loop for Error Modal
  useEffect(() => {
    let timer: any;
    if (showErrorModal && isAutoRetryActive && retryCountdown !== null) {
      if (retryCountdown > 0) {
        timer = setTimeout(() => {
          setRetryCountdown(prev => (prev !== null ? prev - 1 : null));
        }, 1000);
      } else {
        // Countdown reached 0 index! Auto-retrigger
        handleRetryDeployment();
      }
    }
    return () => clearTimeout(timer);
  }, [showErrorModal, isAutoRetryActive, retryCountdown]);

  // helper to trigger error modal and set up retry countdown
  const triggerErrorDisplay = (details: ErrorDetails) => {
    setErrorDetails(details);
    setShowErrorModal(true);
    setIsAutoRetryActive(true);
    setRetryCountdown(10); // Start 10s auto-retry countdown
  };

  // Run real authentic GitHub deployment operations via our secure backend.
  const executeRealGitHubPush = async () => {
    clearAllPipelineTimeouts();
    setDeployStatus('validating');
    setDeployLogs([]);
    setActiveStep(1);
    setValidationErrors([]);

    const addLogLine = (line: string, delay: number = 0) => {
      const tid = setTimeout(() => {
        setDeployLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
      }, delay);
      timeoutRefs.current.push(tid);
    };

    addLogLine('🚀 Preparing project files for secure deployment...', 100);
    addLogLine('⏳ Detecting active workspace session details...', 300);

    const currentGithubConfig = configs.github;
    const rawRepoPath = (currentGithubConfig.repoName || '').trim();

    if (!rawRepoPath.includes('/')) {
      const tid = setTimeout(() => {
        setDeployStatus('error');
        addLogLine('❌ VALIDATION PIPELINE FAILED.');
        addLogLine('⚠️ Invalid repository format! Format must be "username/repository-name".');
        setValidationErrors(['Repository format must be "username/repository-name" (e.g. DocAsheesh/my-super-app)']);
        triggerErrorDisplay({
          provider: 'GitHub Sync & Pages',
          errorType: 'Invalid Repository',
          rawDetails: 'Repository format must be "username/repository-name" (e.g. DocAsheesh/my-super-app)',
          sidebarLink: 'git',
          fixSuggestions: 'Please open GitHub configuration in DevOps and set valid repository name e.g. "DocAsheesh/my-workspace" or retry.'
        } as any);
      }, 600);
      timeoutRefs.current.push(tid);
      return;
    }

    const [owner, repo] = rawRepoPath.split('/');
    if (!owner || !repo) {
      const tid = setTimeout(() => {
        setDeployStatus('error');
        addLogLine('❌ VALIDATION PIPELINE FAILED.');
        addLogLine('⚠️ Ensure both repository owner and repository name are filled out.');
        setValidationErrors(['Invalid repository owner or repository name!']);
        triggerErrorDisplay({
          provider: 'GitHub Sync & Pages',
          errorType: 'Invalid Repository',
          rawDetails: 'Invalid repository owner or repository name!',
          fixSuggestions: 'Ensure repository field has both owner name and repository name separate by a slash.'
        });
      }, 600);
      timeoutRefs.current.push(tid);
      return;
    }

    addLogLine('🟢 Connecting and authorizing with GitHub server API...', 700);
    addLogLine(`📁 Packaging ${Object.keys(files || {}).length} files from Code Studio buffers...`, 1000);

    const tidPush = setTimeout(async () => {
      setDeployStatus('building');
      setActiveStep(2);
      addLogLine('⚡ Instantiating git engine process...', 200);
      addLogLine(`🐋 Creating and pushing commits to remote heads/${currentGithubConfig.branch || 'main'}...`, 600);

      try {
        const response = await fetch('/api/github/push-enhanced', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            owner: owner.trim(),
            repo: repo.trim(),
            files: files,
            visibility: currentGithubConfig.visibility,
            branch: currentGithubConfig.branch || 'main',
            message: currentGithubConfig.commitMsg || 'Updated workspace core via navBharatAI'
          })
        });

        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Server rejected the Git sync data stream.');
        }

        setDeployStatus('deployed');
        setActiveStep(3);
        setDeployedUrl(data.repoUrl);
        addLogLine(`🎉 GITHUB PUSH SUCCESSFUL! Live Repository: ${data.repoUrl}`);
        addLogLine(`🔒 Version commit hash tracked: ${data.sha.substring(0, 7)}`);

        // Record deployment success in history lists
        const newHistoryItem = {
          id: data.sha.substring(0, 7),
          date: new Date().toLocaleString(),
          platform: 'github',
          commit: currentGithubConfig.commitMsg || 'Automated workspace push',
          status: 'success',
          url: data.repoUrl
        };
        const updatedHistory = [newHistoryItem, ...gitHistory];
        setGitHistory(updatedHistory);
        
        if (projectId) {
          localStorage.setItem(`v_deploy_history_${projectId}`, JSON.stringify(updatedHistory));
        }
        localStorage.setItem('v_deploy_history', JSON.stringify(updatedHistory));

      } catch (err: any) {
        setDeployStatus('error');
        addLogLine(`❌ PIPELINE CRITICAL RUNTIME ERROR: ${err.message}`);
        addLogLine('⚠️ Double check your network, authorization scopes, and retry.');
        triggerErrorDisplay({
          provider: 'GitHub Sync & Pages',
          errorType: err.message.toLowerCase().includes('authority') || err.message.toLowerCase().includes('token') ? 'Authentication Failed' : 'Git Push Rejected',
          rawDetails: err.message || 'Server rejected the Git sync data stream or connection timed out.',
          fixSuggestions: err.message.toLowerCase().includes('token') || err.message.toLowerCase().includes('auth')
            ? 'Reconnect your GitHub Account in settings or generate a fresh Personal Access Token.'
            : 'Check if your repository is public/private, verify naming spelling, and check remote git head permissions.'
        });
      }
    }, 1500);
    timeoutRefs.current.push(tidPush);
  };

  // Real-or-honest deploy. NEVER fabricates success for a target we cannot actually deploy to.
  //  • GitHub  → a real commit/push (executeRealGitHubPush → /api/github/push-enhanced).
  //  • Static  → a real ZIP of the workspace files, downloaded in the browser (JSZip).
  //  • Anything else → an honest "not available yet + the real path" message (no fake URL/success).
  const exportStaticZip = async () => {
    clearAllPipelineTimeouts();
    setValidationErrors([]);
    setDeployedUrl('');
    setActiveStep(2);
    setDeployStatus('building');
    const addLog = (line) => setDeployLogs(prev => [...prev, '[' + new Date().toLocaleTimeString() + '] ' + line]);
    setDeployLogs(['[' + new Date().toLocaleTimeString() + '] 📦 Packaging your workspace into a ZIP…']);
    const entries = Object.entries(files || {});
    if (entries.length === 0) {
      setDeployStatus('error');
      addLog('❌ No files in the workspace to export.');
      return;
    }
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const [path, content] of entries) zip.file(path, typeof content === 'string' ? content : String(content ?? ''));
      const blob = await zip.generateAsync({ type: 'blob' });
      const fileName = sanitizeZipName(configs.static?.zipName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      addLog('✅ Exported ' + entries.length + ' file(s) → ' + fileName + '. Check your browser downloads.');
      setActiveStep(3);
      setDeployStatus('deployed');
    } catch (err) {
      setDeployStatus('error');
      addLog('❌ ZIP export failed: ' + (err?.message || String(err)));
    }
  };

  const showDeployUnavailable = () => {
    clearAllPipelineTimeouts();
    setValidationErrors([]);
    setDeployedUrl('');
    setActiveStep(1);
    setDeployStatus('unavailable');
    const name = DEPLOY_PLATFORMS.find(p => p.id === selectedPlatform)?.name || selectedPlatform.toUpperCase();
    const now = () => new Date().toLocaleTimeString();
    setDeployLogs(unavailableDeployMessage(name).map(line => '[' + now() + '] ' + line));
  };

  // SEPARATE BACKEND (admin 2026-07-31): for a backend host (Cloud Run / Render / Railway) we don't fake a
  // deploy — we make the backend deploy-READY by adding the real host config (Dockerfile / render.yaml /
  // railway.json) to the project, then show the honest BYO-account steps. The user pushes to GitHub and
  // connects their OWN host account (per CLAUDE.md: user apps never deploy on NavBharatAI's account).
  const injectBackendDeployConfig = () => {
    clearAllPipelineTimeouts();
    setValidationErrors([]);
    setDeployedUrl('');
    setActiveStep(1);
    const inj = buildBackendConfigInjection(selectedPlatform, files);
    if (!inj) { showDeployUnavailable(); return; }
    if (onFilesChange) onFilesChange(inj.nextFiles); // add the config files to the project (real, no fake deploy)
    setDeployStatus('unavailable'); // honest: config added, but the deploy itself is the user's next step
    const now = () => new Date().toLocaleTimeString();
    setDeployLogs(inj.logLines.map((line) => '[' + now() + '] ' + line));
  };

  // Run the real deploy action for the selected target, or honestly report it isn't available.
  const triggerPushAndDeploy = () => {
    clearAllPipelineTimeouts();
    // A separate-backend host: generate + inject its real deploy config (never a faked deploy).
    if (isBackendDeployHost(selectedPlatform)) { injectBackendDeployConfig(); return; }
    switch (deployCapability(selectedPlatform)) {
      case 'github-push':
        executeRealGitHubPush();
        return;
      case 'static-zip':
        void exportStaticZip();
        return;
      default:
        // Real one-click deploy for the providers v5.0's engine actually supports (Firebase, Vercel,
        // Netlify, Cloudflare): hand off to v5's real build+deploy pipeline. Everything else stays
        // honestly "not available yet" until its real provider ships.
        if (isV5DeployProvider(selectedPlatform) && onDeployViaV5) {
          const name = DEPLOY_PLATFORMS.find(p => p.id === selectedPlatform)?.name || selectedPlatform;
          setDeployStatus('idle');
          setDeployLogs([`[${new Date().toLocaleTimeString()}] 🚀 Handing off to NavBharatAI Pro v5.0 to build and deploy to ${name} — watch the live progress there.`]);
          onDeployViaV5(selectedPlatform);
          return;
        }
        showDeployUnavailable();
        return;
    }
  };

  const changesCount = Object.keys(files).length;
  const changes = Object.keys(files).map(f => ({
    file: f,
    status: 'M',
    color: 'text-amber-500'
  }));

  const filteredPlatforms = DEPLOY_PLATFORMS.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedPlatformObj = DEPLOY_PLATFORMS.find(p => p.id === selectedPlatform) || DEPLOY_PLATFORMS[0];
  const CurrentPltIcon = selectedPlatformObj.icon;

  const syncPlatformObj = DEPLOY_PLATFORMS.find(p => p.id === selectedSyncPlatform) || DEPLOY_PLATFORMS[0];
  const SyncPltIcon = syncPlatformObj.icon;

  return (
    <div className="flex flex-col h-full bg-[#161b22] text-white">
      {/* Upper Navigation Tabs */}
      <div className="flex bg-[#0d1117] border-b border-white/5 select-none shrink-0 p-1 gap-1">
        <button 
          onClick={() => setActiveTab2('deploy')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
            activeTab === 'deploy' 
              ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/25" 
              : "text-[#8b949e] hover:text-white hover:bg-white/5 border border-transparent"
          )}
        >
          <Rocket className="w-3.5 h-3.5" />
          Cloud Deploy
        </button>
        <button 
          onClick={() => setActiveTab2('sync')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
            activeTab === 'sync' 
              ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/25" 
              : "text-[#8b949e] hover:text-white hover:bg-white/5 border border-transparent"
          )}
        >
          <Cloud className="w-3.5 h-3.5" />
          🔥 Cloud Sync
        </button>
      </div>

      {/* Mobile-friendly: BOTH tabs scroll as one natural column (the Sync tab used to be overflow-hidden
          → its content was clipped and unreachable on a short mobile screen). A visible scrollbar signals
          scrollability; the inner lists below are bounded (max-h) instead of flex-1 so they never trap the
          page scroll on mobile. */}
      <div className={cn("flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain")}>
        {activeTab === 'deploy' ? (
          <div className="p-4 space-y-4 flex flex-col flex-1">
            {/* Header / Intro */}
            <div className="relative p-4 rounded-2xl bg-gradient-to-br from-indigo-950/40 to-black/30 border border-indigo-500/10 space-y-2 overflow-hidden shadow-xl shrink-0">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl"></div>
              <div className="flex items-center gap-2 text-[9px] font-black uppercase text-indigo-400 tracking-wider">
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                Cloud Deployment Hub
              </div>
              <h4 className="text-sm font-black uppercase tracking-tight text-white leading-none">Push to GitHub &amp; Export</h4>
              <p className="text-[10px] text-[#8b949e] font-medium leading-relaxed">
                Live now: real commits/pushes to GitHub and a real ZIP export of your files. Other platforms connect to your GitHub repo for auto-deploy — we never fake a deployment.
              </p>
            </div>

            {/* Target Select Area */}
            <div className="space-y-1.5 relative select-none z-[80] shrink-0">
              <label className="text-[9px] font-black text-[#8b949e] uppercase tracking-wide">Select Deployment Target Platform</label>
              
              {/* Trigger drop-down */}
              <button 
                onClick={() => setShowPlatformDropdown(prev => !prev)}
                className="w-full bg-[#0d1117] hover:bg-[#12161f] border border-white/10 hover:border-indigo-500/40 rounded-xl p-3 flex items-center justify-between text-xs font-bold transition-all text-[#c9d1d9] shadow-inner select-none cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn("p-1.5 rounded-lg bg-white/5 border border-white/5", selectedPlatformObj.color)}>
                    <CurrentPltIcon className="w-4 h-4" />
                  </span>
                  <span className="text-white font-extrabold text-[11px] uppercase tracking-wide group-hover:text-indigo-400 transition-colors">
                    {selectedPlatformObj.name}
                  </span>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-[#8b949e] transition-transform duration-200", showPlatformDropdown && "rotate-180")} />
              </button>

              {/* Custom rich Dropdown selector */}
              <AnimatePresence>
                {showPlatformDropdown && (
                  <motion.div 
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute left-0 right-0 mt-1 bg-[#1c2128] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[100] max-h-60 flex flex-col backdrop-blur-lg"
                  >
                    <div className="p-2 border-b border-white/5 bg-[#0d1117]/80 flex items-center justify-between">
                      <div className="relative w-full">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8b949e]" />
                        <input 
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Filter 15+ deployment endpoints..."
                          className="w-full bg-[#161b22] text-[10px] pl-8 pr-3 py-1.5 rounded-lg border border-white/5 outline-none font-bold text-white placeholder-[#484f58] focus:border-indigo-500/40"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                    
                    <div className="overflow-y-auto no-scrollbar p-1 space-y-0.5">
                      {filteredPlatforms.map((plt) => {
                        const IconComponent = plt.icon;
                        const isCurrent = plt.id === selectedPlatform;
                        return (
                          <button
                            key={plt.id}
                            onClick={() => {
                              setSelectedPlatform(plt.id);
                              setShowPlatformDropdown(false);
                            }}
                            className={cn(
                              "w-full text-left p-2.5 rounded-lg flex items-center gap-3 transition-colors text-white cursor-pointer",
                              plt.bgHover,
                              isCurrent ? "bg-indigo-600/10 border border-indigo-500/20" : "border border-transparent"
                            )}
                          >
                            <span className={cn("p-1.5 rounded-lg bg-white/5 shrink-0", plt.color)}>
                              <IconComponent className="w-3.5 h-3.5" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className={cn("text-[11px] font-black uppercase tracking-wide leading-none", isCurrent ? "text-indigo-400" : "text-white")}>
                                  {plt.name}
                                </span>
                                {plt.badge && (
                                  <span className="text-[7.5px] font-black uppercase tracking-widest px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 leading-none">
                                    {plt.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-[9px] text-[#8b949e] truncate mt-0.5 font-medium leading-none">{plt.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                      {filteredPlatforms.length === 0 && (
                        <div className="text-center p-4 text-[10px] text-[#8b949e] italic font-medium">No deployment target matches filter...</div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Config & Parameters View Area */}
            <div className="flex-1 bg-[#0d1117] border border-white/10 rounded-2xl p-4 space-y-3 shadow-inner flex flex-col shrink-0 min-h-[220px]">
              <div className="flex items-center justify-between border-b border-white/5 pb-2 shrink-0">
                <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5" />
                  Target Variables & Env Setup
                </span>
                <span className="text-[9px] font-black text-white/50 bg-[#161b22] px-2 py-0.5 rounded border border-white/5">
                  {selectedPlatform.toUpperCase()} Mode
                </span>
              </div>

              <div className="pr-0.5 space-y-3 text-xs">
                {/* 1. GITHUB CONFIG */}
                {selectedPlatform === 'github' && (
                  <div className="space-y-4">
                    {/* AUTHENTICATION FEEDBACK STATUS CARD */}
                    <div className="p-3 bg-[#161b22] border border-white/10 rounded-2xl flex items-center justify-between gap-3 shrink-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-indigo-600/10 flex items-center justify-center border border-white/5 overflow-hidden shrink-0">
                          {user?.avatar_url ? (
                            <img src={user.avatar_url} referrerPolicy="no-referrer" alt="Avatar" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <Github className="w-4 h-4 text-white" />
                          )}
                        </div>
                        <div className="leading-tight text-left min-w-0">
                          <p className="text-[8.5px] text-[#8b949e] font-sans uppercase tracking-widest font-black">GitHub pipeline link</p>
                          {token ? (
                            <span className="text-emerald-400 font-extrabold text-[10px] flex items-center gap-1 mt-0.5 truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                              @{user?.login || 'Authorized'}
                            </span>
                          ) : (
                            <span className="text-yellow-400 font-extrabold text-[10px] flex items-center gap-1 mt-0.5 uppercase tracking-wide">
                              ⚠️ Disconnected
                            </span>
                          )}
                        </div>
                      </div>
                      {token && (
                        <button
                          onClick={onDisconnect}
                          className="px-2.5 py-1 bg-red-950/20 border border-red-500/20 rounded-lg text-[8px] font-black uppercase tracking-widest text-[#ff8080] hover:text-white transition-all cursor-pointer hover:bg-red-950/40"
                        >
                          Sign Out
                        </button>
                      )}
                    </div>

                    {!token ? (
                      <div className="space-y-3 pt-1">
                        <p className="text-[10px] text-[#8b949e] leading-relaxed italic text-center font-medium">
                          Authorize your GitHub account to instantiate repositories, push real commits, and manage staging targets dynamically.
                        </p>
                        <button 
                          onClick={onConnect} 
                          className="w-full h-10 bg-[#24292e] hover:bg-[#2f363d] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-white/10 hover:border-indigo-500/40 transition-all shadow-lg cursor-pointer select-none"
                        >
                          <Github className="w-3.5 h-3.5 text-white" />
                          Connect GitHub Pipeline
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3.5">
                        {/* Repository Input Field */}
                        <div className="space-y-1 text-left">
                          <label className="text-[9.5px] font-black text-[#8b949e] uppercase tracking-wide flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5 text-stone-400" />
                            Repository (username/repo)
                          </label>
                          <input 
                            type="text" 
                            placeholder="username/repository-name"
                            value={configs.github.repoName}
                            onChange={(e) => updateConfig('github', { repoName: e.target.value })}
                            className="w-full bg-[#161b22] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white outline-none focus:border-indigo-500/40"
                          />
                          <p className="text-[8px] text-[#8b949e] font-serif leading-tight">
                            Will create repo automatically under owner: <span className="text-white/60 font-semibold">{configs.github.repoName?.split('/')[0] || user?.login || 'profile'}</span> if it does not exist.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-left">
                          <div className="space-y-1">
                            <label className="text-[9.5px] font-bold text-[#8b949e]">Visibility</label>
                            <select 
                              value={configs.github.visibility}
                              onChange={(e) => updateConfig('github', { visibility: e.target.value })}
                              className="w-full bg-[#161b22] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white outline-none appearance-none cursor-pointer"
                            >
                              <option value="private">🔒 Private Repo</option>
                              <option value="public">🌐 Public Repo</option>
                            </select>
                          </div>
                          <div className="space-y-1 text-left">
                            <label className="text-[9.5px] font-bold text-[#8b949e]">Target Branch</label>
                            {/* J4: Create / select branch */}
                            <input
                              type="text"
                              value={configs.github.branch || 'main'}
                              onChange={(e) => updateConfig('github', { branch: e.target.value })}
                              placeholder="e.g. main, feature/xyz"
                              list="git-branch-suggestions"
                              className="w-full bg-[#161b22] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white outline-none focus:border-indigo-500/40 appearance-none cursor-text"
                            />
                            <datalist id="git-branch-suggestions">
                              <option value="main" />
                              <option value="staging" />
                              <option value="dev" />
                              <option value="feature/new-feature" />
                              <option value="fix/bug-fix" />
                            </datalist>
                          </div>
                        </div>

                        <div className="space-y-1 text-left">
                          <div className="flex items-center justify-between">
                            <label className="text-[9.5px] font-bold text-[#8b949e]">Commit Message</label>
                            <div className="flex items-center gap-2">
                              {/* J1: suggest a commit message from the changed files (local heuristic, not AI) */}
                              <button
                                onClick={generateCommitMessage}
                                title="Suggest a commit message from your changed files"
                                aria-label="Suggest a commit message from your changed files"
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20 transition-all uppercase tracking-widest"
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                Suggest
                              </button>
                              {/* J15: Character count warning */}
                              <span className={`text-[8px] font-mono ${(configs.github.commitMsg || '').length > 72 ? 'text-amber-400' : 'text-[#484f58]'}`}>
                                {(configs.github.commitMsg || '').length}/72
                              </span>
                            </div>
                          </div>
                          <input
                            type="text"
                            value={configs.github.commitMsg}
                            onChange={(e) => updateConfig('github', { commitMsg: e.target.value })}
                            maxLength={150}
                            className={`w-full bg-[#161b22] border rounded-xl p-2.5 text-xs font-bold text-white outline-none focus:border-indigo-500/40 ${(configs.github.commitMsg || '').length > 72 ? 'border-amber-500/40' : 'border-white/10'}`}
                          />
                          {(configs.github.commitMsg || '').length > 72 && (
                            <p className="text-[8px] text-amber-400 font-bold">Commit messages over 72 characters may be truncated in Git logs.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. FIREBASE CONFIG */}
                 {selectedPlatform === 'firebase' && (
                  <div className="space-y-4 text-left">
                    {/* FIREBASE AUTHENTICATION FEEDBACK STATUS CARD */}
                    <div className="p-3 bg-[#161b22] border border-white/10 rounded-2xl flex items-center justify-between gap-3 shrink-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center border border-white/5 overflow-hidden shrink-0">
                          <Cloud className="w-4 h-4 text-amber-500 animate-pulse" />
                        </div>
                        <div className="leading-tight text-left min-w-0">
                          <p className="text-[8.5px] text-[#8b949e] font-sans uppercase tracking-widest font-black">Firebase DevOps link</p>
                          {firebaseToken ? (
                            <span className="text-amber-400 font-extrabold text-[10px] flex items-center gap-1 mt-0.5 truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                              {firebaseUser?.projectId || configs.firebase.projectId || 'Connected'}
                            </span>
                          ) : (
                            <span className="text-yellow-400/80 font-extrabold text-[10px] flex items-center gap-1 mt-0.5 uppercase tracking-wide">
                              ⚠️ Disconnected
                            </span>
                          )}
                        </div>
                      </div>
                      {firebaseToken && (
                        <button
                          onClick={onFirebaseDisconnect}
                          className="px-2.5 py-1 bg-red-950/20 border border-red-500/20 rounded-lg text-[8px] font-black uppercase tracking-widest text-[#ff8080] hover:text-white transition-all cursor-pointer hover:bg-red-950/40"
                        >
                          Sign Out
                        </button>
                      )}
                    </div>

                    {!firebaseToken ? (
                      <div className="space-y-3 pt-1">
                        <p className="text-[10px] text-[#8b949e] leading-relaxed italic text-center font-medium">
                          Authorize and bind your Google/Firebase Console account to populate secure deploy tokens and project rules in one-click.
                        </p>
                        <button 
                          onClick={onFirebaseConnect} 
                          className="w-full h-10 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-amber-600/20 shadow-lg cursor-pointer select-none transition-all"
                        >
                          <Cloud className="w-3.5 h-3.5 text-slate-950" />
                          Connect Firebase Pipeline
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[9.5px] font-bold text-[#8b949e]">Target Firebase Project ID</label>
                          <input 
                            type="text"
                            placeholder="e.g. sample-project-99d"
                            value={configs.firebase.projectId}
                            onChange={(e) => updateConfig('firebase', { projectId: e.target.value })}
                            className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none focus:border-indigo-500/40"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-2 p-2.5 rounded-lg bg-[#161b22] border border-white/5 cursor-pointer hover:bg-white/5">
                            <input 
                              type="checkbox" 
                              checked={configs.firebase.hosting}
                              onChange={(e) => updateConfig('firebase', { hosting: e.target.checked })}
                              className="accent-amber-500"
                            />
                            <span className="text-[10px] font-bold text-[#c9d1d9]">Hosting Deployment</span>
                          </label>
                          <label className="flex items-center gap-2 p-2.5 rounded-lg bg-[#161b22] border border-white/5 cursor-pointer hover:bg-white/5">
                            <input 
                              type="checkbox" 
                              checked={configs.firebase.functions}
                              onChange={(e) => updateConfig('firebase', { functions: e.target.checked })}
                              className="accent-amber-500"
                            />
                            <span className="text-[10px] font-bold text-[#c9d1d9]">Cloud Functions</span>
                          </label>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9.5px] font-bold text-[#8b949e]">Serverless Region Target</label>
                          <select 
                            value={configs.firebase.region}
                            onChange={(e) => updateConfig('firebase', { region: e.target.value })}
                            className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none cursor-pointer"
                          >
                            <option value="us-central1">us-central-1 (Iowa)</option>
                            <option value="asia-southeast1">asia-southeast-1 (Singapore)</option>
                            <option value="europe-west1">europe-west-1 (Belgium)</option>
                          </select>
                        </div>
                        {/* CREDENTIALS BOX */}
                        <div className="p-3 bg-[#161b22] border border-white/10 rounded-xl space-y-2 mt-2">
                          <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-amber-500 block">Firebase Authorization Setup</span>
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono font-bold text-white/70">Firebase CLI CI Token</label>
                            <input 
                              type="password"
                              placeholder="1//0xxxxxxx-xxxxxxxxxxxxxxxxxxxx"
                              value={configs.firebase.firebaseToken || ''}
                              onChange={(e) => updateConfig('firebase', { firebaseToken: e.target.value })}
                              className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-2 text-[10.5px] font-mono text-amber-300 outline-none focus:border-amber-500/50"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono font-bold text-white/70">Service Account Key (JSON Option)</label>
                            <textarea 
                              rows={2}
                              placeholder='{ "type": "service_account", ... }'
                              value={configs.firebase.serviceAccountKeyJson || ''}
                              onChange={(e) => updateConfig('firebase', { serviceAccountKeyJson: e.target.value })}
                              className="w-full bg-[#0d1117] text-amber-200/80 hover:text-white border border-white/10 rounded-lg p-2 font-mono text-[9px] outline-none h-14 resize-none focus:border-amber-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. VERCEL CONFIG */}
                {selectedPlatform === 'vercel' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9.5px] font-bold text-[#8b949e]">Deployment Target</label>
                        <select 
                          value={configs.vercel.env}
                          onChange={(e) => updateConfig('vercel', { env: e.target.value })}
                          className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none cursor-pointer"
                        >
                          <option value="production">Production</option>
                          <option value="preview">Staging Preview</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9.5px] font-bold text-[#8b949e]">Org Team Namespace</label>
                        <input 
                          type="text" 
                          value={configs.vercel.teamContext}
                          onChange={(e) => updateConfig('vercel', { teamContext: e.target.value })}
                          className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">Deploy Output Directory Override</label>
                      <input 
                        type="text" 
                        value={configs.vercel.outputDir}
                        onChange={(e) => updateConfig('vercel', { outputDir: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none"
                      />
                    </div>
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-[#161b22] border border-white/5 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={configs.vercel.configAutoInstall}
                        onChange={(e) => updateConfig('vercel', { configAutoInstall: e.target.checked })}
                        className="accent-indigo-500"
                      />
                      <span className="text-[10px] font-bold text-[#c9d1d9]">Auto-install modules via Yarn cache</span>
                    </label>
                    {/* CREDENTIALS BOX */}
                    <div className="p-3 bg-stone-900 border border-stone-700/55 rounded-xl space-y-2 mt-2">
                      <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-[#d6d3d1] block">Vercel Authorization Setup</span>
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono font-bold text-white/70">Vercel Web Token</label>
                        <input 
                          type="password"
                          placeholder="erc_xxxxxxxxxxxxxxxxxxxxxxxx"
                          value={configs.vercel.vercelApiToken || ''}
                          onChange={(e) => updateConfig('vercel', { vercelApiToken: e.target.value })}
                          className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-2 text-[10.5px] font-mono text-stone-300 outline-none focus:border-stone-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. NETLIFY CONFIG */}
                {selectedPlatform === 'netlify' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">Netlify Custom Site Title</label>
                      <input 
                        type="text" 
                        value={configs.netlify.siteId}
                        onChange={(e) => updateConfig('netlify', { siteId: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">Framework Build Command Trigger</label>
                      <input 
                        type="text" 
                        value={configs.netlify.customBuildCommand}
                        onChange={(e) => updateConfig('netlify', { customBuildCommand: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none focus:border-indigo-500/40"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">Publish build path</label>
                      <input 
                        type="text" 
                        value={configs.netlify.outputDir}
                        onChange={(e) => updateConfig('netlify', { outputDir: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none focus:border-indigo-500/40"
                      />
                    </div>
                    {/* CREDENTIALS BOX */}
                    <div className="p-3 bg-teal-950/10 border border-teal-500/15 rounded-xl space-y-2 mt-2">
                      <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-teal-400 block">Netlify Authorization Setup</span>
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono font-bold text-white/70">Netlify Personal Access Token</label>
                        <input 
                          type="password"
                          placeholder="nlp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          value={configs.netlify.netlifyAccessToken || ''}
                          onChange={(e) => updateConfig('netlify', { netlifyAccessToken: e.target.value })}
                          className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-2 text-[10.5px] font-mono text-teal-300 outline-none focus:border-teal-500/50"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. GOOGLE CLOUD RUN */}
                {selectedPlatform === 'gcloud' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">GCP Project ID Identity</label>
                      <input 
                        type="text" 
                        value={configs.gcloud.projectId}
                        onChange={(e) => updateConfig('gcloud', { projectId: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9.5px] font-bold text-[#8b949e]">Service Name</label>
                        <input 
                          type="text" 
                          value={configs.gcloud.serviceName}
                          onChange={(e) => updateConfig('gcloud', { serviceName: e.target.value })}
                          className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9.5px] font-bold text-[#8b949e]">Console Location</label>
                        <select 
                          value={configs.gcloud.region}
                          onChange={(e) => updateConfig('gcloud', { region: e.target.value })}
                          className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none cursor-pointer"
                        >
                          <option value="us-central1">us-central1</option>
                          <option value="asia-southeast1">asia-southeast1</option>
                          <option value="europe-west1">europe-west1</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9.5px] font-bold text-[#8b949e]">Run Port Mapping</label>
                        <input 
                          type="text" 
                          value={configs.gcloud.port}
                          onChange={(e) => updateConfig('gcloud', { port: e.target.value })}
                          className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none text-center"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9.5px] font-bold text-[#8b949e]">Minimum Scale</label>
                        <input 
                          type="number" 
                          value={configs.gcloud.minScale}
                          onChange={(e) => updateConfig('gcloud', { minScale: e.target.value })}
                          className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none text-center"
                        />
                      </div>
                    </div>
                    {/* CREDENTIALS BOX */}
                    <div className="p-3 bg-blue-950/15 border border-blue-500/15 rounded-xl space-y-2 mt-2">
                      <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-[#60a5fa] block">Google Cloud Platform Auth</span>
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono font-bold text-white/70">Service Account Credential JSON Key</label>
                        <textarea 
                          rows={2}
                          placeholder='{ "type": "service_account", "private_key": "...", ... }'
                          value={configs.gcloud.gcpServiceAccountJson || ''}
                          onChange={(e) => updateConfig('gcloud', { gcpServiceAccountJson: e.target.value })}
                          className="w-full bg-[#0d1117] text-blue-200/80 hover:text-white border border-white/10 rounded-lg p-2 font-mono text-[9px] outline-none h-14 resize-none focus:border-blue-500/50"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 6. DOCKER INTEGRATION */}
                {selectedPlatform === 'docker' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">Docker Hub Namespace Repository</label>
                      <input 
                        type="text" 
                        value={configs.docker.imageRegistry}
                        onChange={(e) => updateConfig('docker', { imageRegistry: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none focus:border-indigo-500/40"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9.5px] font-bold text-[#8b949e]">Image Tag Version</label>
                      <input 
                        type="text" 
                        value={configs.docker.tag}
                        onChange={(e) => updateConfig('docker', { tag: e.target.value })}
                        className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none focus:border-indigo-500/40"
                      />
                    </div>
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-[#161b22] border border-white/5 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={configs.docker.autoDockerfile}
                        onChange={(e) => updateConfig('docker', { autoDockerfile: e.target.checked })}
                        className="accent-indigo-500"
                      />
                      <span className="text-[10px] font-bold text-[#c9d1d9]">Auto-generate secure multi-stage Dockerfile</span>
                    </label>
                    {/* CREDENTIALS BOX */}
                    <div className="p-3 bg-blue-950/15 border border-[#2496ed]/20 rounded-xl space-y-2 mt-2">
                      <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-[#2496ed] block">Docker Hub Account handshakes</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[8.5px] font-mono text-white/70">Hub Username</label>
                          <input 
                            type="text"
                            placeholder="username"
                            value={configs.docker.dockerUsername || ''}
                            onChange={(e) => updateConfig('docker', { dockerUsername: e.target.value })}
                            className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-1.5 text-[10px] text-white outline-none focus:border-indigo-500/30"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8.5px] font-mono text-white/70">Access Token/Pass</label>
                          <input 
                            type="password"
                            placeholder="dckr_pat_..."
                            value={configs.docker.dockerPasswordToken || ''}
                            onChange={(e) => updateConfig('docker', { dockerPasswordToken: e.target.value })}
                            className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-1.5 text-[10px] text-white outline-none focus:border-indigo-500/30"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 7. OTHER GENERIC PLATFORMS (Surge, Custom and Fallbacks) */}
                {!['github', 'firebase', 'vercel', 'netlify', 'gcloud', 'docker'].includes(selectedPlatform) && (
                  <div className="space-y-3">
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-[10px] text-[#8b949e] font-serif leading-relaxed">
                      Sovereign Multi-service target detected. Configure standard custom integration credentials and path setups safely.
                    </div>
                    {configs[selectedPlatform] && Object.keys(configs[selectedPlatform]).map((key) => {
                      const value = configs[selectedPlatform][key];
                      if (typeof value === 'boolean') {
                        return (
                          <label key={key} className="flex items-center gap-2 p-2.5 rounded-lg bg-[#161b22] border border-white/5 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={value}
                              onChange={(e) => {
                                const payload = { [key]: e.target.checked };
                                updateConfig(selectedPlatform, payload);
                              }}
                              className="accent-indigo-500"
                            />
                            <span className="text-[10px] font-extrabold uppercase text-[#c9d1d9] tracking-wider leading-none">
                              {key.replace(/([A-Z])/g, ' $1')}
                            </span>
                          </label>
                        );
                      }
                      return (
                        <div key={key} className="space-y-1">
                          <label className="text-[9.5px] font-extrabold text-[#8b949e] uppercase tracking-wider">{key.replace(/([A-Z])/g, ' $1')}</label>
                          <input 
                            type="text" 
                            value={value}
                            onChange={(e) => {
                              const payload = { [key]: e.target.value };
                              updateConfig(selectedPlatform, payload);
                            }}
                            className="w-full bg-[#161b22] border border-white/10 rounded-lg p-2.5 text-[11px] font-bold text-white outline-none focus:border-indigo-500/40"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>


            {/* Validation warning block if any */}
            {validationErrors.length > 0 && (
              <div className="p-3 rounded-2xl bg-red-950/25 border border-red-500/20 text-[9.5px] text-[#ff8080] font-medium leading-relaxed space-y-1 animate-in shake duration-200 shrink-0">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Pre-deployment validation halt
                </div>
                {validationErrors.map((err, idx) => (
                  <div key={idx} className="flex items-start gap-1">
                    <span className="select-none text-red-500">•</span>
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            {/* J16: Sync (Pull + Push) shortcut */}
            {selectedPlatform === 'github' && token && (
              <div className="shrink-0">
                <button
                  onClick={() => {
                    if (!(configs.github.commitMsg || '').trim()) {
                      setDeployLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ Commit message required for sync.`]);
                      return;
                    }
                    setDeployLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⬆️ Pushing local commits to the remote…`]);
                    setShowConfirmModal(true);
                  }}
                  disabled={deployStatus === 'validating' || deployStatus === 'building'}
                  className="w-full h-8 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 text-[#8b949e] hover:text-white rounded-xl text-[9px] font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-all"
                  title="Push your local commits to the remote (a remote→local pull is not performed)"
                >
                  <RefreshCcw className="w-3 h-3" />
                  Push to Remote
                </button>
              </div>
            )}

            {/* Deploy Trigger Button */}
            <div className="shrink-0 pt-1 select-none">
              <button
                onClick={() => {
                  if (selectedPlatform === 'github') {
                    if (!token) {
                      onConnect();
                    } else {
                      // J6: Require a non-empty commit message before pushing
                      if (!(configs.github.commitMsg || '').trim()) {
                        setDeployLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ Commit message is required. Please enter a message before pushing.`]);
                        return;
                      }
                      setShowConfirmModal(true);
                    }
                  } else if (selectedPlatform === 'firebase') {
                    if (!firebaseToken) {
                      onFirebaseConnect?.();
                    } else {
                      triggerPushAndDeploy();
                    }
                  } else {
                    triggerPushAndDeploy();
                  }
                }}
                disabled={deployStatus === 'validating' || deployStatus === 'building'}
                className="w-full h-11 bg-gradient-to-r from-indigo-600 via-orange-600 to-[#10b981] disabled:opacity-40 text-white rounded-xl text-[10.5px] font-black uppercase tracking-[0.18em] flex items-center justify-center gap-2 shadow-2xl hover:scale-[1.01] active:scale-[0.98] transition-all cursor-pointer shadow-indigo-500/15"
              >
                {deployStatus === 'validating' || deployStatus === 'building' ? (
                  <>
                    <TirangaLoader className="w-4 h-4 text-white" />
                    Executing Push Pipeline...
                  </>
                ) : (
                  <>
                    {selectedPlatform === 'github' ? <Github className="w-4 h-4 text-white" /> : <Rocket className="w-4 h-4 text-white" />}
                    {selectedPlatform === 'github' ? '🚀 Push to GitHub' : '🚀 Push / Deploy'}
                  </>
                )}
              </button>
            </div>

            {/* Live Interactive Deploy Console Logs */}
            {(deployStatus !== 'idle' || deployLogs.length > 0) && (
              <div className="bg-[#0b0e14] border border-white/10 rounded-2xl p-4 space-y-2 max-h-[190px] shrink-0 flex flex-col overflow-hidden shadow-2xl relative">
                {/* Upper Status indicators */}
                <div className="flex items-center justify-between border-b border-white/5 pb-1.5 shrink-0 text-[9px] font-medium text-[#c9d1d9]">
                  <span className="text-[#8b949e] flex items-center gap-1 font-mono uppercase tracking-widest text-[8px]">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    DevOps Console Terminal Logs
                  </span>
                  <div className="flex items-center gap-2">
                    {deployStatus === 'validating' && <span className="text-yellow-400 animate-pulse font-bold">Validating...</span>}
                    {deployStatus === 'building' && <span className="text-amber-500 animate-pulse font-bold">Building...</span>}
                    {deployStatus === 'deployed' && <span className="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ready</span>}
                    {deployStatus === 'error' && <span className="text-red-400 font-bold">Error</span>}
                    {deployStatus === 'unavailable' && <span className="text-amber-400 font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Not available yet</span>}
                  </div>
                </div>

                {/* Console Log Screen */}
                <div className="flex-1 overflow-y-auto font-mono text-[9.5px] text-[#4af626] space-y-1 select-text scrollbar-thin scrollbar-thumb-white/5 pr-1">
                  {deployLogs.map((log, index) => {
                    const isErr = log.includes('❌') || log.includes('FAILED') || log.includes('halted');
                    const isSuccess = log.includes('🎉') || log.includes('✅') || log.includes('SUCCESSFUL');
                    return (
                      <div 
                        key={index} 
                        className={cn(
                          "leading-relaxed font-mono leading-none py-0.5",
                          isErr ? "text-red-400 font-bold" : isSuccess ? "text-emerald-400 font-black" : "text-[#4af626]/90"
                        )}
                      >
                        {log}
                      </div>
                    );
                  })}
                  {deployStatus === 'building' && (
                    <div className="flex items-center gap-1.5 text-amber-500 animate-pulse font-bold text-[8.5px] pt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                      PIPELINE ACTIVE... EXECUTING DOCKER BUILD ENGINE
                    </div>
                  )}
                  <div ref={consoleEndRef} />
                </div>
              </div>
            )}

            {/* Post Deployment details view */}
            {deployStatus === 'deployed' && deployedUrl && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-950/20 border border-emerald-500/25 rounded-2xl p-4 space-y-3 shrink-0 shadow-lg"
              >
                <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Pushed to GitHub
                </div>

                <div className="space-y-1 bg-black/40 border border-[#2b2b2b] rounded-xl p-3">
                  <span className="text-[8.5px] font-extrabold text-[#8b949e] uppercase tracking-wider">Repository URL</span>
                  <div className="flex items-center justify-between text-xs font-bold gap-3">
                    <a 
                      href={deployedUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-white hover:text-emerald-300 underline truncate select-all flex items-center gap-1 text-[11px]"
                    >
                      {deployedUrl}
                      <Globe className="w-3 h-3 text-emerald-400 inline" />
                    </a>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(deployedUrl);
                        alert('Copied repository URL to clipboard!');
                      }}
                      className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded transition-all cursor-pointer"
                      title="Copy URL"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[9px]">
                  <div className="p-2.5 rounded-xl bg-black/20 border border-white/5 flex flex-col">
                    <span className="text-[#8b949e] font-bold">Branch</span>
                    <span className="text-white font-black uppercase mt-0.5 truncate">{configs.github.branch || 'main'}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-black/20 border border-white/5 flex flex-col">
                    <span className="text-[#8b949e] font-bold">Files pushed</span>
                    <span className="text-white font-black uppercase mt-0.5">{Object.keys(files || {}).length}</span>
                  </div>
                </div>

                {/* J17: PR creation link after GitHub push */}
                {selectedPlatform === 'github' && configs.github.branch && configs.github.branch !== 'main' && configs.github.branch !== 'master' && (
                  <a
                    href={`${deployedUrl}/compare/main...${encodeURIComponent(configs.github.branch)}?expand=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-indigo-900/30 border border-indigo-500/30 text-indigo-300 text-[9px] font-black uppercase tracking-widest hover:bg-indigo-900/50 transition-all"
                  >
                    <Github className="w-3 h-3" />
                    Create Pull Request on GitHub
                  </a>
                )}

                <div className="flex items-center gap-2 justify-end pt-1">
                  <button
                    onClick={() => {
                      window.open(deployedUrl, '_blank');
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
                  >
                    Open on GitHub
                  </button>
                </div>
              </motion.div>
            )}

            {/* Deployment history list */}
            {gitHistory.length > 0 && (
              <div className="space-y-2 shrink-0">
                <h5 className="text-[9.5px] font-black text-[#8b949e] uppercase tracking-wider flex items-center gap-1.5 px-0.5">
                  <History className="w-3.5 h-3.5 text-indigo-400" />
                  DevOps Pipeline Deployment History
                </h5>
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto no-scrollbar">
                  {gitHistory.map((item) => {
                    const PltIcon = DEPLOY_PLATFORMS.find(p => p.id === item.platform)?.icon || Clock;
                    return (
                      <div 
                        key={item.id} 
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 flex items-center justify-between gap-3 text-xs font-bold shrink-0 transition-all cursor-pointer group"
                        onClick={() => window.open(item.url, '_blank')}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="p-1.5 rounded-lg bg-black/40 text-indigo-400 shrink-0 border border-white/5 group-hover:text-amber-400 transition-colors">
                            <PltIcon className="w-3.5 h-3.5" />
                          </span>
                          <div className="min-w-0 leading-tight">
                            <p className="text-white text-[11px] font-bold truncate pr-2">{item.commit}</p>
                            <p className="text-[8.5px] text-[#8b949e] font-serif uppercase tracking-wider mt-0.5 truncate">{item.platform.toUpperCase()} • {item.date}</p>
                          </div>
                        </div>
                        <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded shrink-0">
                          Live
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Premium Cloud Sync Panel */
          <div className="p-3 space-y-3 flex flex-col flex-1 min-h-0 select-none">
            {/* Header Description */}
            <div className="relative p-2.5 px-3 rounded-xl bg-gradient-to-br from-[#1f2937]/35 to-black/40 border border-white/5 overflow-hidden shadow-xl shrink-0">
              <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/5 rounded-full blur-xl"></div>
              <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-indigo-400 tracking-wider">
                <Cloud className="w-3.5 h-3.5 animate-pulse" />
                🔥 Cloud Sync Network
              </div>
              <p className="text-[10px] text-[#8b949e] leading-snug font-medium mt-1">
                Link repository structures and sync active files into Code Studio.
              </p>
            </div>

            {/* Platform Selector Dropdown */}
            <div className="relative space-y-1 shrink-0">
              <label className="text-[8px] font-black uppercase text-[#8b949e] tracking-wider px-1">Select Sync Platform</label>
              <button
                onClick={() => setSyncDropdownOpen(!syncDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-[#0d1117] border border-white/5 hover:border-white/10 rounded-xl text-xs font-bold transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("p-0.5 rounded bg-white/5", syncPlatformObj.color)}>
                    <SyncPltIcon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-white font-black text-[11px]">{syncPlatformObj.name}</span>
                </div>
                <ChevronDown className={cn("w-3.5 h-3.5 text-neutral-400 transition-transform", syncDropdownOpen ? "rotate-180" : "rotate-0")} />
              </button>

              <AnimatePresence>
                {syncDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute z-[100] top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto no-scrollbar bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl p-1 space-y-0.5"
                  >
                    {DEPLOY_PLATFORMS.map((platform) => {
                      const IconComponent = platform.icon;
                      return (
                        <button
                          key={platform.id}
                          onClick={() => {
                            setSelectedSyncPlatform(platform.id);
                            setSyncDropdownOpen(false);
                            setSuccessfullySyncedProject(null);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2.5 p-2 rounded-lg text-left text-xs font-semibold hover:bg-white/5 transition-all",
                            selectedSyncPlatform === platform.id ? "bg-white/5 border border-white/5 text-white" : "text-[#8b949e] border border-transparent"
                          )}
                        >
                          <span className={platform.color}>
                            <IconComponent className="w-3.5 h-3.5" />
                          </span>
                          <span className="flex-1 font-bold">{platform.name}</span>
                          {platform.badge && (
                            <span className="text-[7.5px] font-black uppercase tracking-widest px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              {platform.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Platform Connection Status Indicator Banner */}
            <div className="shrink-0">
              {/* GitHub Auth Status */}
              {selectedSyncPlatform === 'github' ? (
                token ? (
                  <div className="flex items-center justify-between p-2 px-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg overflow-hidden border border-emerald-500/20 shrink-0">
                        {user?.avatar_url ? (
                          <img src={user.avatar_url} alt="GitHub avatar" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full bg-neutral-900 border border-white/10 flex items-center justify-center text-white"><Github className="w-3.5 h-3.5" /></div>
                        )}
                      </div>
                      <div className="leading-none">
                        <p className="text-[10px] font-black text-white">@{user?.login || 'Authorized Account'}</p>
                        <span className="text-[8px] font-sans text-emerald-400 uppercase tracking-widest font-black inline-flex items-center gap-1 mt-0.5">
                          <span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                          ACTIVE HOST ACCESS
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={onDisconnect}
                      className="px-2 py-1 bg-neutral-950 hover:bg-red-500/10 text-[8px] font-black uppercase tracking-widest text-[#8b949e] hover:text-red-400 border border-white/5 hover:border-red-500/25 rounded-lg transition-all"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl space-y-2">
                    <div className="flex items-start gap-2">
                      <Lock className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <div className="leading-tight">
                        <p className="text-white text-[10px] font-black uppercase tracking-wide">Platform Access Locked</p>
                        <p className="text-[#8b949e] text-[8.5px] leading-snug mt-0.5">
                          Connect gateway credentials to browser templates.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={onConnect}
                      className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-stone-950 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Github className="w-3.5 h-3.5" />
                      Connect GitHub Gateway
                    </button>
                  </div>
                )
              ) : selectedSyncPlatform === 'firebase' ? (
                firebaseToken ? (
                  <div className="flex items-center justify-between p-2 px-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-orange-600/10 flex items-center justify-center border border-emerald-500/20 text-orange-400 shrink-0">
                        <Cloud className="w-3.5 h-3.5" />
                      </div>
                      <div className="leading-none">
                        <p className="text-[10px] font-black text-white truncate max-w-[120px]">{firebaseUser?.projectId || 'Connected Project'}</p>
                        <span className="text-[8px] font-sans text-emerald-400 uppercase tracking-widest font-black inline-flex items-center gap-1 mt-0.5">
                          <span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                          DATABASE LINKED
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={onFirebaseDisconnect}
                      className="px-2 py-1 bg-neutral-950 hover:bg-red-500/10 text-[8px] font-black uppercase tracking-widest text-[#8b949e] hover:text-red-400 border border-white/5 hover:border-red-500/25 rounded-lg transition-all"
                    >
                      Unlink
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl space-y-2">
                    <div className="flex items-start gap-2">
                      <Lock className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <div className="leading-tight">
                        <p className="text-white text-[10px] font-black uppercase tracking-wide">Firebase Sandbox Locked</p>
                        <p className="text-[#8b949e] text-[8.5px] leading-snug mt-0.5">
                          Configure Firebase credentials, databases and clusters.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={onFirebaseConnect}
                      className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-stone-950 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      Connect Firebase
                    </button>
                  </div>
                )
              ) : (
                /* Non-GitHub/Firebase cloud sync is NOT available yet — shown HONESTLY. We never fake a
                   "connected" state here: there is no real OAuth/backend for these platforms. Use GitHub. */
                <div className="p-3 bg-[#1f2937]/15 border border-white/5 rounded-xl space-y-2">
                  <div className="flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 text-[#8b949e] mt-0.5 shrink-0" />
                    <div className="leading-tight">
                      <p className="text-white text-[10px] font-black uppercase tracking-wide">{selectedSyncPlatform.toUpperCase()} sync — coming soon</p>
                      <p className="text-[#8b949e] text-[8.5px] leading-snug mt-0.5">
                        Direct {selectedSyncPlatform} cloud sync isn't available yet — we won't fake a connection that doesn't work. Use GitHub (fully supported) to push your project, or export a ZIP.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Searchable Projects List Container */}
            <div className="flex flex-col border border-white/5 rounded-xl p-2.5 space-y-2 bg-black/10 select-none">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[8.5px] font-black text-[#8b949e] uppercase tracking-wider px-1">Available Apps / Projects</span>
                {isFetchingProjects && <TirangaLoader className="w-3 h-3 text-indigo-400" />}
              </div>

              {/* Project Search Bar */}
              <div className="relative shrink-0">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2" />
                <input
                  type="text"
                  value={syncQuery}
                  onChange={(e) => setSyncQuery(e.target.value)}
                  placeholder="Search project repositories..."
                  className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500/50 transition-all text-white font-medium"
                />
              </div>

              {/* List grid */}
              <div className="max-h-[50vh] overflow-y-auto no-scrollbar space-y-1.5 pr-0.5">
                {fetchedProjects
                  .filter((p) => p.displayName?.toLowerCase().includes(syncQuery.toLowerCase()) || p.name?.toLowerCase().includes(syncQuery.toLowerCase()))
                  .map((project) => (
                    <button
                      key={project.id}
                      onClick={() => {
                        if (!isSyncRunning) {
                          handleSyncProject(project);
                        }
                      }}
                      disabled={isSyncRunning}
                      className="w-full p-2 rounded-lg bg-[#0d1117]/60 hover:bg-[#12161f] border border-white/5 hover:border-indigo-600/40 transition-all text-left flex justify-between items-center focus:ring-1 focus:ring-indigo-600/30"
                    >
                      <div className="min-w-0 pr-2 leading-none">
                        <h4 className="text-[11px] font-extrabold text-[#f0f6fc] truncate">{project.displayName}</h4>
                        <p className="text-[9px] text-[#8b949e] truncate mt-1 leading-normal font-medium max-w-[220px]">{project.description}</p>
                      </div>
                      <span className={cn(
                        "text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border leading-none font-sans shrink-0",
                        project.isTemplate 
                          ? "bg-amber-600/10 text-amber-400 border-amber-500/25" 
                          : "bg-indigo-600/10 text-indigo-400 border-indigo-500/25"
                      )}>
                        {project.isTemplate ? "Template" : "Repo"}
                      </span>
                    </button>
                  ))}

                {fetchedProjects.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-[10px] font-bold text-[#8b949e]">No repositories or packages matching query.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Live Progress Sync Console */}
            {isSyncRunning && (
              <div className="bg-black/95 border border-white/5 p-2 px-3 rounded-xl font-mono text-[9px] text-zinc-400 space-y-1.5 shrink-0 relative overflow-hidden">
                <div className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-[8px] font-sans font-black text-indigo-400 uppercase tracking-widest">Sync Console</span>
                  <div className="flex items-center gap-1">
                    <span className="w-1 h-1 bg-yellow-500 rounded-full animate-ping" />
                    <span className="text-[7.5px] font-sans text-neutral-500 uppercase tracking-widest">{syncProgressStage}</span>
                  </div>
                </div>
                <div className="space-y-0.5 max-h-[60px] overflow-y-auto no-scrollbar">
                  {syncLogs.slice(-3).map((log, i) => (
                    <div key={i} className="line-clamp-2 leading-tight text-neutral-400">{log}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Success notification & Premium workspace activate triggers */}
            {successfullySyncedProject && (
              <div className="bg-indigo-600/10 border border-indigo-500/35 p-2.5 px-3 rounded-xl space-y-2 shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  <div className="leading-none">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-wide">Sync Successful!</h4>
                    <p className="text-[8.5px] text-[#8b949e] font-semibold mt-0.5">
                      Synchronized <b>{successfullySyncedProject.displayName}</b>.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    onClick={() => setShowModeModal(true)}
                    className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[9px] tracking-wider py-1.5 rounded-lg shadow-lg transition-all active:scale-95 cursor-pointer border border-indigo-500"
                  >
                    <Sparkles className="w-3 h-3" />
                    🔥 AI Workspace
                  </button>
                  <button
                    onClick={() => {
                      if (onActivatePreview) {
                        onActivatePreview();
                      }
                    }}
                    className="flex items-center justify-center gap-1  bg-neutral-900 hover:bg-neutral-800 text-white font-black uppercase text-[9px] tracking-wider py-1.5 rounded-lg border border-white/5 hover:border-white/10 transition-all active:scale-95 cursor-pointer"
                  >
                    <Globe className="w-3 h-3 text-indigo-400" />
                    👁️ Preview
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        // Removed Vishwakarma multi-model action tiers modal
        <AnimatePresence>
          {showModeModal && (
            <div className="fixed inset-0 bg-[#0d1117]/85 backdrop-blur-md z-[2000] flex flex-col justify-center p-6 select-none animate-in fade-in duration-200">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="bg-[#161b22] border border-white/10 rounded-3xl p-6 shadow-2xl relative space-y-5 max-w-sm ml-auto mr-auto text-left"
              >
                <div className="flex justify-between items-start border-b border-white/5 pb-3">
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-tight text-white leading-tight">DevOps Orchestrator Tiers</h4>
                    <span className="text-[9.5px] text-indigo-400 tracking-wider font-black uppercase mt-1 inline-block">navBharatAI Core Engine</span>
                  </div>
                  <span className="p-1 px-2.5 rounded-full bg-indigo-500/15 border border-indigo-500/25 text-[8px] font-black uppercase tracking-widest text-indigo-400 font-sans">
                    Premium Active
                  </span>
                </div>

                <p className="text-[10px] text-[#8b949e] leading-snug font-medium">
                  Select the underlying cognitive orchestration tier to initiate live code edits, refactor, and build pipelines over files in real-time.
                </p>

                  <div className="space-y-3">
                  <button
                    onClick={() => {
                        if (onAgentChange) onAgentChange('navbharatai');
                        setShowModeModal(false);
                    }}
                    className="w-full p-3.5 rounded-2xl bg-neutral-900 border border-white/5 hover:border-indigo-500/30 text-left space-y-1 group transition-all"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-white uppercase tracking-wide group-hover:text-indigo-400">NavBharatAi FREE</span>
                      <span className="text-[8px] font-black bg-neutral-950 px-1.5 py-0.5 rounded text-neutral-400 text-right">Standard Speed</span>
                    </div>
                    <p className="text-[#8b949e] text-[9.5px] font-semibold">
                      Your reliable and free AI companion for all your tasks, building and analysis.
                    </p>
                  </button>
                </div>

                <div className="flex justify-end pt-1">
                  <button 
                    onClick={() => setShowModeModal(false)}
                    className="px-4 py-2 bg-[#0d1117] hover:bg-white/5 border border-white/5 text-[9px] font-black uppercase text-[#8b949e] hover:text-white rounded-xl transition-all cursor-pointer"
                  >
                    Cancel Action
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* SAFE DEPLOYMENT CONFIRMATION DIALOG */}
      <AnimatePresence>
        {showConfirmModal && (
          <div key="confirm-modal" className="absolute inset-0 bg-[#0d1117]/85 backdrop-blur-sm z-[999] flex flex-col justify-center p-6 select-none animate-in fade-in duration-200">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#1c2128] border border-white/10 rounded-3xl p-6 shadow-2xl relative space-y-4 max-w-sm mx-auto text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-500 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-black uppercase tracking-tight text-white leading-tight">Sovereign Safe Push</h4>
                  <p className="text-[9.5px] text-[#8b949e] font-sans uppercase tracking-widest font-black">navBharat Security Shield</p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="space-y-0.5 bg-black/40 border border-white/5 rounded-xl p-3">
                  <span className="text-[8.5px] font-extrabold text-[#8b949e] uppercase tracking-wider block">Currently Open Project</span>
                  <span className="text-xs font-bold text-white block truncate">{projectName}</span>
                </div>

                <div className="space-y-0.5 bg-black/40 border border-white/5 rounded-xl p-3">
                  <span className="text-[8.5px] font-extrabold text-[#8b949e] uppercase tracking-wider block">Target Repository Link</span>
                  <span className="text-xs font-mono font-bold text-indigo-400 block truncate">
                    https://github.com/{configs.github.repoName || 'untitled'}.git
                  </span>
                </div>

                <div className="space-y-0.5 bg-black/40 border border-[#1e293b] rounded-xl p-3">
                  <span className="text-[8.5px] font-extrabold text-[#a1a1aa] uppercase tracking-wider block">Files Ready to Transmit</span>
                  <span className="text-xs font-bold text-emerald-400 block">{Object.keys(files || {}).length} Workspace Files</span>
                </div>
              </div>

              <p className="text-[10px] text-[#8b949e] leading-relaxed pt-1 font-medium">
                Verify that this is your desired destination repository. Accidental overlap pushes are fully prevented.
              </p>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    triggerPushAndDeploy();
                  }}
                  className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:scale-[1.02] active:scale-95 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center"
                >
                  Confirm & Push 🚀
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ENTERPRISE DEPLOYMENT FAILURE POPUP MODAL (Glassmorphism & Red/Orange Glow) */}
      <AnimatePresence>
        {showErrorModal && errorDetails && (
          <div key="error-popup" className="absolute inset-0 bg-black/90 backdrop-blur-md z-[1000] flex flex-col justify-center p-5 select-none animate-in fade-in duration-300">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-black/95 border border-red-500/30 rounded-3xl p-5 shadow-[0_0_50px_rgba(239,68,68,0.25)] relative max-w-sm mx-auto text-left flex flex-col max-h-[92%] overflow-y-auto scrollbar-none space-y-3.5"
            >
              {/* Pulse Error Header */}
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 shrink-0">
                  <AlertCircle className="w-6 h-6 animate-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-[#ff8080] block">
                    {errorDetails.provider} Deployment Halt
                  </span>
                  <h4 className="text-xs font-black uppercase tracking-tight text-white leading-tight truncate">
                    {errorDetails.errorType}
                  </h4>
                </div>
              </div>

              {/* Error Reason Banner */}
              <div className="p-3 bg-red-950/20 border border-red-500/15 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-[#fda4af] uppercase tracking-wider block">Raw Return Manifest Message:</span>
                <p className="text-[10px] text-red-200/90 font-mono leading-relaxed break-words font-medium">
                  {errorDetails.rawDetails}
                </p>
              </div>

              {/* Suggestions Panel */}
              <div className="p-3 bg-zinc-950/40 border border-white/5 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-[#a1a1aa] uppercase tracking-wider block flex items-center gap-1">
                  <Settings className="w-2.5 h-2.5 text-indigo-400" />
                  Recommended DevOps Correction:
                </span>
                <p className="text-[10.5px] text-zinc-300 leading-normal font-medium">
                  {errorDetails.fixSuggestions}
                </p>
              </div>

              {/* Real-time Logs Console Accordion */}
              <div className="border border-white/5 bg-black/40 rounded-xl overflow-hidden">
                <button 
                  onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                  className="w-full flex items-center justify-between p-2.5 bg-white/5 hover:bg-white/10 transition-all font-mono text-[9px] font-bold text-white/80"
                >
                  <span className="flex items-center gap-1.5 uppercase text-[8.5px] tracking-wider text-indigo-300">
                    <Terminal className="w-3 h-3 text-indigo-400" />
                    Inspect Build Pipeline Logs ({deployLogs.length})
                  </span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isLogsExpanded ? "rotate-180 text-white" : "rotate-0")} />
                </button>
                {isLogsExpanded && (
                  <div className="p-2.5 bg-[#07090e] border-t border-white/5 max-h-[110px] overflow-y-auto font-mono text-[9px] text-red-300/80 space-y-1.5 scrollbar-thin">
                    {deployLogs.length === 0 ? (
                      <span className="text-zinc-500 italic">No console logs outputted.</span>
                    ) : (
                      deployLogs.map((log, idx) => (
                        <div key={idx} className="leading-tight break-all font-medium">
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Auto Retry countdown widget */}
              {isAutoRetryActive && retryCountdown !== null && (
                <div className="flex items-center justify-between p-2.5 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                  <span className="text-[9.5px] font-bold text-amber-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    Auto-retry in <span className="font-mono text-[11px] font-black text-amber-400">{retryCountdown}s</span>
                  </span>
                  <button
                    onClick={handleCancelAutoRetry}
                    className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/40 text-red-400 hover:text-white rounded-lg text-[8.5px] font-black uppercase tracking-wider border border-red-500/20 transition-all cursor-pointer shadow-none"
                  >
                    Pause
                  </button>
                </div>
              )}

              {/* Action grid */}
              <div className="grid grid-cols-2 gap-2 pt-1 font-bold">
                <button
                  onClick={handleRetryDeployment}
                  className="py-2.5 bg-gradient-to-r from-red-600 to-orange-600 hover:scale-[1.02] text-white rounded-xl text-[9px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                >
                  <RefreshCcw className="w-3 h-3 text-white" />
                  Retry Sync
                </button>
                <button
                  onClick={handleReconnectAccount}
                  className="py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-white rounded-xl text-[9px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                >
                  <Key className="w-3 h-3 text-indigo-400" />
                  Reconnect
                </button>
                <button
                  onClick={handleCopyLogs}
                  className="py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-[9px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3 h-3 text-zinc-400" />
                  Copy Logs
                </button>
                <button
                  onClick={() => {
                    setShowErrorModal(false);
                    // Also clear timer to be polished
                    setIsAutoRetryActive(false);
                    setRetryCountdown(null);
                  }}
                  className="py-2 bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white rounded-xl text-[9px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer copyright */}
      <div className="p-3 bg-black/35 border-t border-white/5 text-center text-[8px] font-bold text-[#8b949e] uppercase tracking-wider shrink-0 select-none">
        navBharatAI Cloud IDE Deployment &copy; 2026 Bharat Dev Team
      </div>
    </div>
  );
};
