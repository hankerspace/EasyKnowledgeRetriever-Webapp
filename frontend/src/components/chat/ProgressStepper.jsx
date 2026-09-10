import React, { useEffect, useState } from 'react'
import { Check, Loader2, Search, PenLine, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

function useElapsed(startedAt, endedAt) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (endedAt) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [endedAt])
  return ((endedAt || now) - startedAt) / 1000
}

function Step({ icon: Icon, state, title, detail }) {
  const StateIcon = state === 'done' ? Check : state === 'error' ? CircleAlert : Loader2
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
          state === 'active' && 'border-primary bg-primary/10 text-primary',
          state === 'done' && 'border-success/40 bg-success/10 text-success',
          state === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
          state === 'pending' && 'text-muted-foreground/60',
        )}
      >
        {state === 'pending' ? <Icon className="size-3" /> : <StateIcon className={cn('size-3', state === 'active' && 'animate-spin')} />}
      </div>
      <div className="min-w-0">
        <div className={cn('text-sm font-medium', state === 'pending' && 'text-muted-foreground')}>{title}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  )
}

/** Live view of a streamed answer: retrieval, then generation. */
export default function ProgressStepper({ msg }) {
  const elapsed = useElapsed(msg.startedAt, msg.endedAt)
  const ctx = msg.context
  const finished = msg.status !== 'streaming'
  const retrievalState = ctx ? 'done' : msg.status === 'error' ? 'error' : 'active'
  const genState = !ctx ? 'pending' : msg.status === 'error' ? 'error' : finished ? 'done' : 'active'

  const retrievalDetail = ctx
    ? `${ctx.entities} entité${ctx.entities > 1 ? 's' : ''} · ${ctx.relationships} relation${ctx.relationships > 1 ? 's' : ''} · ${ctx.chunks.length} extrait${ctx.chunks.length > 1 ? 's' : ''}${ctx.retrieval_seconds != null ? ` · ${ctx.retrieval_seconds}s` : ''}`
    : 'Analyse de la question, recherche dans le graphe et les vecteurs…'
  const genDetail = ctx
    ? `${msg.tokens} fragment${msg.tokens > 1 ? 's' : ''} reçu${msg.tokens > 1 ? 's' : ''} · ${(msg.total_seconds ?? elapsed).toFixed(1)}s`
    : null

  if (finished && msg.status === 'done') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Check className="size-3 text-success" /> Réponse générée en {(msg.total_seconds ?? elapsed).toFixed(1)}s</span>
        {ctx && <span>{ctx.chunks.length} extrait{ctx.chunks.length > 1 ? 's' : ''} · {ctx.entities} entité{ctx.entities > 1 ? 's' : ''} · {ctx.relationships} relation{ctx.relationships > 1 ? 's' : ''}</span>}
      </div>
    )
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed bg-muted/40 p-3 sm:grid-cols-2">
      <Step icon={Search} state={retrievalState} title="Recherche dans la base" detail={retrievalDetail} />
      <Step icon={PenLine} state={genState} title="Génération de la réponse" detail={genDetail} />
    </div>
  )
}
