'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { Autopilot, Agent } from '@/lib/types'
import { PROVIDER_META } from '@/lib/types'
import { Plus, X, Play, Pause, Trash2, Zap, Clock, Webhook } from 'lucide-react'
import { clsx } from 'clsx'

const CRON_PRESETS = [
  { label: '每小時', value: '@hourly' },
  { label: '每天', value: '@daily' },
  { label: '每週', value: '@weekly' },
  { label: '每 30 分鐘', value: '@every 30m' },
  { label: '每 6 小時', value: '@every 6h' },
  { label: '自訂', value: 'custom' },
]

export default function AutopilotsPage() {
  const params = useParams()
  const workspace = params.workspace as string

  const [autopilots, setAutopilots] = useState<Autopilot[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [triggeringId, setTriggeringId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    agent_id: '',
    cron_preset: '@daily',
    cron_custom: '',
    issue_title: '',
    issue_body: '',
    issue_priority: 'medium',
  })
  const [creating, setCreating] = useState(false)

  const fetchData = useCallback(() => {
    api.get<Autopilot[]>(`/api/w/${workspace}/autopilots`).then(setAutopilots).catch(console.error)
    api.get<Agent[]>(`/api/w/${workspace}/agents`).then(setAgents).catch(console.error)
  }, [workspace])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    const cronExpr = form.cron_preset === 'custom' ? form.cron_custom : form.cron_preset
    try {
      await api.post(`/api/w/${workspace}/autopilots`, {
        name: form.name,
        agent_id: form.agent_id,
        cron_expr: cronExpr || null,
        issue_template: {
          title: form.issue_title,
          body: form.issue_body,
          priority: form.issue_priority,
        },
      })
      setShowCreate(false)
      setForm({ name: '', agent_id: '', cron_preset: '@daily', cron_custom: '', issue_title: '', issue_body: '', issue_priority: 'medium' })
      fetchData()
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(ap: Autopilot) {
    await api.patch(`/api/w/${workspace}/autopilots/${ap.id}`, { enabled: !ap.enabled })
    fetchData()
  }

  async function handleTrigger(id: string) {
    setTriggeringId(id)
    try {
      await api.post(`/api/w/${workspace}/autopilots/${id}/trigger`)
    } finally {
      setTimeout(() => setTriggeringId(null), 1500)
      fetchData()
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('確定刪除此 Autopilot？')) return
    await api.delete(`/api/w/${workspace}/autopilots/${id}`)
    fetchData()
  }

  // Webhook URL
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? ''
  const token = typeof window !== 'undefined' ? localStorage.getItem('ta_token') ?? '' : ''

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-white">Autopilots</h2>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {autopilots.filter(a => a.enabled).length} 啟用
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          <Plus size={15} />
          新增 Autopilot
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-3">
        {autopilots.length === 0 && (
          <div className="text-center py-16">
            <Clock size={40} className="mx-auto mb-3 text-slate-600" />
            <p className="text-slate-500 text-sm">尚無 Autopilot，建立定期執行的排程吧！</p>
          </div>
        )}

        {autopilots.map((ap) => {
          const agent = agents.find(a => a.id === ap.agent_id)
          const meta = agent ? PROVIDER_META[agent.provider] : null
          const webhookURL = `${apiBase}/api/w/${workspace}/autopilots/${ap.id}/trigger`

          return (
            <div
              key={ap.id}
              className="rounded-xl border p-4"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={clsx(
                    'w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0',
                    ap.enabled ? 'bg-green-500/20' : 'bg-slate-500/10',
                  )}>
                    {ap.cron_expr ? '⏰' : <Webhook size={18} className="text-slate-400" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-white">{ap.name}</p>
                      <span className={clsx(
                        'text-xs px-1.5 py-0.5 rounded-full',
                        ap.enabled ? 'bg-green-500/20 text-green-300' : 'bg-slate-500/20 text-slate-400',
                      )}>
                        {ap.enabled ? '啟用' : '停用'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {ap.cron_expr && (
                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {ap.cron_expr}
                        </span>
                      )}
                      {agent && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {meta?.emoji} {agent.name}
                        </span>
                      )}
                      {ap.last_run_at && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          上次執行: {new Date(ap.last_run_at).toLocaleString('zh-TW')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 操作按鈕 */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleTrigger(ap.id)}
                    disabled={triggeringId === ap.id}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition',
                      triggeringId === ap.id
                        ? 'text-green-300 bg-green-500/10'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700',
                    )}
                  >
                    <Zap size={12} />
                    {triggeringId === ap.id ? '觸發中' : '觸發'}
                  </button>
                  <button
                    onClick={() => handleToggle(ap)}
                    className="p-1.5 rounded-lg transition hover:text-white"
                    style={{ color: 'var(--text-muted)' }}
                    title={ap.enabled ? '停用' : '啟用'}
                  >
                    {ap.enabled ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(ap.id)}
                    className="p-1.5 rounded-lg transition hover:text-red-400"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Webhook URL */}
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <Webhook size={11} />
                  Webhook URL（POST）
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono px-2.5 py-1.5 rounded-lg truncate text-slate-400"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    {webhookURL}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(webhookURL)}
                    className="text-xs px-2 py-1.5 rounded-lg transition hover:text-white flex-shrink-0"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)' }}
                  >
                    複製
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg rounded-2xl border flex flex-col max-h-[90vh]"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-base font-semibold text-white">新增 Autopilot</h3>
              <button onClick={() => setShowCreate(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-4 flex-1 overflow-auto">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>名稱 *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="每日程式碼審查"
                    required
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>指派 Agent *</label>
                  <select
                    value={form.agent_id}
                    onChange={(e) => setForm(f => ({ ...f, agent_id: e.target.value }))}
                    required
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <option value="">選擇 Agent</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>
                        {PROVIDER_META[a.provider]?.emoji} {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>執行頻率</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {CRON_PRESETS.map(p => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, cron_preset: p.value }))}
                        className={clsx(
                          'py-2 px-3 rounded-lg text-xs border transition text-center',
                          form.cron_preset === p.value ? 'text-white' : 'text-slate-400 hover:text-white',
                        )}
                        style={{
                          background: form.cron_preset === p.value ? 'var(--bg-hover)' : 'var(--bg)',
                          borderColor: form.cron_preset === p.value ? 'var(--brand)' : 'var(--border)',
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {form.cron_preset === 'custom' && (
                    <input
                      value={form.cron_custom}
                      onChange={(e) => setForm(f => ({ ...f, cron_custom: e.target.value }))}
                      placeholder="@every 2h"
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500 font-mono"
                      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    />
                  )}
                </div>

                <div className="pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>自動建立的 Issue 範本</p>
                  <input
                    value={form.issue_title}
                    onChange={(e) => setForm(f => ({ ...f, issue_title: e.target.value }))}
                    placeholder="Issue 標題（留空則自動生成）"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500 mb-2"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                  <textarea
                    value={form.issue_body}
                    onChange={(e) => setForm(f => ({ ...f, issue_body: e.target.value }))}
                    placeholder="Issue 描述（Agent 執行的任務說明）"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500 resize-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>
              </div>
              <div className="flex gap-3 p-5 border-t" style={{ borderColor: 'var(--border)' }}>
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
