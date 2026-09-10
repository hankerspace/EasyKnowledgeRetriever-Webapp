import axios from 'axios'

// Same origin in production (nginx), Vite proxy in dev.
const api = axios.create({ baseURL: '/', headers: { 'Content-Type': 'application/json' } })
export default api

export const getHealth = () => api.get('/health').then((r) => r.data)
export const getIngestStatus = () => api.get('/rag/ingest/status').then((r) => r.data)
export const getDocuments = () => api.get('/rag/documents').then((r) => r.data)
export const triggerIngest = () => api.post('/rag/ingest').then((r) => r.data)

/**
 * POST /query/stream and dispatch each SSE event to `on[event](data)`.
 * Resolves when the stream ends; rejects on HTTP errors (before any event).
 */
export async function streamQuery(body, on, signal) {
  const res = await fetch('/query/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { detail = (await res.json()).detail || detail } catch { /* not json */ }
    throw new Error(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const dispatch = (raw) => {
    let event = 'message'
    const dataLines = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return
    let data = dataLines.join('\n')
    try { data = JSON.parse(data) } catch { /* keep string */ }
    on[event]?.(data)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      dispatch(buf.slice(0, idx))
      buf = buf.slice(idx + 2)
    }
  }
  if (buf.trim()) dispatch(buf)
}
