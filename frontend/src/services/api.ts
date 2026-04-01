import axios from 'axios'

const api = axios.create({ baseURL: '/api', withCredentials: true })

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth (REST: POST /users, POST /tokens, GET /users/me) ─────────────────────
export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post('/users', { email, username, password }),
  login: (email: string, password: string) =>
    api.post('/tokens', { email, password }),
  logout: () => api.delete('/sessions/me'),
  me: () => api.get('/users/me'),
}

// ── Projects ──────────────────────────────────────────────────────────────────
export const projectsApi = {
  list: () => api.get('/projects'),
  create: (title: string, description = '') => api.post('/projects', { title, description }),
  get: (id: string) => api.get(`/projects/${id}`),
  update: (id: string, data: { title?: string; description?: string }) =>
    api.patch(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  join: (invite_token: string) => api.post('/projects/join', { invite_token }),
  listMembers: (id: string) => api.get(`/projects/${id}/members`),
  updateMemberRole: (projectId: string, userId: string, role: string) =>
    api.patch(`/projects/${projectId}/members/${userId}`, { role }),
  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
  listInvites: (id: string) => api.get(`/projects/${id}/invites`),
  createInvite: (id: string, role: string, label: string) =>
    api.post(`/projects/${id}/invites`, { role, label }),
  deleteInvite: (projectId: string, inviteId: string) =>
    api.delete(`/projects/${projectId}/invites/${inviteId}`),
}

// ── Documents (project-scoped) ────────────────────────────────────────────────
export const docsApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/documents`),
  create: (projectId: string, title: string, content = '') =>
    api.post(`/projects/${projectId}/documents`, { title, content }),
  get: (projectId: string, docId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}`),
  update: (projectId: string, docId: string, data: { title?: string; content?: string }) =>
    api.patch(`/projects/${projectId}/documents/${docId}`, data),
  delete: (projectId: string, docId: string) =>
    api.delete(`/projects/${projectId}/documents/${docId}`),
}

// ── Versions ──────────────────────────────────────────────────────────────────
export const versionsApi = {
  list: (projectId: string, docId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}/versions`),
  create: (projectId: string, docId: string, label = '') =>
    api.post(`/projects/${projectId}/documents/${docId}/versions`, { label }),
  get: (projectId: string, docId: string, versionId: string) =>
    api.get(`/projects/${projectId}/documents/${docId}/versions/${versionId}`),
  restore: (projectId: string, docId: string, versionId: string) =>
    api.post(`/projects/${projectId}/documents/${docId}/versions/${versionId}/restore`),
}

// ── Compile ───────────────────────────────────────────────────────────────────
export const compileApi = {
  compile: (content: string, projectId?: string, docId?: string) => api.post('/compile', {
    content,
    project_id: projectId,
    doc_id: docId,
  }),
}

export const aiChatApi = {
  agent: (payload: {
    prompt: string
    document_context?: string
    project_id?: string
    doc_id?: string
    action_id?: string
  }) => api.post('/ai/agent', payload),
  history: (projectId: string, docId: string) => api.get(`/ai/history/${projectId}/${docId}`),
  updateReviewState: (projectId: string, docId: string, messageId: string, accepted: string[], rejected: string[]) =>
    api.patch(`/ai/history/${projectId}/${docId}/${messageId}/review`, { accepted, rejected }),
}

// ── AI streaming helper ────────────────────────────────────────────────────────
export async function streamAI(
  endpoint: string,
  body: Record<string, unknown>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  const res = await fetch(`/api${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    onError(`Request failed: ${res.status}`)
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') { onDone(); return }
        onChunk(data)
      }
    }
  }
  onDone()
}
