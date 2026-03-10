import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { docsApi } from '../services/api'
import { RoomSocket, TextOp } from '../services/socket'
import { useStore, Presence } from '../store/useStore'
import Editor from '../components/Editor'
import Preview from '../components/Preview'
import AIChat from '../components/AIChat'
import FileTree from '../components/FileTree'
import Toolbar from '../components/Toolbar'
import VersionHistoryPanel from '../components/VersionHistoryPanel'

interface RemoteCursor {
  color: string
  username: string
  lineNumber: number
  column: number
  selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
}

export default function EditorPage() {
  const { projectId, docId } = useParams<{ projectId: string; docId: string }>()
  const navigate = useNavigate()
  const {
    token, currentDoc, currentProject,
    setCurrentDoc, setPresence, setConnected,
    updateDocContent, updateDocTitle, setCompiledPdf,
    user,
  } = useStore()

  const socketRef = useRef<RoomSocket | null>(null)
  const opApplierRef = useRef<((ops: TextOp[]) => void) | null>(null)
  const textInserterRef = useRef<((text: string) => void) | null>(null)
  const getCursorPosRef = useRef<(() => { lineNumber: number; column: number } | null) | null>(null)

  const [showAI, setShowAI] = useState(true)
  const [showPreview, setShowPreview] = useState(true)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [remoteDecorations, setRemoteDecorations] = useState<Map<string, RemoteCursor>>(new Map())
  const [readOnly, setReadOnly] = useState(false)
  const [previewWidth, setPreviewWidth] = useState(380)
  const [aiWidth, setAiWidth] = useState(320)
  const [, setLocalCursorPos] = useState<{ lineNumber: number; column: number } | null>(null)
  const [quoteForChat, setQuoteForChat] = useState<{ lineStart: number; lineEnd: number; text: string } | null>(null)
  const [pickingEquationLocation, setPickingEquationLocation] = useState(false)
  const [equationLocation, setEquationLocation] = useState<{ line: number; text: string; beforeText: string; afterText: string } | null>(null)

  useEffect(() => {
    if (!projectId || !docId) return
    setCompiledPdf(null, '')
    docsApi.get(projectId, docId)
      .then((res) => {
        setCurrentDoc(res.data)
        setCompiledPdf(res.data.compile_success ? res.data.compile_pdf_base64 : null, res.data.compile_log || '')
      })
      .catch(() => navigate(`/projects/${projectId}`))
  }, [projectId, docId, navigate, setCompiledPdf, setCurrentDoc])

  useEffect(() => {
    if (!docId || !token) return

    const socket = new RoomSocket(docId, token)
    socketRef.current = socket

    const offs = [
      socket.on('connected', () => setConnected(true)),
      socket.on('disconnected', () => setConnected(false)),
      socket.on('init', (msg: any) => {
        updateDocContent(msg.content)
        setPresence(msg.presence as Presence[])
        setReadOnly(!!msg.read_only)
        // Restore last known cursor positions for all currently connected users
        if (msg.cursors) {
          const restored = new Map<string, RemoteCursor>()
          for (const [uid, data] of Object.entries(msg.cursors as Record<string, any>)) {
            restored.set(uid, {
              color: data.color,
              username: data.username,
              lineNumber: data.position.lineNumber,
              column: data.position.column,
            })
          }
          setRemoteDecorations(restored)
        }
      }),
      socket.on('update', (msg: any) => updateDocContent(msg.content)),
      socket.on('op', (msg: any) => {
        opApplierRef.current?.(msg.ops as TextOp[])
      }),
      socket.on('presence', (msg: any) => setPresence(msg.presence as Presence[])),
      socket.on('title', (msg: any) => updateDocTitle(msg.title)),
      socket.on('compile_result', (msg: any) => {
        setCompiledPdf(msg.success ? msg.pdf_base64 : null, msg.log || '')
      }),
      socket.on('cursor', (msg: any) => {
        if (!msg.user_id || !msg.position) return
        setRemoteDecorations((prev) => {
          const next = new Map(prev)
          next.set(msg.user_id as string, {
            color: msg.color as string,
            username: msg.username as string,
            lineNumber: (msg.position as any).lineNumber,
            column: (msg.position as any).column,
            selection: msg.selection ?? undefined,
          })
          return next
        })
      }),
    ]

    socket.connect()

    return () => {
      offs.forEach((off) => off())
      socket.destroy()
      setConnected(false)
      socketRef.current = null
    }
  }, [docId, token, setConnected, setPresence, updateDocContent, updateDocTitle, setCompiledPdf])

  const handleOwnCursorMove = useCallback((pos: { lineNumber: number; column: number }) => {
    setLocalCursorPos(pos)
    if (!user) return
    // Show own cursor with label in the editor decorations
    setRemoteDecorations((prev) => {
      const next = new Map(prev)
      next.set(`own-${user.id}`, {
        color: '#4f46e5',  // indigo for own cursor
        username: user.username,
        lineNumber: pos.lineNumber,
        column: pos.column,
      })
      return next
    })
  }, [user])

  const startDragPreview = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = previewWidth
    const onMove = (ev: MouseEvent) => {
      setPreviewWidth(Math.max(200, Math.min(700, startW + (startX - ev.clientX))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [previewWidth])

  const startDragAI = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = aiWidth
    const onMove = (ev: MouseEvent) => {
      setAiWidth(Math.max(240, Math.min(600, startW + (startX - ev.clientX))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [aiWidth])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#1e1e2e' }}>
      <Toolbar
        onToggleAI={() => setShowAI((v) => {
          const next = !v
          if (!next) {
            setPickingEquationLocation(false)
            setEquationLocation(null)
          }
          return next
        })}
        onTogglePreview={() => setShowPreview((v) => !v)}
        showAI={showAI}
        showPreview={showPreview}
        showVersionHistory={showVersionHistory}
        onToggleVersionHistory={() => setShowVersionHistory((v) => !v)}
        projectId={projectId}
        readOnly={readOnly}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid #1e1e3a', overflow: 'hidden' }}>
          <FileTree projectId={projectId} />
        </div>

        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <Editor
            socket={socketRef.current}
            readOnly={readOnly}
            remoteDecorations={remoteDecorations}
            onRegisterOpApplier={(fn) => { opApplierRef.current = fn }}
            onRegisterTextInserter={(fn) => { textInserterRef.current = fn }}
            onRegisterGetCursorPos={(fn) => { getCursorPosRef.current = fn }}
            onCursorMove={handleOwnCursorMove}
            onSelectionQuote={(q) => setQuoteForChat(q)}
            pickingLocation={pickingEquationLocation}
            onLocationPicked={(loc) => { setEquationLocation(loc); setPickingEquationLocation(false) }}
            ownUsername={user?.username}
            ownColor="#4f46e5"
          />
        </div>

        {showPreview && (
          <>
            <div
              onMouseDown={startDragPreview}
              style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid #1e1e3a' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#4f46e5')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            />
            <div style={{ width: previewWidth, flexShrink: 0, overflow: 'hidden' }}>
              <Preview socket={socketRef.current} onClose={() => setShowPreview(false)} />
            </div>
          </>
        )}

        {showAI && (
          <>
            <div
              onMouseDown={startDragAI}
              style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid #1e1e3a' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#4f46e5')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            />
            <div style={{ width: aiWidth, flexShrink: 0, overflow: 'hidden' }}>
              <AIChat
                socket={socketRef.current}
                onInsertText={(text) => textInserterRef.current?.(text)}
                onClose={() => {
                  setShowAI(false)
                  setPickingEquationLocation(false)
                  setEquationLocation(null)
                }}
                readOnly={readOnly}
                pendingQuote={quoteForChat}
                onQuoteConsumed={() => setQuoteForChat(null)}
                pendingEquationLocation={equationLocation}
                isPickingEquationLocation={pickingEquationLocation}
                onRequestEquationLocation={() => {
                  setEquationLocation(null)
                  setPickingEquationLocation(true)
                }}
                onCancelEquationLocation={() => {
                  setPickingEquationLocation(false)
                  setEquationLocation(null)
                }}
                currentDocTitle={currentDoc?.title}
              />
            </div>
          </>
        )}
      </div>

      {showVersionHistory && projectId && docId && (
        <VersionHistoryPanel
          projectId={projectId}
          docId={docId}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </div>
  )
}
