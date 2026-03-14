import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Plus } from 'lucide-react'

interface Props {
  content: string
  onInsertText?: (text: string) => void
}

export default function MarkdownMessage({ content, onInsertText }: Props) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.65, color: '#c7d2fe', minWidth: 0 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children).replace(/\n$/, '')
            if (!match) {
              return (
                <code style={{ background: '#0d0d20', borderRadius: 3, padding: '1px 5px', fontSize: '0.88em', color: '#a5b4fc', fontFamily: 'monospace' }} {...props}>
                  {children}
                </code>
              )
            }
            const isLatex = match[1] === 'latex' || match[1] === 'tex'
            return (
              <div style={{ position: 'relative', margin: '6px 0' }}>
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{ borderRadius: 6, fontSize: 12, margin: 0, padding: '10px 14px' }}
                >
                  {codeStr}
                </SyntaxHighlighter>
                {isLatex && onInsertText && (
                  <button
                    onClick={() => onInsertText(codeStr)}
                    style={{
                      position: 'absolute', top: 6, right: 6, display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 4, border: '1px solid #4f46e5',
                      background: '#1e1e3a', color: '#a5b4fc', fontSize: 10, cursor: 'pointer', fontFamily: 'system-ui',
                    }}
                    title="Insert at cursor"
                  >
                    <Plus size={9} /> Insert
                  </button>
                )}
              </div>
            )
          },
          p: ({ children }) => <p style={{ margin: '4px 0', lineHeight: 1.65 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: '4px 0' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: 20, margin: '4px 0' }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 3 }}>{children}</li>,
          strong: ({ children }) => <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{children}</strong>,
          em: ({ children }) => <em style={{ color: '#a5b4fc' }}>{children}</em>,
          h1: ({ children }) => <h1 style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', margin: '8px 0 4px' }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '6px 0 3px' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: 13, fontWeight: 600, color: '#c7d2fe', margin: '4px 0 2px' }}>{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: '3px solid #4f46e5', paddingLeft: 10, color: '#9ca3af', margin: '6px 0' }}>{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'underline' }}>{children}</a>
          ),
          table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0', fontSize: 12 }}>{children}</table>,
          th: ({ children }) => <th style={{ border: '1px solid #2a2a4a', padding: '4px 8px', background: '#1e1e3a', color: '#c7d2fe' }}>{children}</th>,
          td: ({ children }) => <td style={{ border: '1px solid #2a2a4a', padding: '4px 8px' }}>{children}</td>,
          hr: () => <hr style={{ border: 'none', borderTop: '1px solid #2a2a4a', margin: '8px 0' }} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
