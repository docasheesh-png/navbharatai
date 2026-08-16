import React, { useState, useEffect } from 'react';
import { Kanban, CalendarDays, Milestone, Target, Flag, Trophy, Plus, Trash2, Edit2, Check, X, Sparkles, ChevronRight, Clock, User, AlertCircle, CheckCircle2, BarChart2, Loader2 } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Status = 'todo' | 'inprogress' | 'review' | 'done';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: Status;
  milestone: string;
  assignee: string;
  dueDate: string;
  tags: string[];
  createdAt: number;
}

interface MilestoneItem {
  id: string;
  title: string;
  dueDate: string;
  progress: number;
  color: string;
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'text-slate-400 bg-slate-800',
  medium: 'text-amber-400 bg-amber-900/30',
  high: 'text-orange-400 bg-orange-900/30',
  critical: 'text-red-400 bg-red-900/30',
};

const STATUS_LABELS: Record<Status, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

const STATUS_COLORS: Record<Status, string> = {
  todo: 'border-slate-600',
  inprogress: 'border-blue-500',
  review: 'border-amber-500',
  done: 'border-green-500',
};

const DEFAULT_MILESTONES: MilestoneItem[] = [
  { id: 'm1', title: 'MVP Launch', dueDate: '2025-07-01', progress: 65, color: '#6366f1' },
  { id: 'm2', title: 'Beta Release', dueDate: '2025-08-15', progress: 30, color: '#f59e0b' },
  { id: 'm3', title: 'Production v1.0', dueDate: '2025-09-30', progress: 10, color: '#10b981' },
];

const AI_PROMPT_SUGGESTIONS = [
  'E-commerce app with payment integration',
  'Social media dashboard with analytics',
  'Healthcare appointment booking system',
  'EdTech platform with video courses',
  'Food delivery app with real-time tracking',
];

