'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { Runtime } from '@/lib/types'
import { Copy, Check } from 'lucide-react'

export default function SettingsPage() {
  const params = useParams()
  const workspace = params.workspace as string
  const [runtimes, setRuntimes] = useState<Runtime[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get<Runtime[]>(`/api/w/${workspace}/runtimes`).then(setRuntimes).catch(console.error)
  }, [workspace])

  const token = typeof window !== 'undefined' ? localStorage.getItem('ta_token') ?? '' : ''
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'https://teamagents.justdrink.com.tw'

  const envContent = `# .env for TeamAgents Daemon
DAEMON_TOKEN=${token}
WORKSPACE_SLUG=${workspace}
API_BASE=${apiBase}
WS_URL=${apiBase.replace('http', 'ws')}/ws
AGENT_WORKDIR=/path/to/your/project`

  function copyEnv() {
    navigator.clipboard.writeText(envContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-white mb-6">設定</h2>

      {/* 執行環境 */}
      <section className="mb-8">
        <h3 className="text-sm font-medium text-slate-300 mb-3">執行環境（Runtimes）</h3>
        {runtimes.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>尚無連線的 Daemon</p>
        ) : (
          <div className="space-y-2">
            {runtimes.map((rt) => (
              <div key={rt.id} className="p-3 rounded-xl border flex items-center justify-between"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-medium text-white">{rt.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {rt.hostname} · {rt.available_clis.join(', ') || '無 CLI'}
                  </p>
                </div>
                <span className={rt.status === 'online'
                  ? 'text-xs text-green-400'
                  : 'text-xs text-slate-500'
                }>
                  ● {rt.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Daemon 安裝說明 */}
      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-3">安裝 Daemon（在你的開發機器上）</h3>
        <div className="rounded-xl border p-4 space-y-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>1. 下載並解壓 daemon binary</p>
            <CodeBlock code={`# 從 release 頁面下載\ncurl -L https://teamagents.justdrink.com.tw/releases/daemon-linux-amd64.tar.gz | tar xz\nsudo mv daemon /usr/local/bin/teamagents-daemon`} />
          </div>
          <div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>2. 建立 .env 設定檔</p>
            <div className="relative">
              <CodeBlock code={envContent} />
              <button
                onClick={copyEnv}
                className="absolute top-2 right-2 p-1.5 rounded-lg transition hover:text-white"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)' }}
              >
                {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>3. 啟動 Daemon</p>
            <CodeBlock code={`teamagents-daemon`} />
          </div>
        </div>
      </section>
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto text-slate-300"
      style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
      {code}
    </pre>
  )
}
