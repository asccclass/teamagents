'use client'

import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import { LayoutList, Bot, BookOpen, Clock, Settings, LogOut, ChevronLeft } from 'lucide-react'
import { clearToken } from '@/lib/api'

const navItems = [
  { href: 'issues',     label: 'Issues',     icon: LayoutList },
  { href: 'agents',     label: 'Agents',     icon: Bot },
  { href: 'skills',     label: 'Skills',     icon: BookOpen },
  { href: 'autopilots', label: 'Autopilots', icon: Clock },
  { href: 'settings',   label: '設定',       icon: Settings },
]

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const workspace = params.workspace as string

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        {/* Workspace Header */}
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1.5 text-xs mb-3 transition hover:text-white"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft size={14} />
            所有工作區
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/20 flex items-center justify-center text-brand-500 font-bold text-sm">
              {workspace[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm text-white truncate">{workspace}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>工作區</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const fullPath = `/dashboard/${workspace}/${href}`
            const active = pathname.startsWith(fullPath)
            return (
              <Link
                key={href}
                href={fullPath}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
                  active
                    ? 'text-white font-medium'
                    : 'hover:text-white',
                )}
                style={active
                  ? { background: 'var(--bg-hover)', color: 'var(--text)' }
                  : { color: 'var(--text-muted)' }
                }
              >
                <Icon size={16} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full transition hover:text-red-400"
            style={{ color: 'var(--text-muted)' }}
          >
            <LogOut size={16} />
            登出
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
