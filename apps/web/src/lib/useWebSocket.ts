'use client'

import { useEffect, useRef, useCallback } from 'react'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws'

export type WSMessage = {
  type: string
  payload: unknown
}

type Handler = (msg: WSMessage) => void

export function useWebSocket(workspace: string, onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<NodeJS.Timeout>()

  const connect = useCallback(() => {
    const token = localStorage.getItem('ta_token')
    if (!token || !workspace) return

    const url = `${WS_URL}?token=${token}&workspace=${workspace}`
    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('✅ WebSocket 已連線')
    }

    ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data)
        onMessage(msg)
      } catch {}
    }

    ws.onclose = () => {
      console.log('🔌 WebSocket 斷線，5 秒後重連')
      reconnectTimer.current = setTimeout(connect, 5000)
    }

    ws.onerror = (err) => {
      console.error('WebSocket 錯誤:', err)
      ws.close()
    }

    wsRef.current = ws
  }, [workspace, onMessage])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return wsRef
}
