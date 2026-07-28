import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TeamAgents',
  description: 'AI Agents as Teammates',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="dark">
      <body>{children}</body>
    </html>
  )
}
