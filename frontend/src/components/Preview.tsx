import { useState } from 'react'
import { AlertCircle, CheckCircle, ChevronDown, Download, FileText, Loader2, X } from 'lucide-react'
import { compileApi } from '../services/api'
import { RoomSocket } from '../services/socket'
import { useStore } from '../store/useStore'

interface Props {
  onClose?: () => void
  socket?: RoomSocket | null
}

type ExportFormat = 'pdf' | 'dvi' | 'ps'

const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'dvi', 'ps']

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function Preview({ onClose, socket }: Props) {
  const { currentDoc, compiledPdf, compileLog, isCompiling, setCompiledPdf, setCompiling } = useStore()
  const [isExporting, setIsExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)

  const compilePdf = async () => {
    if (!currentDoc?.content || isCompiling) return
    setCompiling(true)
    try {
      const res = await compileApi.compile(currentDoc.content, currentDoc.project_id, currentDoc.id, 'pdf')
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

  const exportRenderedFile = async (exportFormat: ExportFormat) => {
    if (!currentDoc?.content || isExporting) return
    setIsExporting(true)
    setShowExportMenu(false)
    try {
      const res = await compileApi.compile(currentDoc.content, currentDoc.project_id, currentDoc.id, exportFormat)
      const { success, file_base64, file_name, mime_type, log } = res.data
      if (!success || !file_base64 || !file_name || !mime_type) {
        setCompiledPdf(compiledPdf, log || 'Export failed')
        return
      }
      downloadBlob(base64ToBlob(file_base64, mime_type), file_name)
      if (exportFormat === 'pdf') {
        setCompiledPdf(file_base64, log || '')
        socket?.sendCompileResult({ success: true, pdf_base64: file_base64, log: log || '' })
      }
    } catch (e: any) {
      const log = e?.response?.data?.detail || 'Export failed'
      setCompiledPdf(compiledPdf, log)
    } finally {
      setIsExporting(false)
    }
  }

  const pdfUrl = compiledPdf ? `data:application/pdf;base64,${compiledPdf}` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a2e' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: '#16213e', borderBottom: '1px solid #2a2a4a',
      }}>
        <button
          onClick={compilePdf}
          disabled={isCompiling || !currentDoc}
          style={primaryButton(isCompiling)}
        >
          {isCompiling ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={14} />}
          {isCompiling ? 'Rendering…' : 'Render PDF'}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => !isExporting && setShowExportMenu((v) => !v)}
            disabled={isExporting || !currentDoc}
            style={secondaryButton(isExporting)}
          >
            {isExporting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
            Export
            <ChevronDown size={13} />
          </button>

          {showExportMenu && !isExporting && currentDoc && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              minWidth: 160,
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
              overflow: 'hidden',
              zIndex: 20,
            }}>
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format}
                  onClick={() => void exportRenderedFile(format)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <span>Export {format.toUpperCase()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {compiledPdf && !isCompiling && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 12 }}>
            <CheckCircle size={12} /> PDF ready
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
            <p style={{ fontSize: 14, margin: 0 }}>Render PDF to preview here.</p>
            <p style={{ fontSize: 12, margin: 0 }}>Other export formats download directly.</p>
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

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    background: disabled ? '#3a3a5a' : '#4f46e5',
    color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
  }
}

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #334155',
    background: disabled ? '#111827' : '#0f172a',
    color: '#e2e8f0',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
    fontWeight: 600,
  }
}

const closeBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 4, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#6b7280', cursor: 'pointer', flexShrink: 0,
}
