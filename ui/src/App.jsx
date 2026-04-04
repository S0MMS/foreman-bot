import { useState, useEffect } from 'react'
import LeftNav from './components/LeftNav.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import CanvasPanel from './components/CanvasPanel.jsx'
import TabBar from './components/TabBar.jsx'

export default function App() {
  const [bots, setBots] = useState([])
  const [activeBotName, setActiveBotName] = useState(null)
  const [messagesByBot, setMessagesByBot] = useState({})
  const [canvasesByBot, setCanvasesByBot] = useState({})
  const [activeTabByBot, setActiveTabByBot] = useState({})
  const [isLoading, setIsLoading] = useState(false)

  // Load bots on mount
  useEffect(() => {
    fetch('/api/bots')
      .then(r => r.json())
      .then(data => {
        setBots(data)
        if (data.length > 0) setActiveBotName(data[0].name)
      })
      .catch(console.error)
  }, [])

  // Load canvases when bot changes
  useEffect(() => {
    if (!activeBotName) return
    fetch(`/api/canvas/${activeBotName}`)
      .then(r => r.json())
      .then(canvases => setCanvasesByBot(prev => ({ ...prev, [activeBotName]: canvases })))
      .catch(console.error)
  }, [activeBotName])

  // SSE — listen for canvas updates
  useEffect(() => {
    if (!activeBotName) return
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
        // If deleted canvas was active tab, switch to chat
        setActiveTabByBot(prev => prev[activeBotName] === event.canvasId ? { ...prev, [activeBotName]: 'chat' } : prev)
      }
    }
    return () => es.close()
  }, [activeBotName])

  const activeTab = activeBotName ? (activeTabByBot[activeBotName] ?? 'chat') : 'chat'
  const messages = activeBotName ? (messagesByBot[activeBotName] ?? []) : []
  const canvases = activeBotName ? (canvasesByBot[activeBotName] ?? []) : []

  async function sendMessage(text) {
    if (!activeBotName || isLoading) return
    const userMsg = { id: Date.now().toString(), role: 'user', content: text }
    setMessagesByBot(prev => ({ ...prev, [activeBotName]: [...(prev[activeBotName] ?? []), userMsg] }))
    setIsLoading(true)
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

  function addCanvas() {
    if (!activeBotName) return
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
      <LeftNav bots={bots} activeBotName={activeBotName} onSelectBot={(name) => setActiveBotName(name)} />
      <div className="flex flex-col flex-1 min-w-0 border-l border-[#30363d]">
        <TabBar
          canvases={canvases}
          activeTab={activeTab}
          onSelectTab={(id) => setActiveTabByBot(prev => ({ ...prev, [activeBotName]: id }))}
          onAddCanvas={addCanvas}
          onCloseCanvas={closeCanvas}
        />
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat'
            ? <ChatPanel messages={messages} isLoading={isLoading} botName={activeBotName} onSend={sendMessage} />
            : <CanvasPanel canvas={activeCanvas} />
          }
        </div>
      </div>
    </div>
  )
}