export function AIProjectManager() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_pm_tasks') || '[]'); } catch { return []; }
  });
  const [milestones, setMilestones] = useState<MilestoneItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_pm_milestones') || JSON.stringify(DEFAULT_MILESTONES)); } catch { return DEFAULT_MILESTONES; }
  });
  const [activeView, setActiveView] = useState<'kanban' | 'list' | 'milestones' | 'ai'>('kanban');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [newTask, setNewTask] = useState<Partial<Task>>({ priority: 'medium', status: 'todo', milestone: 'm1', tags: [] });
  const [projectName, setProjectName] = useState(() => localStorage.getItem('navbharat_pm_name') || 'My NavBharat Project');

  useEffect(() => {
    localStorage.setItem('navbharat_pm_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('navbharat_pm_milestones', JSON.stringify(milestones));
  }, [milestones]);

  useEffect(() => {
    localStorage.setItem('navbharat_pm_name', projectName);
  }, [projectName]);

  const addTask = () => {
    if (!newTask.title?.trim()) return;
    const task: Task = {
      id: Date.now().toString(),
      title: newTask.title!,
      description: newTask.description || '',
      priority: newTask.priority as Priority || 'medium',
      status: newTask.status as Status || 'todo',
      milestone: newTask.milestone || 'm1',
      assignee: newTask.assignee || 'You',
      dueDate: newTask.dueDate || '',
      tags: newTask.tags || [],
      createdAt: Date.now(),
    };
    setTasks(prev => [task, ...prev]);
    setNewTask({ priority: 'medium', status: 'todo', milestone: 'm1', tags: [] });
    setShowNewTask(false);
  };

  const moveTask = (taskId: string, newStatus: Status) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
  };

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const generateAIPlan = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    await new Promise(r => setTimeout(r, 1500));

    const plans: Record<string, { title: string; description: string; priority: Priority; status: Status }[]> = {
      default: [
        { title: 'Project Setup & Architecture', description: 'Initialize repo, configure CI/CD, define tech stack', priority: 'high', status: 'todo' },
        { title: 'UI/UX Design System', description: 'Create design tokens, component library, wireframes', priority: 'high', status: 'todo' },
        { title: 'Core Authentication', description: 'Firebase Auth, user profiles, role-based access', priority: 'high', status: 'todo' },
        { title: 'Database Schema Design', description: 'Firestore collections, indexes, security rules', priority: 'medium', status: 'todo' },
        { title: 'API Integration Layer', description: 'REST/GraphQL APIs, error handling, rate limiting', priority: 'medium', status: 'todo' },
        { title: 'Core Feature Development', description: `Main features for: ${aiPrompt}`, priority: 'high', status: 'todo' },
        { title: 'Payment Integration', description: 'Razorpay/Stripe checkout, webhooks, receipts', priority: 'medium', status: 'todo' },
        { title: 'Testing & QA', description: 'Unit tests, integration tests, E2E testing', priority: 'medium', status: 'todo' },
        { title: 'Performance Optimization', description: 'Lazy loading, caching, CDN setup', priority: 'low', status: 'todo' },
        { title: 'Production Deployment', description: 'Google Cloud Run, domain, SSL, monitoring', priority: 'high', status: 'todo' },
      ],
    };

    const generated = plans.default.map((p, i) => ({
      id: `ai_${Date.now()}_${i}`,
      ...p,
      milestone: i < 3 ? 'm1' : i < 7 ? 'm2' : 'm3',
      assignee: 'You',
      dueDate: '',
      tags: ['AI Generated'],
      createdAt: Date.now(),
    }));

    setTasks(prev => [...generated, ...prev]);
    setProjectName(aiPrompt.slice(0, 50));
    setAiLoading(false);
    setAiPrompt('');
    setActiveView('kanban');
  };

  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.status === 'done').length,
    inprogress: tasks.filter(t => t.status === 'inprogress').length,
    critical: tasks.filter(t => t.priority === 'critical').length,
  };

  const kanbanColumns: Status[] = ['todo', 'inprogress', 'review', 'done'];

  const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: 'var(--text-body)', fontFamily: 'sans-serif' };
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px' };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Kanban size={20} color="#6366f1" />
          <div>
            <input
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-body)', fontSize: 15, fontWeight: 600, width: 280 }}
            />
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{stats.total} tasks · {stats.done} done · {stats.inprogress} in progress</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['kanban', 'list', 'milestones', 'ai'] as const).map(v => (
            <button key={v} onClick={() => setActiveView(v)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: activeView === v ? '#6366f1' : '#334155', color: activeView === v ? '#fff' : 'var(--text-muted)' }}>
              {v === 'ai' ? '✨ AI Plan' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
          <button onClick={() => setShowNewTask(true)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} /> Task
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'flex', gap: 1, background: '#0f172a', flexShrink: 0 }}>
        {[
          { label: 'Total', value: stats.total, color: '#6366f1', icon: Target },
          { label: 'Done', value: stats.done, color: '#10b981', icon: CheckCircle2 },
          { label: 'In Progress', value: stats.inprogress, color: '#3b82f6', icon: Clock },
          { label: 'Critical', value: stats.critical, color: '#ef4444', icon: AlertCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{ flex: 1, background: '#1e293b', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={16} color={color} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* AI Plan Generator */}
        {activeView === 'ai' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <div style={{ ...cardStyle, maxWidth: 600, margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Sparkles size={18} color="#f59e0b" />
                <span style={{ fontWeight: 600, fontSize: 14 }}>AI Project Planner</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
                Describe your app idea and AI will generate a complete project plan with tasks, priorities, and milestones.
              </p>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="e.g. E-commerce app with AI product recommendations, Razorpay payments, and WhatsApp notifications..."
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: 'var(--text-body)', padding: '10px', fontSize: 13, resize: 'vertical', minHeight: 80, boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Quick suggestions:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {AI_PROMPT_SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => setAiPrompt(s)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={generateAIPlan} disabled={aiLoading || !aiPrompt.trim()} style={{ width: '100%', padding: '10px', borderRadius: 6, border: 'none', cursor: aiLoading ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {aiLoading ? <><TirangaLoader size={14} /> Generating Plan...</> : <><Sparkles size={14} /> Generate Project Plan</>}
              </button>
            </div>
          </div>
        )}

        {/* Kanban Board */}
        {activeView === 'kanban' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', gap: 12 }}>
            {kanbanColumns.map(col => {
              const colTasks = tasks.filter(t => t.status === col);
              return (
                <div key={col} style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: col === 'done' ? '#10b981' : col === 'inprogress' ? '#3b82f6' : col === 'review' ? '#f59e0b' : 'var(--text-muted)' }} />
                      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)' }}>{STATUS_LABELS[col]}</span>
                    </div>
                    <span style={{ background: '#334155', color: 'var(--text-muted)', fontSize: 10, borderRadius: 10, padding: '1px 6px' }}>{colTasks.length}</span>
                  </div>
                  {colTasks.map(task => (
                    <div key={task.id} style={{ background: '#1e293b', border: `1px solid #334155`, borderLeft: `3px solid ${col === 'done' ? '#10b981' : col === 'inprogress' ? '#3b82f6' : col === 'review' ? '#f59e0b' : 'var(--text-faint)'}`, borderRadius: 8, padding: '10px 12px', cursor: 'grab' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-body)', flex: 1 }}>{task.title}</div>
                        <button onClick={() => deleteTask(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '0 0 0 4px' }}>
                          <Trash2 size={10} />
                        </button>
                      </div>
                      {task.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{task.description}</div>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, ...Object.fromEntries(Object.entries(PRIORITY_COLORS[task.priority]).map(([k, v]) => [k === 'text' ? 'color' : 'backgroundColor', v])) }}>
                          {task.priority}
                        </span>
                        {task.tags.map(tag => (
                          <span key={tag} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#1e3a5f', color: '#60a5fa' }}>{tag}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {kanbanColumns.filter(s => s !== col).map(s => (
                          <button key={s} onClick={() => moveTask(task.id, s)} style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, border: '1px solid #334155', background: '#0f172a', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            → {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => { setNewTask(p => ({ ...p, status: col })); setShowNewTask(true); }} style={{ padding: '8px', borderRadius: 6, border: '1px dashed #334155', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <Plus size={12} /> Add
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* List View */}
        {activeView === 'list' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: 'var(--text-muted)' }}>
                  {['Task', 'Priority', 'Status', 'Assignee', 'Due Date', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--text-body)' }}>{task.title}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: task.priority === 'critical' ? '#7f1d1d' : task.priority === 'high' ? '#431407' : task.priority === 'medium' ? '#451a03' : '#1e293b', color: task.priority === 'critical' ? '#fca5a5' : task.priority === 'high' ? '#fb923c' : task.priority === 'medium' ? '#fbbf24' : 'var(--text-muted)' }}>{task.priority}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: task.status === 'done' ? '#052e16' : task.status === 'inprogress' ? '#172554' : '#1e293b', color: task.status === 'done' ? '#4ade80' : task.status === 'inprogress' ? '#60a5fa' : 'var(--text-muted)' }}>{STATUS_LABELS[task.status]}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{task.assignee}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{task.dueDate || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => deleteTask(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tasks.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-faint)' }}>
                <Kanban size={32} style={{ margin: '0 auto 12px' }} />
                <div>No tasks yet. Use AI Plan or add manually.</div>
              </div>
            )}
          </div>
        )}

        {/* Milestones View */}
        {activeView === 'milestones' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {milestones.map(ms => {
              const msTasks = tasks.filter(t => t.milestone === ms.id);
              const doneTasks = msTasks.filter(t => t.status === 'done').length;
              const progress = msTasks.length > 0 ? Math.round((doneTasks / msTasks.length) * 100) : ms.progress;
              return (
                <div key={ms.id} style={{ ...cardStyle }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Milestone size={16} color={ms.color} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ms.title}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CalendarDays size={12} color="#64748b" />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ms.dueDate}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: ms.color }}>{progress}%</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progress}%`, background: ms.color, borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>{doneTasks}/{msTasks.length} tasks complete</div>
                </div>
              );
            })}
            <div style={{ ...cardStyle, border: '1px dashed #334155', background: 'transparent', textAlign: 'center', padding: '16px', cursor: 'pointer', color: 'var(--text-faint)' }}>
              <Trophy size={16} style={{ margin: '0 auto 4px' }} />
              <div style={{ fontSize: 12 }}>All milestones on track!</div>
            </div>
          </div>
        )}
      </div>

      {/* New Task Modal */}
      {showNewTask && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, width: 400, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>New Task</span>
              <button onClick={() => setShowNewTask(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>
            {[
              { label: 'Title *', key: 'title', type: 'text', placeholder: 'Task title...' },
              { label: 'Description', key: 'description', type: 'text', placeholder: 'Optional description...' },
              { label: 'Assignee', key: 'assignee', type: 'text', placeholder: 'You' },
              { label: 'Due Date', key: 'dueDate', type: 'date', placeholder: '' },
            ].map(field => (
              <div key={field.key}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{field.label}</div>
                <input
                  type={field.type}
                  value={(newTask as any)[field.key] || ''}
                  onChange={e => setNewTask(p => ({ ...p, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: 'var(--text-body)', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Priority</div>
                <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value as Priority }))} style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: 'var(--text-body)', padding: '8px 10px', fontSize: 13, outline: 'none' }}>
                  {(['low', 'medium', 'high', 'critical'] as Priority[]).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Status</div>
                <select value={newTask.status} onChange={e => setNewTask(p => ({ ...p, status: e.target.value as Status }))} style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: 'var(--text-body)', padding: '8px 10px', fontSize: 13, outline: 'none' }}>
                  {(Object.entries(STATUS_LABELS) as [Status, string][]).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setShowNewTask(false)} style={{ flex: 1, padding: '9px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={addTask} style={{ flex: 1, padding: '9px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Add Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
