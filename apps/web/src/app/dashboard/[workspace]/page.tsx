'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function WorkspaceIndex() {
  const router = useRouter()
  const params = useParams()
  const workspace = params.workspace as string
  useEffect(() => {
    router.replace(`/dashboard/${workspace}/issues`)
  }, [router, workspace])
  return null
}
