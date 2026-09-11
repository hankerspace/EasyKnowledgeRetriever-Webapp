// Retrieval strategies exposed by easy-knowledge-retriever (RetrievalFactory).
// Labels and hints are the `mode.<value>` / `mode.<value>.hint` message keys.
export const MODES = ['hybrid_mix', 'mix', 'hybrid', 'local', 'global', 'naive', 'bypass']

export const RESPONSE_TYPES = ['Multiple Paragraphs', 'Single Paragraph', 'Bullet Points']

export const DEFAULT_SETTINGS = {
  mode: 'hybrid_mix',
  top_k: 10,
  chunk_top_k: null,
  query_decomposition: false,
  response_type: 'Multiple Paragraphs',
}

const KEY = 'ekr.retrieval.v4'

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved && MODES.includes(saved.mode)) return { ...DEFAULT_SETTINGS, ...saved }
  } catch { /* corrupt or unavailable storage */ }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}
