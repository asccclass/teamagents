export interface User {
  user_id: string
  email: string
}

export interface Workspace {
  id: string
  slug: string
  name: string
  owner_id: string
  created_at: string
}

export interface Agent {
  id: string
  workspace_id: string
  runtime_id: string | null
  name: string
  provider: string
  avatar_url: string | null
  system_prompt: string | null
  status: 'idle' | 'busy' | 'offline'
  created_at: string
}

export interface Issue {
  id: string
  number: number
  title: string
  body: string
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignee_agent_id: string | null
  assignee_user_id: string | null
  labels: string[]
  created_at: string
  updated_at: string
  closed_at: string | null
}

export interface Task {
  id: string
  issue_id: string
  agent_id: string
  runtime_id: string | null
  provider: string
  title: string
  body: string
  status: 'queued' | 'claimed' | 'running' | 'done' | 'failed' | 'cancelled'
  exit_code: number | null
  stdout_log: string | null
  error_msg: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface Skill {
  id: string
  workspace_id: string
  name: string
  description: string
  content: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Autopilot {
  id: string
  workspace_id: string
  name: string
  agent_id: string
  cron_expr: string | null
  issue_template: Record<string, unknown>
  enabled: boolean
  last_run_at: string | null
  created_at: string
}

export interface Runtime {
  id: string
  name: string
  hostname: string
  status: 'online' | 'offline'
  available_clis: string[]
  last_ping_at: string | null
  created_at: string
}

// Provider 顏色與圖示
export const PROVIDER_META: Record<string, { label: string; color: string; emoji: string }> = {
  claude:         { label: 'Claude',        color: '#c97a3a', emoji: '🟠' },
  codex:          { label: 'Codex',         color: '#10b981', emoji: '🟢' },
  'cursor-agent': { label: 'Cursor Agent',  color: '#8b5cf6', emoji: '🟣' },
  copilot:        { label: 'Copilot',       color: '#4f6ef7', emoji: '🔵' },
  opencode:       { label: 'OpenCode',      color: '#f59e0b', emoji: '🟡' },
  gemini:         { label: 'Gemini',        color: '#06b6d4', emoji: '🔵' },
  kimi:           { label: 'Kimi',          color: '#ec4899', emoji: '🩷' },
}

export const STATUS_COLOR: Record<string, string> = {
  open:        'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-yellow-500/20 text-yellow-300',
  done:        'bg-green-500/20 text-green-300',
  cancelled:   'bg-gray-500/20 text-gray-400',
  queued:      'bg-slate-500/20 text-slate-300',
  claimed:     'bg-purple-500/20 text-purple-300',
  running:     'bg-yellow-500/20 text-yellow-300',
  failed:      'bg-red-500/20 text-red-300',
}

export const PRIORITY_COLOR: Record<string, string> = {
  low:    'text-slate-400',
  medium: 'text-blue-400',
  high:   'text-orange-400',
  urgent: 'text-red-400',
}
