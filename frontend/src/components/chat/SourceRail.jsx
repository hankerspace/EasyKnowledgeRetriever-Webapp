import React from 'react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Compact chips listing the (document, page) pairs cited by one block. */
export default function SourceRail({ citations, labelFor, onOpen, className }) {
  if (!citations?.length) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5 md:flex-col md:items-start', className)}>
      {citations.map((c) => (
        <button
          key={`${c.id}:${c.page}`}
          type="button"
          onClick={() => onOpen(c)}
          title="Voir le passage source"
          className="group inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-left text-[11px] leading-tight text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
        >
          <span className="flex size-4 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-[10px] font-semibold text-primary">{c.id}</span>
          <FileText className="size-3 shrink-0 opacity-60" />
          <span className="truncate">{labelFor(c.id)}</span>
          {c.page != null && <span className="shrink-0 font-medium">p. {c.page}</span>}
        </button>
      ))}
    </div>
  )
}
