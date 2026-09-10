import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, CircleAlert, Sparkles, BookOpen } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { splitReferences, splitBlocks, linkifyCitations, normalizeAnswer, fileName } from '@/lib/citations'
import ProgressStepper from './ProgressStepper'
import SourceRail from './SourceRail'
import ChunkSheet from './ChunkSheet'
import CopyButton from './CopyButton'

function Block({ text, citations, labelFor, onCite, streaming, knownIds }) {
  const components = useMemo(
    () => ({
      a: ({ href, children, ...props }) => {
        if (href?.startsWith('#cite?')) {
          const p = new URLSearchParams(href.slice(6))
          const pages = (p.get('pages') || '').split(',').filter(Boolean).map(Number)
          return (
            <button
              type="button"
              onClick={() => onCite({ id: p.get('id'), page: pages.length ? pages : null })}
              title={`Source ${p.get('id')}${pages.length ? `, page${pages.length > 1 ? 's' : ''} ${pages.join(', ')}` : ''}`}
              className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded border border-primary/30 bg-primary/10 px-1 align-middle font-mono text-[10px] font-semibold leading-none text-primary no-underline transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              {children}
            </button>
          )
        }
        return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
      },
    }),
    [onCite],
  )
  const linked = useMemo(() => linkifyCitations(text, knownIds), [text, knownIds])
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-4">
      <div className={cn('prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-pre:my-2', streaming && 'last:after:ml-0.5 last:after:inline-block last:after:h-3.5 last:after:w-0.5 last:after:animate-blink last:after:bg-primary last:after:align-middle')}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{linked}</ReactMarkdown>
      </div>
      <SourceRail citations={citations} labelFor={labelFor} onOpen={onCite} className="md:border-l md:pl-3" />
    </div>
  )
}

export default function AnswerCard({ msg }) {
  const [cite, setCite] = useState(null)
  const [openDetails, setOpenDetails] = useState(false)
  const streaming = msg.status === 'streaming'
  const chunks = msg.context?.chunks || []
  const ctxRefs = msg.context?.references || []

  // Ids the model may legitimately cite: from the retrieved context, else from its own reference list.
  const knownIds = useMemo(() => {
    const ids = new Set(ctxRefs.map((r) => String(r.reference_id)))
    if (ids.size) return ids
    const { references } = splitReferences(normalizeAnswer(msg.content))
    return references.length ? new Set(references.map((r) => r.id)) : undefined
  }, [ctxRefs, msg.content])

  const { body, references, blocks } = useMemo(() => {
    const { body, references } = splitReferences(normalizeAnswer(msg.content))
    return { body, references, blocks: splitBlocks(body, knownIds) }
  }, [msg.content, knownIds])

  const labelFor = useMemo(() => {
    const byId = new Map()
    ctxRefs.forEach((r) => byId.set(String(r.reference_id), fileName(r.file_path)))
    references.forEach((r) => { if (!byId.has(r.id)) byId.set(r.id, r.title) })
    return (id) => byId.get(String(id)) || `Source ${id}`
  }, [ctxRefs, references])

  const usedIds = useMemo(() => {
    const ids = new Set(references.map((r) => r.id))
    blocks.forEach((b) => b.citations.forEach((c) => ids.add(c.id)))
    return [...ids].sort((a, b) => Number(a) - Number(b))
  }, [blocks, references])

  const pagesFor = (id) => {
    const pages = new Set()
    blocks.forEach((b) => b.citations.forEach((c) => { if (c.id === id && c.page != null) pages.add(c.page) }))
    return [...pages].sort((a, b) => a - b)
  }

  return (
    <div className="flex gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-3.5" />
      </div>
      <Card className="min-w-0 flex-1 space-y-4 p-4 shadow-sm sm:p-5">
        <ProgressStepper msg={msg} />

        {msg.status === 'error' && (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>La génération a échoué</AlertTitle>
            <AlertDescription className="break-words">{msg.error}</AlertDescription>
          </Alert>
        )}

        {blocks.length > 0 && (
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <Block key={i} text={b.text} citations={b.citations} labelFor={labelFor} onCite={setCite} knownIds={knownIds} streaming={streaming && i === blocks.length - 1} />
            ))}
          </div>
        )}
        {streaming && blocks.length === 0 && msg.context && (
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        )}
        {msg.status === 'aborted' && <p className="text-xs italic text-muted-foreground">Génération interrompue.</p>}

        {(usedIds.length > 0 || (!streaming && msg.status !== 'error')) && (
          <div className="space-y-3 border-t pt-3">
            {usedIds.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><BookOpen className="size-3.5" /> Sources</div>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {usedIds.map((id) => {
                    const n = chunks.filter((c) => String(c.reference_id) === id).length
                    const pages = pagesFor(id)
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => setCite({ id, page: null })}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent"
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-[10px] font-semibold text-primary">{id}</span>
                          <span className="min-w-0 flex-1 truncate">{labelFor(id)}</span>
                          {pages.length > 0 && <span className="shrink-0 text-muted-foreground">p. {pages.join(', ')}</span>}
                          {n > 0 && <Badge variant="secondary" className="shrink-0 font-normal">{n} extrait{n > 1 ? 's' : ''}</Badge>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {!streaming && (
              <div className="flex flex-wrap items-center gap-1">
                <CopyButton text={body} label="Copier la réponse" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" />
                {msg.details && (
                  <Collapsible open={openDetails} onOpenChange={setOpenDetails} className="w-full">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
                        <ChevronDown className={cn('size-3.5 transition-transform', openDetails && 'rotate-180')} /> Détails techniques
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-3 overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
                      {[['Prompt système', msg.details.system_prompt], ['Prompt utilisateur', msg.details.user_prompt]].map(([t, v]) => v && (
                        <div key={t} className="space-y-1">
                          <div className="text-xs font-medium">{t}</div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{v}</pre>
                        </div>
                      ))}
                      {msg.details.metadata && Object.keys(msg.details.metadata).length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Métadonnées</div>
                          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(msg.details.metadata, null, 2)}</pre>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
      <ChunkSheet target={cite} chunks={chunks} labelFor={labelFor} onClose={() => setCite(null)} />
    </div>
  )
}
