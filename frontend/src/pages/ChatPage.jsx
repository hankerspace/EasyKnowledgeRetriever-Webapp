import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CircleAlert, Loader2, Sparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getHealth, streamQuery } from '@/lib/api'
import { useIngestStatus } from '@/hooks/use-ingest-status'
import Composer from '@/components/chat/Composer'
import AnswerCard from '@/components/chat/AnswerCard'

const SUGGESTIONS = [
  'Quels sont les points clés abordés dans les documents ?',
  'Résume les obligations principales décrites dans la base.',
  'Quelles définitions importantes sont données ?',
]

let nextId = 1

export default function ChatPage() {
  const [messages, setMessages] = useState([])
  const [health, setHealth] = useState(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)
  const bottomRef = useRef(null)
  const { status: ingest, isActive: ingesting } = useIngestStatus()

  useEffect(() => {
    let timer
    const check = async () => {
      try { setHealth(await getHealth()) } catch { setHealth({ rag_initialized: false, startup_error: 'API injoignable' }) }
      timer = setTimeout(check, health?.rag_initialized ? 60000 : 5000)
    }
    check()
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.rag_initialized])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  const patch = (id, fn) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)))

  const send = async (query) => {
    const history = messages
      .filter((m) => m.role === 'user' || m.status === 'done')
      .map((m) => ({ role: m.role, content: m.content }))
    const id = nextId++
    setMessages((ms) => [
      ...ms,
      { id: id - 0.5, role: 'user', content: query },
      { id, role: 'assistant', content: '', status: 'streaming', tokens: 0, startedAt: Date.now(), context: null },
    ])
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await streamQuery({ query, conversation_history: history.length ? history : null }, {
        status: (d) => patch(id, () => ({ stage: d.stage })),
        context: (d) => patch(id, () => ({ context: d })),
        token: (d) => patch(id, (m) => ({ content: m.content + d.text, tokens: m.tokens + 1 })),
        done: (d) => patch(id, () => ({
          content: d.content, status: 'done', endedAt: Date.now(), total_seconds: d.total_seconds,
          details: { system_prompt: d.system_prompt, user_prompt: d.user_prompt, metadata: d.metadata },
        })),
        error: (d) => { patch(id, () => ({ status: 'error', error: d.message, endedAt: Date.now() })); toast.error('La requête a échoué') },
      }, ctrl.signal)
      patch(id, (m) => (m.status === 'streaming' ? { status: m.content ? 'done' : 'error', error: 'Flux interrompu sans réponse', endedAt: Date.now() } : {}))
    } catch (e) {
      if (e.name === 'AbortError') patch(id, () => ({ status: 'aborted', endedAt: Date.now() }))
      else { patch(id, () => ({ status: 'error', error: e.message, endedAt: Date.now() })); toast.error(e.message) }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const ready = health?.rag_initialized === true

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
          {health && !ready && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>Le moteur RAG n'est pas prêt</AlertTitle>
              <AlertDescription className="break-words">{health.startup_error || 'Initialisation en cours…'}</AlertDescription>
            </Alert>
          )}
          {ready && ingesting && (
            <Alert>
              <Loader2 className="size-4 animate-spin" />
              <AlertTitle>Ingestion en cours ({ingest.ingested}/{ingest.total})</AlertTitle>
              <AlertDescription>Les réponses peuvent être incomplètes tant que tous les documents ne sont pas indexés.</AlertDescription>
            </Alert>
          )}

          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-6 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-7" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight">Interrogez vos documents</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  Chaque passage de la réponse est relié au document et à la page qui l'étayent. Cliquez sur une source pour lire l'extrait original.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="h-auto whitespace-normal rounded-full py-1.5 text-xs font-normal" disabled={!ready} onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">{m.content}</div>
              </div>
            ) : (
              <AnswerCard key={m.id} msg={m} />
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="border-t bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 sm:px-6">
          <Composer onSend={send} onStop={() => abortRef.current?.abort()} busy={busy} disabled={!ready} placeholder={ready ? 'Posez votre question… (Entrée pour envoyer, Maj+Entrée pour un retour à la ligne)' : 'En attente du moteur RAG…'} />
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Les réponses sont générées à partir de vos documents et citent leurs sources. Vérifiez les passages importants.</p>
        </div>
      </div>
    </div>
  )
}
