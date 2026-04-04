export default function TabBar({ canvases, activeTab, onSelectTab, onAddCanvas, onCloseCanvas }) {
  return (
    <div className="flex items-center bg-[#161b22] border-b border-[#30363d] px-2 h-10 gap-1 overflow-x-auto flex-shrink-0">
      {/* Chat tab */}
      <button
        onClick={() => onSelectTab('chat')}
        className={`px-4 h-full text-sm flex-shrink-0 border-b-2 transition-colors
          ${activeTab === 'chat'
            ? 'border-[#58a6ff] text-[#e6edf3]'
            : 'border-transparent text-[#8b949e] hover:text-[#e6edf3]'
          }`}
      >
        Chat
      </button>

      {/* Canvas tabs */}
      {canvases.map(canvas => (
        <div key={canvas.id} className={`flex items-center gap-1 px-3 h-full text-sm flex-shrink-0 border-b-2 transition-colors
          ${activeTab === canvas.id
            ? 'border-[#58a6ff] text-[#e6edf3]'
            : 'border-transparent text-[#8b949e] hover:text-[#e6edf3]'
          }`}
        >
          <button onClick={() => onSelectTab(canvas.id)} className="max-w-[120px] truncate">
            {canvas.title}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCloseCanvas(canvas.id) }}
            className="text-[#484f58] hover:text-[#8b949e] leading-none ml-1"
          >
            ×
          </button>
        </div>
      ))}

      {/* Add canvas button */}
      <button
        onClick={onAddCanvas}
        className="ml-1 px-2 h-full text-[#8b949e] hover:text-[#e6edf3] text-lg leading-none flex-shrink-0"
        title="New canvas"
      >
        +
      </button>
    </div>
  )
}
