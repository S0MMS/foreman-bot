import { useState, useEffect, useRef } from 'react'

const STATUS_DOT = {
  online:  'bg-green-500',
  busy:    'bg-yellow-500',
  offline: 'bg-gray-600',
}

// ── Bot leaf item ──────────────────────────────────────────────────────────────

function BotItem({ node, activeBotName, onSelectBot, depth, onDragStart, onDragEnd, status }) {
  const isActive = activeBotName === node.botName
  const dotColor = STATUS_DOT[status] ?? STATUS_DOT.offline
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', node.botName)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(node.botName)
      }}
      onDragEnd={onDragEnd}
      onClick={() => onSelectBot(node.botName)}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      className={`w-full text-left py-1.5 pr-3 rounded-md text-sm mb-0.5 flex items-center gap-2 transition-colors cursor-grab active:cursor-grabbing
        ${isActive
          ? 'bg-[#1f3050] text-[#58a6ff]'
          : 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]'
        }`}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} title={status ?? 'offline'} />
      <span className="truncate">{node.label}</span>
    </button>
  )
}

// ── Folder item (collapsible, drop target) ─────────────────────────────────────

function FolderItem({ node, activeBotName, onSelectBot, depth, onDragStart, onDragEnd, dragOverFolder, setDragOverFolder, dragCounterRef, onDropOnFolder, onDeleteFolder, botStatuses }) {
  const [open, setOpen] = useState(true)
  const isOver = dragOverFolder === node.id
  const isEmpty = (node.children ?? []).length === 0

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault()
        dragCounterRef.current[node.id] = (dragCounterRef.current[node.id] || 0) + 1
        setDragOverFolder(node.id)
      }}
      onDragLeave={() => {
        dragCounterRef.current[node.id] = (dragCounterRef.current[node.id] || 1) - 1
        if (dragCounterRef.current[node.id] <= 0) {
          dragCounterRef.current[node.id] = 0
          setDragOverFolder(prev => prev === node.id ? null : prev)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragCounterRef.current[node.id] = 0
        const botName = e.dataTransfer.getData('text/plain')
        if (botName) onDropOnFolder(node.id.replace('folder:', ''), botName)
      }}
      className={`rounded-md transition-colors ${isOver ? 'ring-1 ring-[#58a6ff] bg-[#1f3050]/40' : ''}`}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        className="w-full text-left py-1 pr-1 flex items-center gap-1.5 text-[#8b949e] hover:text-[#e6edf3] transition-colors group"
      >
        <span className="text-xs flex-shrink-0 transition-transform" style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        <span className="text-xs font-semibold uppercase tracking-wider truncate flex-1">{node.label}</span>
        {isEmpty && onDeleteFolder && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDeleteFolder(node.id.replace('folder:', '')) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDeleteFolder(node.id.replace('folder:', '')) } }}
            className="opacity-0 group-hover:opacity-100 text-[#8b949e] hover:text-red-400 transition-opacity px-1 text-xs"
            title="Delete empty folder"
          >✕</span>
        )}
      </button>
      {open && (
        <div>
          {isEmpty && (
            <p style={{ paddingLeft: `${20 + depth * 12}px` }} className="text-[#484f58] text-xs py-1 italic">
              Drop bots here
            </p>
          )}
          {(node.children ?? []).map(child => (
            <RosterNode
              key={child.id}
              node={child}
              activeBotName={activeBotName}
              onSelectBot={onSelectBot}
              depth={depth + 1}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              dragOverFolder={dragOverFolder}
              setDragOverFolder={setDragOverFolder}
              dragCounterRef={dragCounterRef}
              onDropOnFolder={onDropOnFolder}
              onDeleteFolder={onDeleteFolder}
              botStatuses={botStatuses}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Recursive RosterNode dispatcher ───────────────────────────────────────────

function RosterNode({ node, activeBotName, onSelectBot, depth = 0, onDragStart, onDragEnd, dragOverFolder, setDragOverFolder, dragCounterRef, onDropOnFolder, onDeleteFolder, botStatuses }) {
  if (node.type === 'bot') {
    return <BotItem node={node} activeBotName={activeBotName} onSelectBot={onSelectBot} depth={depth} onDragStart={onDragStart} onDragEnd={onDragEnd} status={botStatuses?.[node.botName]} />
  }
  return <FolderItem node={node} activeBotName={activeBotName} onSelectBot={onSelectBot} depth={depth} onDragStart={onDragStart} onDragEnd={onDragEnd} dragOverFolder={dragOverFolder} setDragOverFolder={setDragOverFolder} dragCounterRef={dragCounterRef} onDropOnFolder={onDropOnFolder} onDeleteFolder={onDeleteFolder} botStatuses={botStatuses} />
}

// ── LeftNav root ───────────────────────────────────────────────────────────────

export default function LeftNav({ activeBotName, onSelectBot, botStatuses }) {
  const [rosterTree, setRosterTree] = useState([])
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const dragCounterRef = useRef({})

  function fetchRoster() {
    fetch('/api/roster')
      .then(r => r.json())
      .then(setRosterTree)
      .catch(console.error)
  }

  useEffect(() => { fetchRoster() }, [])

  function handleDragStart(botName) {
    // intentionally empty — dataTransfer set in BotItem
  }

  function handleDragEnd() {
    setDragOverFolder(null)
    dragCounterRef.current = {}
  }

  async function handleDropOnFolder(folderPath, botName) {
    setDragOverFolder(null)
    dragCounterRef.current = {}
    try {
      await fetch(`/api/roster/${botName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath }),
      })
      fetchRoster()
    } catch (err) {
      console.error('[roster] drop failed', err)
    }
  }

  async function handleCreateFolder() {
    const name = window.prompt('New folder name:')
    if (!name || !name.trim()) return
    try {
      await fetch('/api/roster/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: name.trim() }),
      })
      fetchRoster()
    } catch (err) {
      console.error('[roster] create folder failed', err)
    }
  }

  async function handleDeleteFolder(folderPath) {
    try {
      await fetch(`/api/roster/folders/${folderPath}`, { method: 'DELETE' })
      fetchRoster()
    } catch (err) {
      console.error('[roster] delete folder failed', err)
    }
  }

  const isArchitect = activeBotName === 'architect'

  return (
    <div className="w-56 flex-shrink-0 bg-[#161b22] flex flex-col">
      <div className="px-4 py-3 border-b border-[#30363d]">
        <span className="text-[#58a6ff] font-semibold text-sm tracking-wide uppercase">Foreman</span>
      </div>

      {/* Architect section */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-[#8b949e] text-xs uppercase tracking-wider font-medium">Architect</span>
      </div>
      <div className="px-2">
        <button
          onClick={() => onSelectBot('architect')}
          className={`w-full text-left px-3 py-2 rounded-md text-sm mb-0.5 flex items-center gap-2 transition-colors
            ${isArchitect
              ? 'bg-[#2d1f50] text-[#bf86ff]'
              : 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]'
            }`}
        >
          <span>⚡</span>
          <span className="truncate font-medium">Foreman</span>
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-[#30363d]" />

      {/* Roster tree */}
      <div className="px-3 pb-1 flex items-center justify-between">
        <span className="text-[#8b949e] text-xs uppercase tracking-wider font-medium">Bots</span>
        <button
          onClick={handleCreateFolder}
          className="text-[#8b949e] hover:text-[#e6edf3] text-sm leading-none px-1 transition-colors"
          title="New folder"
        >+</button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {rosterTree.map(node => (
          <RosterNode
            key={node.id}
            node={node}
            activeBotName={activeBotName}
            onSelectBot={onSelectBot}
            depth={0}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            dragOverFolder={dragOverFolder}
            setDragOverFolder={setDragOverFolder}
            dragCounterRef={dragCounterRef}
            onDropOnFolder={handleDropOnFolder}
            onDeleteFolder={handleDeleteFolder}
            botStatuses={botStatuses}
          />
        ))}
      </nav>
    </div>
  )
}
