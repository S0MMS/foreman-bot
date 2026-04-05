import { useState, useEffect, useRef, useCallback } from 'react'
import LeftNav from './components/LeftNav.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import CanvasPanel from './components/CanvasPanel.jsx'
import TabBar from './components/TabBar.jsx'

export default function App() {
  const [activeBotName, setActiveBotName] = useState('architect')
  const [messagesByBot, setMessagesByBot] = useState({})
  const [canvasesByBot, setCanvasesByBot] = useState({})
  const [activeTabByBot, setActiveTabByBot] = useState({})
  const [isLoading, setIsLoading] = useState(false)

  // WebSocket ref for Architect sessions
  const wsRef = useRef(null)
  // Buffer for streaming assistant tokens from Architect
  const streamBufRef = useRef('')

  // ── WebSocket for Architect ──────────────────────────────────────────────────

  const connectArchitectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1 /* OPEN or CONNECTING */) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/architect`)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[ws] Architect connected')
    }

    ws.onmessage = (evt) => {
      let msg
      try { msg = JSON.parse(evt.data) } catch { return }

      if (msg.type === 'connected') {
        // handshake — no UI action needed
        return
      }

      if (msg.type === 'token') {
        // Accumulate streaming token into current assistant message
        streamBufRef.current += msg.content
        setMessagesByBot(prev => {
          const msgs = prev['architect'] ?? []
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'assistant' && last.streaming) {
            // Update existing streaming message
            const updated = { ...last, content: streamBufRef.current }
            return { ...prev, architect: [...msgs.slice(0, -1), updated] }
          } else {
            // Start a new streaming message
            const newMsg = {
              id: `stream-${Date.now()}`,
              role: 'assistant',
              content: streamBufRef.current,
              streaming: true,
            }
            return { ...prev, architect: [...msgs, newMsg] }
          }
        })
        return
      }

      if (msg.type === 'done') {
        // Finalize the streaming message
        const finalContent = msg.content || streamBufRef.current
        streamBufRef.current = ''
        setMessagesByBot(prev => {
          const msgs = prev['architect'] ?? []
          const last = msgs[msgs.length - 1]
          const finalized = last && last.streaming
            ? { ...last, content: finalContent, streaming: false }
            : { id: `done-${Date.now()}`, role: 'assistant', content: finalContent }
          const updated = last && last.streaming ? [...msgs.slice(0, -1), finalized] : [...msgs, finalized]
          if (msg.turns != null) {
            const statsMsg = {
              id: `stats-${Date.now()}`,
              role: 'stats',
              content: `Done in ${msg.turns} turn${msg.turns !== 1 ? 's' : ''} | $${Number(msg.cost).toFixed(4)} | ${msg.elapsedSec}s`,
            }
            return { ...prev, architect: [...updated, statsMsg] }
          }
          return { ...prev, architect: updated }
        })
        setIsLoading(false)
        return
      }

      if (msg.type === 'tool_progress') {
        const progressMsg = {
          id: `progress-${Date.now()}-${Math.random()}`,
          role: 'tool_progress',
          content: msg.content,
        }
        setMessagesByBot(prev => ({
          ...prev,
          architect: [...(prev['architect'] ?? []), progressMsg],
        }))
        return
      }

      if (msg.type === 'tool_approval') {
        // Insert a pending approval card into messages
        const approvalMsg = {
          id: `approval-${msg.toolId}`,
          role: 'tool_approval',
          approval: { toolId: msg.toolId, name: msg.name, input: msg.input },
        }
        setMessagesByBot(prev => ({
          ...prev,
          architect: [...(prev['architect'] ?? []), approvalMsg],
        }))
        return
      }

      if (msg.type === 'tool_result') {
        // Replace tool_approval card with a completed result entry
        setMessagesByBot(prev => {
          const msgs = prev['architect'] ?? []
          return {
            ...prev,
            architect: msgs.map(m =>
              m.role === 'tool_approval' && m.approval?.name === msg.name
                ? { ...m, role: 'tool_result', content: `Used tool: ${msg.name}` }
                : m
            ),
          }
        })
        return
      }

      if (msg.type === 'error') {
        streamBufRef.current = ''
        const errMsg = { id: `err-${Date.now()}`, role: 'error', content: msg.content }
        setMessagesByBot(prev => ({
          ...prev,
          architect: [...(prev['architect'] ?? []), errMsg],
        }))
        setIsLoading(false)
        return
      }
    }

    ws.onclose = () => {
      console.log('[ws] Architect disconnected — will reconnect on next message')
      wsRef.current = null
      setIsLoading(false)
    }

    ws.onerror = (err) => {
      console.error('[ws] Architect error', err)
    }
  }, [])

  // Open WS when Architect is active
  useEffect(() => {
    if (activeBotName === 'architect') {
      connectArchitectWs()
    }
  }, [activeBotName, connectArchitectWs])

  // Load canvases when bot changes (skip for architect)
  useEffect(() => {
    if (!activeBotName || activeBotName === 'architect') return
    fetch(`/api/canvas/${activeBotName}`)
      .then(r => r.json())
      .then(canvases => setCanvasesByBot(prev => ({ ...prev, [activeBotName]: canvases })))
      .catch(console.error)
  }, [activeBotName])

  // SSE — listen for canvas updates (skip for architect)
  useEffect(() => {
    if (!activeBotName || activeBotName === 'architect') return
    const es = new EventSource(`/api/events?botName=${activeBotName}`)
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'canvas_created') {
        setCanvasesByBot(prev => ({
          ...prev,
          [activeBotName]: [...(prev[activeBotName] ?? []), event.canvas]
        }))
      } else if (event.type === 'canvas_updated') {
        setCanvasesByBot(prev => ({
          ...prev,
          [activeBotName]: (prev[activeBotName] ?? []).map(c => c.id === event.canvas.id ? event.canvas : c)
        }))
      } else if (event.type === 'canvas_deleted') {
        setCanvasesByBot(prev => ({
          ...prev,
          [activeBotName]: (prev[activeBotName] ?? []).filter(c => c.id !== event.canvasId)
        }))
        setActiveTabByBot(prev => prev[activeBotName] === event.canvasId ? { ...prev, [activeBotName]: 'chat' } : prev)
      }
    }
    return () => es.close()
  }, [activeBotName])

  const activeTab = activeBotName ? (activeTabByBot[activeBotName] ?? 'chat') : 'chat'
  const messages = activeBotName ? (messagesByBot[activeBotName] ?? []) : []
  const canvases = activeBotName ? (canvasesByBot[activeBotName] ?? []) : []

  // ── Send message ─────────────────────────────────────────────────────────────

  async function sendMessage(text) {
    if (!activeBotName || isLoading) return

    const userMsg = { id: Date.now().toString(), role: 'user', content: text }
    setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), userMsg] }))

    // /f commands — session controls for the UI (equivalent to /cc in Slack)
    if (text.startsWith('/f ') || text === '/f') {
      const cmd = text.replace(/^\/f\s*/, '').split(/\s+/)[0]?.toLowerCase()

      if (cmd === 'stop') {
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }))
        }
        const sysMsg = { id: `sys-${Date.now()}`, role: 'system', content: 'Stop signal sent.' }
        setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), sysMsg] }))
        return
      }

      try {
        const res = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: text.replace(/^\/f\s+/, '/cc ') })
        })
        const data = await res.json()
        const sysMsg = { id: `sys-${Date.now()}`, role: 'system', content: data.response ?? data.error ?? 'No response' }
        setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), sysMsg] }))
      } catch (err) {
        const errMsg = { id: `err-${Date.now()}`, role: 'error', content: err.message }
        setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), errMsg] }))
      }
      return
    }

    setIsLoading(true)

    if (activeBotName === 'architect') {
      // Route through WebSocket
      connectArchitectWs()
      streamBufRef.current = ''
      // Wait briefly for connection if needed
      const ws = wsRef.current
      if (!ws) {
        const errMsg = { id: (Date.now() + 1).toString(), role: 'error', content: 'WebSocket not connected' }
        setMessagesByBot(prev => ({ ...prev, architect: [...(prev['architect'] ?? []), errMsg] }))
        setIsLoading(false)
        return
      }
      const sendWhenReady = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'message', content: text }))
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'message', content: text })), { once: true })
        } else {
          const errMsg = { id: (Date.now() + 1).toString(), role: 'error', content: 'WebSocket not ready' }
          setMessagesByBot(prev => ({ ...prev, architect: [...(prev['architect'] ?? []), errMsg] }))
          setIsLoading(false)
        }
      }
      sendWhenReady()
      return
    }

    // Regular bot — call /api/chat
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botName: activeBotName, message: text })
      })
      const data = await res.json()
      const botMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: data.response ?? data.error ?? 'No response' }
      setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), botMsg] }))
    } catch (err) {
      const errMsg = { id: (Date.now() + 1).toString(), role: 'error', content: err.message }
      setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), errMsg] }))
    } finally {
      setIsLoading(false)
    }
  }

  // ── Tool approval callback (Architect only) ──────────────────────────────────

  function handleApprove(toolId, approved) {
    // Remove the approval card from messages
    setMessagesByBot(prev => ({
      ...prev,
      architect: (prev['architect'] ?? []).filter(m => !(m.role === 'tool_approval' && m.approval?.toolId === toolId))
    }))
    // Send decision to WS
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'approve', toolId, approved }))
    }
  }

  // ── Canvas helpers ───────────────────────────────────────────────────────────

  function addCanvas() {
    if (!activeBotName || activeBotName === 'architect') return
    const title = window.prompt('Canvas title:')
    if (!title) return
    const type = window.prompt('Canvas type (markdown / mermaid / code / csv):', 'markdown')
    if (!type) return
    fetch(`/api/canvas/${activeBotName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, type })
    })
      .then(r => r.json())
      .then(canvas => {
        setCanvasesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), canvas] }))
        setActiveTabByBot(prev => ({ ...prev, [activeBotName]: canvas.id }))
      })
  }

  function closeCanvas(canvasId) {
    if (!activeBotName) return
    fetch(`/api/canvas/${activeBotName}/${canvasId}`, { method: 'DELETE' })
      .then(() => {
        setCanvasesByBot(prev => ({ ...prev, [activeBotName]: (prev[activeBotName] ?? []).filter(c => c.id !== canvasId) }))
        if (activeTab === canvasId) setActiveTabByBot(prev => ({ ...prev, [activeBotName]: 'chat' }))
      })
  }

  const activeCanvas = canvases.find(c => c.id === activeTab) ?? null

  return (
    <div className="flex h-screen overflow-hidden">
      <LeftNav activeBotName={activeBotName} onSelectBot={(name) => setActiveBotName(name)} />
      <div className="flex flex-col flex-1 min-w-0 border-l border-[#30363d]">
        <TabBar
          canvases={activeBotName === 'architect' ? [] : canvases}
          activeTab={activeTab}
          onSelectTab={(id) => setActiveTabByBot(prev => ({ ...prev, [activeBotName]: id }))}
          onAddCanvas={addCanvas}
          onCloseCanvas={closeCanvas}
        />
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat'
            ? <ChatPanel
                messages={messages}
                isLoading={isLoading}
                botName={activeBotName}
                onSend={sendMessage}
                onApprove={handleApprove}
              />
            : <CanvasPanel canvas={activeCanvas} />
          }
        </div>
      </div>
    </div>
  )
}
