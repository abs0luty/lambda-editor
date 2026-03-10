import { useStore } from '../store/useStore'
import { compileApi } from '../services/api'
import { RoomSocket } from '../services/socket'
import { Loader2, AlertCircle, CheckCircle, FileText, X } from 'lucide-react'

interface Props {
  onClose?: () => void
  socket?: RoomSocket | null
}

export default function Preview({ onClose, socket }: Props) {
  const { currentDoc, compiledPdf, compileLog, isCompiling, setCompiledPdf, setCompiling } = useStore()

  const compile = async () => {
    if (!currentDoc?.content || isCompiling) return
    setCompiling(true)
    try {
      const res = await compileApi.compile(currentDoc.content, currentDoc.project_id, currentDoc.id)
      const { success, pdf_base64, log } = res.data
      setCompiledPdf(success ? pdf_base64 : null, log)
      socket?.sendCompileResult({ success, pdf_base64: success ? pdf_base64 : null, log })
    } catch (e: any) {
      const log = e?.response?.data?.detail || 'Compilation failed'
      setCompiledPdf(null, log)
      socket?.sendCompileResult({ success: false, pdf_base64: null, log })
    } finally {
      setCompiling(false)
    }
  }

  const pdfUrl = compiledPdf
    ? `data:application/pdf;base64,${compiledPdf}`
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a2e' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: '#16213e', borderBottom: '1px solid #2a2a4a',
      }}>
        <button
          onClick={compile}
          disabled={isCompiling || !currentDoc}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: isCompiling ? '#3a3a5a' : '#4f46e5', color: '#fff',
            cursor: isCompiling ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          {isCompiling ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={14} />}
          {isCompiling ? 'Compiling…' : 'Compile PDF'}
        </button>

        {compiledPdf && !isCompiling && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 12 }}>
            <CheckCircle size={12} /> Ready
          </span>
        )}

        <div style={{ flex: 1 }} />

        {onClose && (
          <button onClick={onClose} style={closeBtnStyle} title="Close preview">
            <X size={12} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {pdfUrl ? (
          <iframe
            src={pdfUrl}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            title="PDF Preview"
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 12, color: '#666',
          }}>
            <FileText size={48} />
            <p style={{ fontSize: 14 }}>Click "Compile PDF" to preview</p>
          </div>
        )}
      </div>

      {compileLog && (
        <div style={{
          maxHeight: 140, overflow: 'auto', background: '#0d0d1a',
          borderTop: '1px solid #2a2a4a', padding: '8px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: compiledPdf ? '#4ade80' : '#f87171', fontSize: 12 }}>
            {compiledPdf ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            <span style={{ fontWeight: 600 }}>{compiledPdf ? 'Compilation log' : 'Error log'}</span>
          </div>
          <pre style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {compileLog}
          </pre>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const closeBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 4, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#6b7280', cursor: 'pointer', flexShrink: 0,
}
