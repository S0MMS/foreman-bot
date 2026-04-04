import { useState, useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble.jsx'

export default function ChatPanel({ messages, isLoading, botName, onSend }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

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
        {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        {isLoading && (
          <div className="flex justify-start mb-4">
            <div className="w-7 h-7 rounded-full bg-[#1f3050] flex items-center justify-center text-xs flex-shrink-0 mr-2 mt-0.5">🤖</div>
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
