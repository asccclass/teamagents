'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { Agent, Runtime } from '@/lib/types'
import { PROVIDER_META } from '@/lib/types'
import { Plus, X, Trash2, Wifi, WifiOff } from 'lucide-react'
import { clsx } from 'clsx'

const PROVIDERS = Object.entries(PROVIDER_META)

export default function AgentsPage() {
  const params = useParams()
  const workspace = params.workspace as string

  const [agents, setAgents] = useState<Agent[]>([])
  const [runtimes, setRuntimes] = useState<Runtime[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', provider: 'claude', runtime_id: '' })
  const [creating, setCreating] = useState(false)

  const fetchData = useCallback(() => {
    api.get<Agent[]>(`/api/w/${workspace}/agents`).then(setAgents).catch(console.error)
    api.get<Runtime[]>(`/api/w/${workspace}/runtimes`).then(setRuntimes).catch(console.error)
  }, [workspace])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post(`/api/w/${workspace}/agents`, {
        ...form,
        runtime_id: form.runtime_id || null,
      })
      setShowCreate(false)
      setForm({ name: '', provider: 'claude', runtime_id: '' })
      fetchData()
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('確定刪除此 Agent？')) return
    await api.delete(`/api/w/${workspace}/agents/${id}`)
    fetchData()
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-lg font-semibold text-white">Agents</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          <Plus size={15} />
          新增 Agent
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Runtimes 狀態 */}
        {runtimes.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              執行環境
            </h3>
            <div className="flex flex-wrap gap-2">
              {runtimes.map((rt) => (
                <div
                  key={rt.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  {rt.status === 'online'
                    ? <Wifi size={13} className="text-green-400" />
                    : <WifiOff size={13} className="text-slate-500" />}
                  <span className="text-slate-300">{rt.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    [{rt.available_clis.join(', ') || '無 CLI'}]
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agents 列表 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((agent) => {
            const meta = PROVIDER_META[agent.provider]
            const runtime = runtimes.find((r) => r.id === agent.runtime_id)
            return (
              <div
                key={agent.id}
                className="p-4 rounded-xl border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                      style={{ background: 'var(--bg-hover)' }}>
                      {meta?.emoji ?? '🤖'}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-white">{agent.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {meta?.label ?? agent.provider}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={clsx(
                      'px-2 py-0.5 rounded-full text-xs',
                      agent.status === 'idle' && 'bg-green-500/20 text-green-300',
                      agent.status === 'busy' && 'bg-yellow-500/20 text-yellow-300',
                      agent.status === 'offline' && 'bg-slate-500/20 text-slate-400',
                    )}>
                      {agent.status}
                    </span>
                    <button
                      onClick={() => handleDelete(agent.id)}
                      className="p-1 rounded transition hover:text-red-400"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {runtime && (
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    📍 {runtime.name}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {agents.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-500">尚無 Agent，建立第一個吧！</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl p-6 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">新增 Agent</h3>
              <button onClick={() => setShowCreate(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Agent 名稱（例：前端助手）"
                required
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              />
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>AI Provider</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROVIDERS.map(([id, meta]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, provider: id }))}
                      className={clsx(
                        'py-2 px-3 rounded-lg text-xs border transition text-center',
                        form.provider === id
                          ? 'border-brand-500 text-white'
                          : 'text-slate-400 hover:text-white',
                      )}
                      style={{
                        background: form.provider === id ? 'var(--bg-hover)' : 'var(--bg)',
                        borderColor: form.provider === id ? 'var(--brand)' : 'var(--border)',
                      }}
                    >
                      {meta.emoji} {meta.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>執行環境（選填）</label>
                <select
                  value={form.runtime_id}
                  onChange={(e) => setForm(f => ({ ...f, runtime_id: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <option value="">自動選擇</option>
                  {runtimes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name} ({rt.status})
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
