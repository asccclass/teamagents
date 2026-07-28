'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, isLoggedIn } from '@/lib/api'
import type { Workspace } from '@/lib/types'
import { Plus, LayoutDashboard } from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push('/login')
      return
    }
    api.get<Workspace[]>('/api/workspaces').then((data) => {
      setWorkspaces(data)
      setLoading(false)
    }).catch(() => {
      router.push('/login')
    })
  }, [router])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const ws = await api.post<Workspace>('/api/workspaces', form)
      router.push(`/dashboard/${ws.slug}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '建立失敗')
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-slate-400">載入中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">工作區</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              選擇或建立一個工作區
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition"
            style={{ background: 'var(--brand)' }}
          >
            <Plus size={16} />
            新增工作區
          </button>
        </div>

        {/* 工作區列表 */}
        <div className="space-y-2">
          {workspaces.length === 0 ? (
            <div className="text-center py-16 border rounded-2xl" style={{ borderColor: 'var(--border)' }}>
              <LayoutDashboard size={40} className="mx-auto mb-3 text-slate-600" />
              <p className="text-slate-400">尚無工作區，建立第一個吧！</p>
            </div>
          ) : (
            workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => router.push(`/dashboard/${ws.slug}`)}
                className="w-full text-left px-5 py-4 rounded-xl border transition hover:border-brand-500/50"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-500/20 flex items-center justify-center text-brand-500 font-bold text-sm">
                    {ws.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-white">{ws.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      /{ws.slug}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* 建立工作區 Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-md rounded-2xl p-6 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold text-white mb-4">建立工作區</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-slate-300">名稱</label>
                  <input
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value
                      setForm({ name, slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })
                    }}
                    placeholder="我的團隊"
                    required
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-slate-300">Slug（URL 識別碼）</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="my-team"
                    required
                    pattern="[a-z0-9-]{3,50}"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500 font-mono"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="flex-1 py-2.5 rounded-lg text-sm border transition"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition disabled:opacity-50"
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
    </div>
  )
}
