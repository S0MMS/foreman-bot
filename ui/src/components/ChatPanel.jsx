import { useState, useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble.jsx'

// ── Tool Approval Card ─────────────────────────────────────────────────────────

function ToolApprovalCard({ approval, onApprove }) {
  return (
    <div className="border border-yellow-600/50 bg-yellow-900/20 rounded-lg p-3 my-2 mx-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400">🔧</span>
        <span className="text-yellow-300 font-medium text-sm">{approval.name}</span>
      </div>
      <pre className="text-xs text-gray-300 bg-black/30 rounded p-2 mb-3 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(approval.input, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(approval.toolId, true)}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded-md transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onApprove(approval.toolId, false)}
          className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-sm rounded-md transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  )
}

// ── Session Info Card ─────────────────────────────────────────────────────────

function SessionInfoCard({ data }) {
  const { session, tools } = data
  const foremanTotal = Object.values(tools.foreman).reduce((sum, arr) => sum + arr.length, 0)

  return (
    <div className="border border-[#30363d] bg-[#161b22] rounded-lg p-4 my-2 mx-4 font-mono text-xs">
      {/* Session info */}
      <div className="text-[#58a6ff] font-medium mb-2">Session</div>
      <div className="text-[#8b949e] ml-2 space-y-0.5">
        <div>Model:        <span className="text-[#e6edf3]">{session.model}</span></div>
        <div>Name:         <span className="text-[#e6edf3]">{session.name ?? '(none)'}</span></div>
        <div>CWD:          <span className="text-[#e6edf3]">{session.cwd}</span></div>
        <div>Auto-approve: <span className="text-[#e6edf3]">{session.autoApprove ? 'on' : 'off'}</span></div>
        <div>Session ID:   <span className="text-[#e6edf3]">{session.sessionId ?? '(none)'}</span></div>
      </div>

      <div className="border-t border-[#30363d] my-3" />

      {/* Tools */}
      <div className="text-[#58a6ff] font-medium mb-2">Available Tools</div>

      {/* Claude Code built-in */}
      <div className="ml-2 mb-2">
        <div className="text-[#f0883e]">Claude Code Built-in ({tools.builtins.length})</div>
        <div className="text-[#e6edf3] ml-3">{tools.builtins.join(', ')}</div>
      </div>

      {/* Foreman Toolbelt */}
      <div className="ml-2 mb-2">
        <div className="text-[#f0883e]">Foreman Toolbelt ({foremanTotal})</div>
        {Object.entries(tools.foreman).map(([group, items]) => (
          <div key={group} className="ml-3 mt-1">
            <div className="text-[#7ee787]">{group}</div>
            <div className="text-[#e6edf3] ml-3">{items.join(', ')}</div>
          </div>
        ))}
      </div>

      {/* Cloud MCPs */}
      {tools.cloudMcps.length > 0 && (
        <div className="ml-2">
          <div className="text-[#f0883e]">Cloud MCPs ({tools.cloudMcps.length})</div>
          <div className="text-[#e6edf3] ml-3">{tools.cloudMcps.join(', ')}</div>
        </div>
      )}
    </div>
  )
}

// ── Message renderer — handles all message types ───────────────────────────────

function MessageRow({ msg, onApprove }) {
  if (msg.role === 'tool_approval') {
    return <ToolApprovalCard approval={msg.approval} onApprove={onApprove} />
  }
  if (msg.role === 'session_info') {
    return <SessionInfoCard data={msg.sessionInfo} />
  }
  return <MessageBubble message={msg} />
}

// ── ChatPanel ──────────────────────────────────────────────────────────────────

export default function ChatPanel({ messages, isLoading, botName, onSend, onApprove }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const prevBotRef = useRef(botName)

  useEffect(() => {
    // Jump instantly when switching bots; smooth-scroll for new messages
    const switched = prevBotRef.current !== botName
    prevBotRef.current = botName
    bottomRef.current?.scrollIntoView({ behavior: switched ? 'instant' : 'smooth' })
  }, [messages, isLoading, botName])

  // Re-focus input when loading finishes (so user can keep typing immediately)
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus()
    }
  }, [isLoading])

  function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput('')
    onSend(text)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-[#8b949e] text-sm">
              {botName ? `Start a conversation with ${botName}` : 'Select a bot to begin'}
            </p>
          </div>
        )}
        {messages.map(msg => (
          <MessageRow key={msg.id} msg={msg} onApprove={onApprove} />
        ))}
        {isLoading && (
          <div className="flex justify-start mb-4">
            <div className="w-7 h-7 rounded-full bg-[#2d1f50] flex items-center justify-center text-xs flex-shrink-0 mr-2 mt-0.5">
              {botName === 'architect' ? '⚡' : '🤖'}
            </div>
            <div className="bg-[#21262d] rounded-2xl rounded-tl-sm px-4 py-2.5">
              <span className="text-[#8b949e] text-sm animate-pulse">●●●</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-[#30363d]">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || !botName}
            placeholder={botName ? `Message ${botName}…` : 'Select a bot first'}
            rows={1}
            className="flex-1 bg-[#21262d] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm text-[#e6edf3] placeholder-[#8b949e] resize-none focus:outline-none focus:border-[#58a6ff] transition-colors disabled:opacity-50"
            style={{ minHeight: '42px', maxHeight: '120px' }}
            onInput={e => {
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !botName}
            className="bg-[#238636] hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#8b949e] text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
          >
            Send
          </button>
        </div>
        <p className="text-[#484f58] text-xs mt-1.5 px-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
