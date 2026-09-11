import React, { useEffect, useState } from 'react'
import { Check, Loader2, Search, PenLine, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

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
export default function ProgressStepper({ msg, admin = false }) {
  const { t } = useI18n()
  const elapsed = useElapsed(msg.startedAt, msg.endedAt)
  const ctx = msg.context
  const finished = msg.status !== 'streaming'
  const retrievalState = ctx ? 'done' : msg.status === 'error' ? 'error' : 'active'
  const genState = !ctx ? 'pending' : msg.status === 'error' ? 'error' : finished ? 'done' : 'active'

  const n = ctx ? ctx.chunks.length : 0
  const seconds = (msg.total_seconds ?? elapsed).toFixed(1)
  const modeTag = admin && msg.settings ? `${t(`mode.${msg.settings.mode}`)} · top k ${msg.settings.top_k}` : null
  const excerpts = t('answer.excerpts', { count: n })
  const entities = ctx ? t('progress.entities', { count: ctx.entities ?? 0 }) : ''
  const relations = ctx ? t('progress.relations', { count: ctx.relationships ?? 0 }) : ''
  const retrievalDetail = !admin
    ? (ctx ? t('progress.passagesFound', { count: n }) : t('progress.searching'))
    : ctx
      ? `${entities} · ${relations} · ${excerpts}${ctx.retrieval_seconds != null ? ` · ${ctx.retrieval_seconds}s` : ''}`
      : t('progress.analysing', { mode: modeTag ? ` (${modeTag})` : '' })
  const genDetail = !admin
    ? (ctx ? t('progress.writing') : null)
    : ctx
      ? `${t('progress.fragments', { count: msg.tokens })} · ${seconds}s`
      : null

  if (finished && msg.status === 'done') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Check className="size-3 text-success" /> {t('progress.generatedIn', { seconds })}</span>
        {ctx && (admin
          ? <span>{excerpts} · {entities} · {relations}</span>
          : <span>{t('progress.passagesRead', { count: n })}</span>)}
        {modeTag && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{modeTag}</span>}
      </div>
    )
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed bg-muted/40 p-3 sm:grid-cols-2">
      <Step icon={Search} state={retrievalState} title={t('progress.retrieval')} detail={retrievalDetail} />
      <Step icon={PenLine} state={genState} title={t('progress.generation')} detail={genDetail} />
    </div>
  )
}
