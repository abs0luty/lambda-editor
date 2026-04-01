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

interface ReconcileState {
  reason: string
  serverContent: string
  serverRevision: number
  localContent: string
}

export default function EditorPage() {
  const { projectId, docId } = useParams<{ projectId: string; docId: string }>()
  const navigate = useNavigate()
  const {
    token, currentDoc, currentProject,
    setCurrentDoc, setPresence, setConnected,
    updateDocContent, updateDocSyncState, updateDocTitle, setCompiledPdf,
    isConnected,
    user,
  } = useStore()

  const socketRef = useRef<RoomSocket | null>(null)
  const opApplierRef = useRef<((ops: TextOp[]) => boolean) | null>(null)
  const textInserterRef = useRef<((text: string) => void) | null>(null)
  const getCursorPosRef = useRef<(() => { lineNumber: number; column: number } | null) | null>(null)
  const currentDocRef = useRef(currentDoc)

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
  const [reconnectingDelayMs, setReconnectingDelayMs] = useState<number | null>(null)
  const [reconcileState, setReconcileState] = useState<ReconcileState | null>(null)

  useEffect(() => {
    currentDocRef.current = currentDoc
  }, [currentDoc])

  const handleLocalDocumentChange = useCallback((content: string) => {
    const socket = socketRef.current
    const baseRevision = currentDocRef.current?.content_revision ?? 0
    if (socket?.isOpen()) {
      socket.sendRevisionedUpdate(content, baseRevision)
      return
    }
    socket?.setPendingDraft({
      content,
      baseRevision,
      timestamp: Date.now(),
    })
  }, [])

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
      socket.on('connected', () => {
        setConnected(true)
        setReconnectingDelayMs(null)
      }),
      socket.on('disconnected', () => setConnected(false)),
      socket.on('reconnecting', (msg: any) => setReconnectingDelayMs(msg.delay_ms as number)),
      socket.on('init', (msg: any) => {
        updateDocSyncState({ content: msg.content, content_revision: msg.revision })
        setPresence(msg.presence as Presence[])
        setReadOnly(!!msg.read_only)
        const pendingDraft = socket.getPendingDraft()
        if (pendingDraft && Date.now() - pendingDraft.timestamp <= 5 * 60 * 1000) {
          if ((msg.revision as number) === pendingDraft.baseRevision) {
            updateDocContent(pendingDraft.content)
            socket.sendRevisionedUpdate(pendingDraft.content, msg.revision as number)
          } else {
            socket.clearPendingDraft()
            setReconcileState({
              reason: 'offline-conflict',
              serverContent: msg.content as string,
              serverRevision: msg.revision as number,
              localContent: pendingDraft.content,
            })
          }
        } else {
          socket.clearPendingDraft()
        }
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
      socket.on('ack', (msg: any) => {
        socket.clearPendingDraft()
        updateDocSyncState({ content: msg.content, content_revision: msg.revision })
      }),
      socket.on('update', (msg: any) => {
        socket.clearPendingDraft()
        updateDocSyncState({ content: msg.content, content_revision: msg.revision })
      }),
      socket.on('op', (msg: any) => {
        const applied = opApplierRef.current?.(msg.ops as TextOp[]) ?? false
        if (!applied) {
          updateDocContent(msg.content as string)
        }
        updateDocSyncState({ content: msg.content as string, content_revision: msg.revision as number })
      }),
      socket.on('reconcile', (msg: any) => {
        socket.clearPendingDraft()
        updateDocSyncState({ content: msg.server_content as string, content_revision: msg.server_revision as number })
        setReconcileState({
          reason: msg.reason as string,
          serverContent: msg.server_content as string,
          serverRevision: msg.server_revision as number,
          localContent: msg.local_content as string,
        })
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
  }, [docId, token, setConnected, setPresence, updateDocContent, updateDocSyncState, updateDocTitle, setCompiledPdf])

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

      {(!readOnly && !isConnected) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '8px 14px', background: '#3f1d2e', borderBottom: '1px solid #6b2147',
          color: '#fecdd3', fontSize: 12,
        }}>
          <span>
            Offline mode. Local edits stay in memory for up to 5 minutes and will replay when safe.
            {reconnectingDelayMs ? ` Reconnecting in ${Math.ceil(reconnectingDelayMs / 1000)}s.` : ''}
          </span>
        </div>
      )}

      {reconcileState && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          background: '#3a2a12', borderBottom: '1px solid #7c5b14', color: '#fde68a', fontSize: 12,
        }}>
          <span style={{ flex: 1 }}>
            Reconciliation required. The server document changed before your pending edits could be applied.
          </span>
          <button
            onClick={() => {
              updateDocSyncState({ content: reconcileState.localContent })
              setReconcileState(null)
            }}
            style={{ background: '#f59e0b', color: '#111827', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            Review My Draft
          </button>
          <button
            onClick={() => {
              const socket = socketRef.current
              if (!socket?.isOpen()) return
              updateDocSyncState({ content: reconcileState.localContent })
              socket.sendRevisionedUpdate(reconcileState.localContent, reconcileState.serverRevision)
              setReconcileState(null)
            }}
            style={{ background: '#fef3c7', color: '#78350f', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            Overwrite With My Draft
          </button>
          <button
            onClick={() => {
              updateDocSyncState({ content: reconcileState.serverContent, content_revision: reconcileState.serverRevision })
              setReconcileState(null)
            }}
            style={{ background: 'transparent', color: '#fde68a', border: '1px solid #7c5b14', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
          >
            Keep Server Version
          </button>
        </div>
      )}

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
            onLocalDocumentChange={handleLocalDocumentChange}
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
