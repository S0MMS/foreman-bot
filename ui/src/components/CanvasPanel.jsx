import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })

export default function CanvasPanel({ canvas }) {
  const mermaidRef = useRef(null)

  useEffect(() => {
    if (!canvas || canvas.type !== 'mermaid' || !canvas.content || !mermaidRef.current) return
    mermaid.render(`mermaid-${canvas.id}`, canvas.content)
      .then(({ svg }) => {
        if (mermaidRef.current) mermaidRef.current.innerHTML = svg
      })
      .catch(err => {
        if (mermaidRef.current) mermaidRef.current.innerHTML = `<pre class="text-red-400 text-xs">${err.message}</pre>`
      })
  }, [canvas?.id, canvas?.content])

  if (!canvas) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[#8b949e] text-sm">No canvas selected</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-[#e6edf3] font-semibold text-lg mb-1">{canvas.title}</h2>
        <p className="text-[#8b949e] text-xs mb-6 uppercase tracking-wide">{canvas.type}</p>

        {canvas.type === 'mermaid' && (
          <div ref={mermaidRef} className="flex justify-center" />
        )}

        {canvas.type === 'markdown' && (
          <div
            className="prose prose-invert prose-sm max-w-none text-[#e6edf3]"
            dangerouslySetInnerHTML={{ __html: marked(canvas.content || '*Empty canvas*') }}
          />
        )}

        {canvas.type === 'code' && (
          <pre className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 text-sm text-[#e6edf3] overflow-x-auto whitespace-pre-wrap">
            {canvas.content || '// Empty'}
          </pre>
        )}

        {canvas.type === 'csv' && (
          <CsvTable content={canvas.content} />
        )}

        {!canvas.content && canvas.type !== 'markdown' && canvas.type !== 'code' && (
          <p className="text-[#8b949e] text-sm italic">Empty canvas — ask a bot to fill this in.</p>
        )}
      </div>
    </div>
  )
}

function CsvTable({ content }) {
  if (!content) return <p className="text-[#8b949e] text-sm italic">Empty</p>
  const rows = content.trim().split('\n').map(r => r.split(','))
  const [header, ...body] = rows
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>{header.map((h, i) => (
            <th key={i} className="text-left px-3 py-2 bg-[#21262d] border border-[#30363d] text-[#8b949e] font-medium">{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i} className="border-b border-[#30363d] hover:bg-[#21262d]">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 border border-[#30363d] text-[#e6edf3]">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
