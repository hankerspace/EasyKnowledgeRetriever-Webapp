import React from 'react'
import { FileText, Quote } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/lib/i18n'
import CopyButton from './CopyButton'
import { chunksFor, fileName } from '@/lib/citations'

/** Verbatim of the chunk(s) behind one citation. `target` = {id, page} | null. */
export default function ChunkSheet({ target, chunks, labelFor, onClose }) {
  const { t } = useI18n()
  const open = !!target
  const matches = target ? chunksFor(chunks, target.id, target.page) : []
  const pages = target?.page == null ? [] : [].concat(target.page)
  const exact = pages.length > 0 && matches.some((c) => c.page_start != null)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={t('common.close')} className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex size-6 items-center justify-center rounded bg-primary/10 font-mono text-xs font-semibold text-primary">{target?.id}</span>
            <FileText className="size-4 text-muted-foreground" />
            <span className="truncate">{target ? labelFor(target.id) : ''}</span>
          </SheetTitle>
          <SheetDescription>
            {pages.length ? t('chunk.citedPages', { pages: pages.join(', '), count: pages.length }) : t('chunk.citedNoPage')}
            {' · '}
            {t('answer.excerpts', { count: matches.length })}
            {pages.length > 0 && !exact && matches.length > 0 && t('chunk.pageNotLocated')}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-5">
            {matches.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('chunk.none')}</p>
            )}
            {matches.map((c, i) => (
              <figure key={c.chunk_id || i} className="rounded-lg border bg-muted/30">
                <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                  <Quote className="size-3.5" />
                  <span className="truncate">{fileName(c.file_path)}</span>
                  {c.page_start != null && (
                    <Badge variant="secondary" className="ml-auto font-normal">
                      {c.page_end != null && c.page_end !== c.page_start ? `p. ${c.page_start}–${c.page_end}` : `p. ${c.page_start}`}
                    </Badge>
                  )}
                  <CopyButton text={c.content} className={c.page_start == null ? 'ml-auto size-7' : 'size-7'} />
                </div>
                <blockquote className="whitespace-pre-wrap p-3 text-sm leading-relaxed">{c.content}</blockquote>
              </figure>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
