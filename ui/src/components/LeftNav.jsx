const TYPE_ICON = { sdk: '🤖', mock: '🧪', webhook: '🔗', human: '👤' }

export default function LeftNav({ bots, activeBotName, onSelectBot }) {
  return (
    <div className="w-56 flex-shrink-0 bg-[#161b22] flex flex-col">
      <div className="px-4 py-3 border-b border-[#30363d]">
        <span className="text-[#58a6ff] font-semibold text-sm tracking-wide uppercase">Foreman</span>
      </div>
      <div className="px-3 pt-3 pb-1">
        <span className="text-[#8b949e] text-xs uppercase tracking-wider font-medium">Bots</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {bots.map(bot => (
          <button
            key={bot.name}
            onClick={() => onSelectBot(bot.name)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm mb-0.5 flex items-center gap-2 transition-colors
              ${activeBotName === bot.name
                ? 'bg-[#1f3050] text-[#58a6ff]'
                : 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]'
              }`}
          >
            <span>{TYPE_ICON[bot.type] ?? '🤖'}</span>
            <span className="truncate">{bot.name}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
