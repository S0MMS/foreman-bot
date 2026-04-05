function formatTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'
  const isSystem = message.role === 'system'
  const isToolProgress = message.role === 'tool_progress'
  const isStats = message.role === 'stats'
  const time = formatTime(message.ts)

  if (isError) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-red-900/40 border border-red-700/50 text-red-300 text-sm rounded-lg px-4 py-2 max-w-lg">
          ⚠ {message.content}
        </div>
      </div>
    )
  }

  if (isStats) {
    return (
      <div className="flex justify-start my-1 pl-9">
        <span className="text-xs italic text-[#484f58]">{message.content}</span>
      </div>
    )
  }

  if (isToolProgress) {
    return (
      <div className="flex justify-start my-0.5 pl-9">
        <span className="text-xs italic text-[#484f58]">{message.content}</span>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-[#1c2128] border border-[#30363d] text-[#8b949e] text-sm rounded-lg px-4 py-2 max-w-lg font-mono whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col mb-4 ${isUser ? 'items-end' : 'items-start'}`}>
      {time && (
        <span className={`text-[10px] text-[#484f58] mb-0.5 ${isUser ? 'mr-9' : 'ml-9'}`}>{time}</span>
      )}
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-[#1f3050] flex items-center justify-center text-xs flex-shrink-0 mr-2 mt-0.5">
            🤖
          </div>
        )}
        <div
          className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words
            ${isUser
              ? 'bg-[#1f3050] text-[#e6edf3] rounded-tr-sm'
              : 'bg-[#21262d] text-[#e6edf3] rounded-tl-sm'
            }`}
        >
          {message.content}
        </div>
        {isUser && (
          <div className="w-7 h-7 rounded-full bg-[#2d333b] flex items-center justify-center text-xs flex-shrink-0 ml-2 mt-0.5">
            👤
          </div>
        )}
      </div>
    </div>
  )
}
