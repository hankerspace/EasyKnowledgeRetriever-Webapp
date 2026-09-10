// Retrieval strategies exposed by easy-knowledge-retriever (RetrievalFactory).
export const MODES = [
  { value: 'hybrid_mix', label: 'Hybride fusionnée', hint: 'Vecteurs + BM25 + graphe, fusion RRF. Le plus complet.' },
  { value: 'mix', label: 'Mixte', hint: 'Graphe de connaissances + recherche vectorielle.' },
  { value: 'hybrid', label: 'Hybride graphe', hint: 'Entités (local) + relations (global), sans vecteurs.' },
  { value: 'local', label: 'Local', hint: 'Entités proches de la question et leurs extraits.' },
  { value: 'global', label: 'Global', hint: 'Relations et thèmes transversaux du corpus.' },
  { value: 'naive', label: 'Naïf', hint: 'Recherche vectorielle simple sur les extraits.' },
  { value: 'bypass', label: 'Sans retrieval', hint: 'LLM seul, sans consulter les documents.' },
]

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
    if (saved && MODES.some((m) => m.value === saved.mode)) return { ...DEFAULT_SETTINGS, ...saved }
  } catch { /* corrupt or unavailable storage */ }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export const modeLabel = (value) => MODES.find((m) => m.value === value)?.label || value
