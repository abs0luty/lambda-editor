import { useState, useEffect, useRef } from 'react'
import { FilePlus, Trash2, FileText, Loader2 } from 'lucide-react'
import { docsApi } from '../services/api'
import { ProjectSocket } from '../services/socket'
import { useStore, Document } from '../store/useStore'
import { useNavigate, useParams } from 'react-router-dom'

interface Props {
  projectId?: string
}

export default function FileTree({ projectId }: Props) {
  const { documents, token, setDocuments, upsertDocument, removeDocument, updateDocTitle } = useStore()
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { docId } = useParams<{ docId?: string }>()
  const currentDocIdRef = useRef<string | undefined>(docId)

  useEffect(() => {
    currentDocIdRef.current = docId
  }, [docId])

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    docsApi.list(projectId).then((r) => { setDocuments(r.data); setLoading(false) })
  }, [projectId, setDocuments])

  useEffect(() => {
    if (!projectId || !token) return
    const socket = new ProjectSocket(projectId, token)
    const offs = [
      socket.on('document_created', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) upsertDocument(doc)
      }),
      socket.on('document_updated', (msg) => {
        const doc = msg.document as Document | undefined
        if (doc) upsertDocument(doc)
      }),
      socket.on('document_deleted', (msg) => {
        const doc = msg.document as Document | undefined
        if (!doc) return
        removeDocument(doc.id)
        if (currentDocIdRef.current === doc.id) navigate(`/projects/${projectId}`)
      }),
    ]
    socket.connect()
    return () => {
      offs.forEach((off) => off())
      socket.destroy()
    }
  }, [projectId, token, navigate, upsertDocument, removeDocument])

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  const openDoc = (doc: Document) => {
    if (renamingId) return  // don't navigate while editing a name
    navigate(`/projects/${projectId}/docs/${doc.id}`)
  }

  const startRename = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation()
    setRenamingId(doc.id)
    setRenameVal(doc.title)
  }

  const commitRename = async (doc: Document) => {
    const title = renameVal.trim()
    setRenamingId(null)
    if (!title || title === doc.title || !projectId) return
    await docsApi.update(projectId, doc.id, { title })
    updateDocTitle(title)
    upsertDocument({ ...doc, title })
  }

  const createDoc = async () => {
    if (!newTitle.trim() || !projectId) return
    try {
      const defaultContent =
        `\\documentclass{article}\n\\title{${newTitle.trim()}}\n\\author{}\n\\date{\\today}\n\n` +
        `\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nWrite your content here.\n\n\\end{document}\n`
      const res = await docsApi.create(projectId, newTitle.trim(), defaultContent)
      upsertDocument(res.data)
      setCreating(false)
      setNewTitle('')
      navigate(`/projects/${projectId}/docs/${res.data.id}`)
    } catch {}
  }

  const deleteDoc = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!projectId || !confirm('Delete this document?')) return
    await docsApi.delete(projectId, id)
    removeDocument(id)
    if (docId === id) navigate(`/projects/${projectId}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f0f23' }}>
      <div style={{
        padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1e1e3a',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Documents
        </span>
        <button onClick={() => setCreating(true)} title="New document"
          style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 2 }}>
          <FilePlus size={14} />
        </button>
      </div>

      {creating && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a' }}>
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createDoc()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder="Title…"
            style={{
              width: '100%', background: '#1e1e3a', border: '1px solid #4f46e5',
              borderRadius: 4, padding: '4px 8px', color: '#e2e8f0', fontSize: 12,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <Loader2 size={16} color="#6b7280" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : documents.length === 0 ? (
          <div style={{ padding: 16, color: '#4a4a6a', fontSize: 12, textAlign: 'center' }}>
            No documents.
          </div>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              onClick={() => openDoc(doc)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', cursor: 'pointer', fontSize: 12,
                background: docId === doc.id ? '#1e1e3a' : 'transparent',
                color: docId === doc.id ? '#c7d2fe' : '#9ca3af',
                borderLeft: docId === doc.id ? '2px solid #4f46e5' : '2px solid transparent',
                transition: 'all 0.1s',
              }}
            >
              <FileText size={12} style={{ flexShrink: 0 }} />

              {renamingId === doc.id ? (
                <input
                  ref={renameInputRef}
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => commitRename(doc)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename(doc)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1, background: '#0f0f23', border: '1px solid #4f46e5',
                    borderRadius: 3, padding: '1px 5px', color: '#e2e8f0',
                    fontSize: 12, outline: 'none', minWidth: 0,
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => startRename(e, doc)}
                  title="Double-click to rename"
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {doc.title}
                </span>
              )}

              <button
                onClick={(e) => deleteDoc(e, doc.id)}
                style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', padding: 2, opacity: 0.6, flexShrink: 0 }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
