import { Download, FileText, Image as ImageIcon } from 'lucide-react'
import { docsApi } from '../services/api'
import { useStore } from '../store/useStore'

interface Props {
  projectId?: string
}

function isImage(mimeType?: string | null, title?: string) {
  return (mimeType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(title || '')
}

function isTextLike(mimeType?: string | null, title?: string) {
  return (mimeType || '').startsWith('text/') || /\.(txt|md|markdown|csv|json|ya?ml|xml)$/i.test(title || '')
}

export default function AssetViewer({ projectId }: Props) {
  const { currentDoc } = useStore()

  if (!currentDoc || !projectId) {
    return null
  }

  const downloadUrl = docsApi.downloadUrl(projectId, currentDoc.id)
  const imageAsset = isImage(currentDoc.mime_type, currentDoc.source_filename || currentDoc.title)
  const textAsset = isTextLike(currentDoc.mime_type, currentDoc.source_filename || currentDoc.title)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#151528' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #26263a', background: '#121224',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{currentDoc.title}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            {currentDoc.mime_type || 'application/octet-stream'}
            {typeof currentDoc.file_size === 'number' ? ` • ${currentDoc.file_size.toLocaleString()} bytes` : ''}
          </div>
        </div>
        <a
          href={downloadUrl}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', borderRadius: 8, textDecoration: 'none',
            background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600,
          }}
        >
          <Download size={14} />
          Download
        </a>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {imageAsset ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '100%', background: '#0b1120', borderRadius: 14, border: '1px solid #1e293b', padding: 16,
          }}>
            <img
              src={downloadUrl}
              alt={currentDoc.title}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }}
            />
          </div>
        ) : textAsset ? (
          <pre style={{
            margin: 0, padding: 18, borderRadius: 14, background: '#0f172a', color: '#dbeafe',
            border: '1px solid #1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: 13, lineHeight: 1.55, fontFamily: 'Monaco, Menlo, monospace',
          }}>
            {currentDoc.content || ''}
          </pre>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: '100%', gap: 14, color: '#94a3b8',
            border: '1px dashed #334155', borderRadius: 14, background: '#0f172a',
          }}>
            {currentDoc.mime_type?.startsWith('image/') ? <ImageIcon size={44} /> : <FileText size={44} />}
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Preview unavailable</div>
            <div style={{ fontSize: 12 }}>Download the file to open it locally.</div>
          </div>
        )}
      </div>
    </div>
  )
}
