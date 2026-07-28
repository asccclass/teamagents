'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { Skill } from '@/lib/types'
import { Plus, X, Search, BookOpen, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

export default function SkillsPage() {
  const params = useParams()
  const workspace = params.workspace as string

  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', content: '' })
  const [saving, setSaving] = useState(false)

  const fetchSkills = useCallback(() => {
    api.get<Skill[]>(`/api/w/${workspace}/skills`).then(setSkills).catch(console.error)
  }, [workspace])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  // 即時搜尋（300ms debounce）
  useEffect(() => {
    if (!search.trim()) { fetchSkills(); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.get<Skill[]>(`/api/w/${workspace}/skills/search?q=${encodeURIComponent(search)}`)
        setSkills(res)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, workspace, fetchSkills])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/api/w/${workspace}/skills/${editing.id}`, form)
        setEditing(null)
      } else {
        await api.post(`/api/w/${workspace}/skills`, form)
        setShowCreate(false)
      }
      setForm({ name: '', description: '', content: '' })
      fetchSkills()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  function openEdit(skill: Skill) {
    setEditing(skill)
    setForm({ name: skill.name, description: skill.description, content: skill.content })
    setShowCreate(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('確定刪除此 Skill？')) return
    await api.delete(`/api/w/${workspace}/skills/${id}`)
    fetchSkills()
  }

  const isModalOpen = showCreate || !!editing

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-white">Skills</h2>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {skills.length}
          </span>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditing(null); setForm({ name: '', description: '', content: '' }) }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          <Plus size={15} />
          新增 Skill
        </button>
      </div>

      {/* 搜尋列 */}
      <div className="px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋技能名稱、描述或內容..."
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>
              搜尋中...
            </span>
          )}
        </div>
      </div>

      {/* Skills 列表 */}
      <div className="flex-1 overflow-auto p-6 space-y-2">
        {skills.length === 0 && (
          <div className="text-center py-16">
            <BookOpen size={40} className="mx-auto mb-3 text-slate-600" />
            <p className="text-slate-500 text-sm">
              {search ? '找不到相符的技能' : '尚無技能，建立第一個可重用技能吧！'}
            </p>
          </div>
        )}

        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            {/* 技能標題列 */}
            <div className="flex items-center justify-between px-4 py-3">
              <button
                className="flex-1 flex items-center gap-3 text-left"
                onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-300 text-sm font-bold flex-shrink-0">
                  S
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm text-white">{skill.name}</p>
                  {skill.description && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {skill.description}
                    </p>
                  )}
                </div>
                {expanded === skill.id
                  ? <ChevronUp size={14} className="text-slate-500 flex-shrink-0 ml-2" />
                  : <ChevronDown size={14} className="text-slate-500 flex-shrink-0 ml-2" />
                }
              </button>
              <div className="flex items-center gap-1 ml-3">
                <button
                  onClick={() => openEdit(skill)}
                  className="p-1.5 rounded-lg transition hover:text-white"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => handleDelete(skill.id)}
                  className="p-1.5 rounded-lg transition hover:text-red-400"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 展開：技能內容 */}
            {expanded === skill.id && (
              <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
                <pre
                  className="mt-3 text-xs font-mono p-3 rounded-lg overflow-x-auto text-slate-300 leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                >
                  {skill.content}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border flex flex-col max-h-[90vh]"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-base font-semibold text-white">
                {editing ? '編輯 Skill' : '新增 Skill'}
              </h3>
              <button onClick={() => { setShowCreate(false); setEditing(null) }} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-3 flex-1 overflow-auto">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>技能名稱 *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="例：Go 錯誤處理最佳實踐"
                    required
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>描述（選填）</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="簡短說明此技能的用途"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none focus:border-brand-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    技能內容 * <span className="font-normal">（Markdown 或純文字，Agent 執行時會注入此內容）</span>
                  </label>
                  <textarea
                    value={form.content}
                    onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
                    placeholder={`# 技能說明\n\n## 適用情境\n...\n\n## 執行步驟\n1. ...\n2. ...`}
                    required
                    rows={12}
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-slate-300 border outline-none focus:border-brand-500 resize-none font-mono"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  />
                </div>
              </div>
              <div className="flex gap-3 p-5 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setEditing(null) }}
                  className="flex-1 py-2.5 rounded-lg text-sm border transition"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition disabled:opacity-50"
                  style={{ background: 'var(--brand)' }}
                >
                  {saving ? '儲存中...' : (editing ? '更新' : '建立')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
