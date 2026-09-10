import { useEffect, useState } from 'react'
import { getIngestStatus } from '@/lib/api'

const ACTIVE = new Set(['scanning', 'running'])

// Polls /rag/ingest/status: fast while a pass is running, slow otherwise.
export function useIngestStatus({ fast = 2000, slow = 15000 } = {}) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer
    let cancelled = false
    const run = async () => {
      try {
        const s = await getIngestStatus()
        if (cancelled) return
        setState(s)
        setError(null)
        timer = setTimeout(run, ACTIVE.has(s.status) ? fast : slow)
      } catch (e) {
        if (cancelled) return
        setError(e)
        timer = setTimeout(run, slow)
      }
    }
    run()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [fast, slow, tick])
  return { status: state, error, refresh: () => setTick((t) => t + 1), isActive: !!state && ACTIVE.has(state.status) }
}
