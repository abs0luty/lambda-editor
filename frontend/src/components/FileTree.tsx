import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, FileImage, FolderPlus, Folder as FolderIcon, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { docsApi } from '../services/api'
import { ProjectSocket } from '../services/socket'
import { Document, useStore } from '../store/useStore'

interface Props {
  projectId?: string
}

interface FolderItem {
  id: string
  path: string
  owner_id: string
  project_id: string
}

interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'file'
  doc?: Document
  children?: TreeNode[]
}

function fileIcon(doc: Document) {
  return doc.kind === 'uploaded' ? <FileImage size={13} /> : <FileCode2 size={13} />
}

function buildTree(documents: Document[], folders: FolderItem[]): TreeNode[] {
  const root = new Map<string, TreeNode>()

  const ensureFolder = (folderPath: string) => {
    const parts = folderPath.split('/').filter(Boolean)
    let cursor = root
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      if (!cursor.has(part)) {
        cursor.set(part, { name: part, path: currentPath, type: 'folder', children: [] })
      }
      const node = cursor.get(part)!
      cursor = new Map((node.children || []).map((child) => [child.name, child]))
      node.children = Array.from(cursor.values())
    }
  }

  const getFolderNode = (folderPath: string): TreeNode | undefined => {
    const parts = folderPath.split('/').filter(Boolean)
    let nodes = Array.from(root.values())
    let found: TreeNode | undefined
    for (const part of parts) {
      found = nodes.find((node) => node.type === 'folder' && node.name === part)
      if (!found) return undefined
      nodes = found.children || []
    }
    return found
  }

  for (const folder of folders) ensureFolder(folder.path)
  for (const doc of documents) {
    const parts = doc.path.split('/').filter(Boolean)
    const filename = parts.pop() || doc.title
    const parentPath = parts.join('/')
    if (parentPath) ensureFolder(parentPath)
    const fileNode: TreeNode = { name: filename, path: doc.path, type: 'file', doc }
    if (!parentPath) {
      root.set(`file:${doc.id}`, fileNode)
    } else {
      const parent = getFolderNode(parentPath)
      if (parent) {
        parent.children = [...(parent.children || []), fileNode]
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => node.type === 'folder' ? { ...node, children: sortNodes(node.children || []) } : node)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

  return sortNodes(Array.from(root.values()))
}

export default function FileTree({ projectId }: Props) {
  const { documents, token, setDocuments, upsertDocument, removeDocument } = useStore()
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [newFolderPath, setNewFolderPath] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
    Promise.all([docsApi.list(projectId), docsApi.listFolders(projectId)])
      .then(([docsRes, foldersRes]) => {
        setDocuments(docsRes.data)
        setFolders(foldersRes.data)
      })
      .finally(() => setLoading(false))
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
      socket.on('folder_created', (msg) => {
        const folder = msg.folder as FolderItem | undefined
        if (!folder) return
        setFolders((prev) => prev.some((item) => item.path === folder.path) ? prev : [...prev, folder])
        setExpanded((prev) => ({ ...prev, [folder.path]: true }))
      }),
    ]
    socket.connect()
    return () => {
      offs.forEach((off) => off())
      socket.destroy()
    }
  }, [projectId, token, navigate, upsertDocument, removeDocument])

  useEffect(() => {
    if (renamingDocId) renameInputRef.current?.focus()
  }, [renamingDocId])

  const nodes = useMemo(() => buildTree(documents, folders), [documents, folders])

  const createFile = async () => {
    if (!projectId || !newPath.trim()) return
    const res = await docsApi.create(projectId, newPath.trim(), '')
    upsertDocument(res.data)
    setCreatingFile(false)
    setNewPath('')
    navigate(`/projects/${projectId}/docs/${res.data.id}`)
  }

  const createFolder = async () => {
    if (!projectId || !newFolderPath.trim()) return
    const res = await docsApi.createFolder(projectId, newFolderPath.trim())
    setFolders((prev) => prev.some((item) => item.path === res.data.path) ? prev : [...prev, res.data])
    setExpanded((prev) => ({ ...prev, [res.data.path]: true }))
    setCreatingFolder(false)
    setNewFolderPath('')
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!projectId || !files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const res = await docsApi.upload(projectId, file)
        upsertDocument(res.data)
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const deleteDoc = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!projectId || !confirm('Delete this file?')) return
    await docsApi.delete(projectId, id)
    removeDocument(id)
    if (docId === id) navigate(`/projects/${projectId}`)
  }

  const startRename = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation()
    setRenamingDocId(doc.id)
    setRenameValue(doc.title)
  }

  const commitRename = async (doc: Document) => {
    const trimmed = renameValue.trim()
    setRenamingDocId(null)
    if (!projectId || !trimmed || trimmed === doc.title) return
    const parts = doc.path.split('/').filter(Boolean)
    parts[parts.length - 1] = trimmed
    const path = parts.join('/')
    const res = await docsApi.update(projectId, doc.id, { path })
    upsertDocument(res.data)
  }

  const moveDocToFolder = async (doc: Document, folderPath: string) => {
    if (!projectId) return
    const destination = folderPath ? `${folderPath}/${doc.title}` : doc.title
    if (destination === doc.path) return
    const res = await docsApi.update(projectId, doc.id, { path: destination })
    upsertDocument(res.data)
  }

  const renderNode = (node: TreeNode, depth = 0): React.ReactNode => {
    if (node.type === 'folder') {
      const isOpen = expanded[node.path] ?? true
      return (
        <div key={node.path}>
          <div
            onClick={() => setExpanded((prev) => ({ ...prev, [node.path]: !isOpen }))}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverPath(node.path)
            }}
            onDragLeave={() => setDragOverPath((current) => current === node.path ? null : current)}
            onDrop={async (e) => {
              e.preventDefault()
              const docIdFromDrop = e.dataTransfer.getData('application/x-doc-id')
              const doc = documents.find((item) => item.id === docIdFromDrop)
              setDragOverPath(null)
              if (doc) await moveDocToFolder(doc, node.path)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: `6px 12px 6px ${12 + depth * 14}px`,
              color: '#cbd5e1', cursor: 'pointer', fontSize: 12,
              background: dragOverPath === node.path ? '#1f2937' : 'transparent',
            }}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderIcon size={13} color="#fbbf24" />
            <span>{node.name}</span>
          </div>
          {isOpen && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const doc = node.doc!
    return (
      <div
        key={doc.id}
        onClick={() => navigate(`/projects/${projectId}/docs/${doc.id}`)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-doc-id', doc.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: `6px 12px 6px ${26 + depth * 14}px`,
          color: docId === doc.id ? '#c7d2fe' : '#9ca3af',
          background: docId === doc.id ? '#1e1e3a' : 'transparent',
          borderLeft: docId === doc.id ? '2px solid #4f46e5' : '2px solid transparent',
          cursor: 'pointer', fontSize: 12,
        }}
      >
        {fileIcon(doc)}
        {renamingDocId === doc.id ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename(doc)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void commitRename(doc)
              if (e.key === 'Escape') setRenamingDocId(null)
            }}
            style={{
              flex: 1,
              background: '#0f0f23',
              border: '1px solid #4f46e5',
              borderRadius: 3,
              padding: '1px 5px',
              color: '#e2e8f0',
              fontSize: 12,
              outline: 'none',
              minWidth: 0,
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => startRename(e, doc)}
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {node.name}
          </span>
        )}
        <button onClick={(e) => deleteDoc(e, doc.id)} style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', padding: 2 }}>
          <Trash2 size={11} />
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f0f23' }}>
      <div style={{
        padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1e1e3a',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Files
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setCreatingFolder((v) => !v)} title="New folder" style={buttonStyle('#fbbf24')}>
            <FolderPlus size={14} />
          </button>
          <button onClick={() => setCreatingFile((v) => !v)} title="New file" style={buttonStyle('#818cf8')}>
            <Plus size={14} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} title="Upload files" style={buttonStyle('#38bdf8')}>
            {uploading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
          </button>
        </div>
        <input ref={fileInputRef} type="file" multiple onChange={(e) => void uploadFiles(e.target.files)} style={{ display: 'none' }} />
      </div>

      {creatingFile && (
        <div style={{ padding: 10, borderBottom: '1px solid #1e1e3a' }}>
          <input
            autoFocus
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFile()
              if (e.key === 'Escape') setCreatingFile(false)
            }}
            placeholder="src/app.py or notes/todo.md"
            style={inputStyle}
          />
        </div>
      )}

      {creatingFolder && (
        <div style={{ padding: 10, borderBottom: '1px solid #1e1e3a' }}>
          <input
            autoFocus
            value={newFolderPath}
            onChange={(e) => setNewFolderPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFolder()
              if (e.key === 'Escape') setCreatingFolder(false)
            }}
            placeholder="assets/images"
            style={inputStyle}
          />
        </div>
      )}

      <div
        style={{ flex: 1, overflow: 'auto', background: dragOverPath === '' ? '#111827' : 'transparent' }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOverPath('')
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDragOverPath((current) => current === '' ? null : current)
        }}
        onDrop={async (e) => {
          e.preventDefault()
          const docIdFromDrop = e.dataTransfer.getData('application/x-doc-id')
          const doc = documents.find((item) => item.id === docIdFromDrop)
          setDragOverPath(null)
          if (doc) await moveDocToFolder(doc, '')
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <Loader2 size={16} color="#6b7280" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: 16, color: '#4a4a6a', fontSize: 12, textAlign: 'center' }}>
            No files.
          </div>
        ) : (
          nodes.map((node) => renderNode(node))
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function buttonStyle(color: string): React.CSSProperties {
  return { background: 'none', border: 'none', color, cursor: 'pointer', padding: 2 }
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#1e1e3a',
  border: '1px solid #4f46e5',
  borderRadius: 4,
  padding: '6px 8px',
  color: '#e2e8f0',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
}
