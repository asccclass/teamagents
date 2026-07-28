'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isLoggedIn } from '@/lib/api'

export default function RootPage() {
  const router = useRouter()
  useEffect(() => {
    router.push(isLoggedIn() ? '/dashboard' : '/login')
  }, [router])
  return null
}
