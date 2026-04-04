export default function MessageBubble({ message }) {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'

  if (isError) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-red-900/40 border border-red-700/50 text-red-300 text-sm rounded-lg px-4 py-2 max-w-lg">
          ⚠ {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
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
  )
}
