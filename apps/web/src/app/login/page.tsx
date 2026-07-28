'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, saveToken } from '@/lib/api'

type Step = 'email' | 'otp'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSendOTP(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/api/auth/send-otp', { email })
      setStep('otp')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '發送失敗')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOTP(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ token: string }>('/api/auth/verify-otp', { email, code: otp })
      saveToken(res.token)
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '驗證失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500 mb-4">
            <span className="text-2xl">🤖</span>
          </div>
          <h1 className="text-2xl font-bold text-white">TeamAgents</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            AI Agents as Teammates
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          {step === 'email' ? (
            <form onSubmit={handleSendOTP} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-300">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none transition focus:border-brand-500"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                />
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2.5 rounded-lg font-medium text-sm text-white transition disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                {loading ? '發送中...' : '發送驗證碼'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  驗證碼已發送至
                </p>
                <p className="font-medium text-white">{email}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-300">
                  驗證碼
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white border outline-none transition focus:border-brand-500 text-center tracking-widest text-lg font-mono"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                />
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full py-2.5 rounded-lg font-medium text-sm text-white transition disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                {loading ? '驗證中...' : '登入'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('email'); setOtp(''); setError('') }}
                className="w-full py-2 text-sm transition"
                style={{ color: 'var(--text-muted)' }}
              >
                重新發送
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
