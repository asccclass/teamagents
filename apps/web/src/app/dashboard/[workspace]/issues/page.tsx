'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { useWebSocket } from '@/lib/useWebSocket'
import type { Issue, Agent, WSMessage } from '@/lib/types'
import { STATUS_COLOR, PRIORITY_COLOR, PROVIDER_META } from '@/lib/types'
import { Plus, X } from 'lucide-react'
import { clsx } from 'clsx'

const STATUS_COLS = ['open', 'in_progress', 'done'] as const
const STATUS_LABEL: Record<string, string> = {
  open: '待處理',
  in_progress: '進行中',
  done: '已完成',
}

export default function IssuesPage() {
  const params = useParams()
  const workspace = params.workspace as string

  const [issues, setIssues] = useState<Issue[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    title: '', body: '', priority: 'medium', assignee_agent_id: '',
  })
  const [creating, setCreating] = useState(false)

  const fetchIssues = useCallback(() => {
    api.get<Issue[]>(`/api/w/${workspace}/issues`).then(setIssues).catch(console.error)
  }, [workspace])

  useEffect(() => {
    fetchIssues()
    api.get<Agent[]>(`/api/w/${workspace}/agents`).then(setAgents).catch(console.error)
  }, [workspace, fetchIssues])

  // WebSocket 即時更新
  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'issue:updated') fetchIssues()
  }, [fetchIssues])
  useWebSocket(workspace, handleWS)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post(`/api/w/${workspace}/issues`, {
        ...form,
        assignee_agent_id: form.assignee_agent_id || null,
      })
      setShowCreate(false)
      setForm({ title: '', body: '', priority: 'medium', assignee_agent_id: '' })
      fetchIssues()
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  const byStatus = (status: string) => issues.filter((i) => i.status === status)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-lg font-semibold text-white">Issues</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          <Plus size={15} />
          新增 Issue
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 flex gap-4 p-6 overflow-x-auto">
        {STATUS_COLS.map((status) => (
          <div key={status} className="flex-shrink-0 w-72">
            <div className="flex items-center gap-2 mb-3">
              <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLOR[status])}>
                {STATUS_LABEL[status]}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {byStatus(status).length}
              </span>
            </div>

            <div className="space-y-2">
              {byStatus(status).map((issue) => {
                const agent = agents.find((a) => a.id === issue.assignee_agent_id)
                return (
                  <IssueCard key={issue.id} issue={issue} agent={agent} />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg rounded-2xl p-6 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">新增 Issue</h3>
              <button onClick={() => setShowCreate(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Issue 標題"
                required
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              />
              <textarea
                value={form.body}
                onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder="描述（選填）"
                rows={4}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500 resize-none"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              />
              <div className="flex gap-3">
                <select
                  value={form.priority}
                  onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white border outline-none"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <option value="low">低優先</option>
                  <option value="medium">中優先</option>
                  <option value="high">高優先</option>
                  <option value="urgent">緊急</option>
                </select>
                <select
                  value={form.assignee_agent_id}
                  onChange={(e) => setForm(f => ({ ...f, assignee_agent_id: e.target.value }))}
                  className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white border outline-none"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <option value="">不指派 Agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {PROVIDER_META[a.provider]?.emoji} {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm border"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--brand)' }}
                >
                  {creating ? '建立中...' : '建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function IssueCard({ issue, agent }: { issue: Issue; agent?: Agent }) {
  return (
    <div
      className="p-3.5 rounded-xl border transition cursor-pointer hover:border-slate-500"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <p className="text-sm font-medium text-white leading-snug mb-2">{issue.title}</p>
      <div className="flex items-center justify-between">
        <span className={clsx('text-xs', PRIORITY_COLOR[issue.priority])}>
          #{issue.number} · {issue.priority}
        </span>
        {agent && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {PROVIDER_META[agent.provider]?.emoji} {agent.name}
          </span>
        )}
      </div>
    </div>
  )
}
