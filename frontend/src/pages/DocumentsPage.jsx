import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CircleAlert, CircleCheck, Clock, FileText, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIngestStatus } from '@/hooks/use-ingest-status'
import { useI18n } from '@/lib/i18n'
import { getDocuments, triggerIngest } from '@/lib/api'
import { fileName } from '@/lib/citations'

// Labels are `pass.<state>` / `doc.<status>` message keys; unknown values are shown as sent by the API.
const PASS_STATES = new Set(['idle', 'scanning', 'running', 'completed', 'failed'])

const DOC_STATUS = {
  processed: { variant: 'default', icon: CircleCheck, cls: 'bg-success/15 text-success hover:bg-success/15 border-transparent' },
  preprocessed: { variant: 'secondary', icon: Clock, cls: '' },
  processing: { variant: 'secondary', icon: Loader2, cls: 'text-primary', spin: true },
  pending: { variant: 'outline', icon: Clock, cls: '' },
  failed: { variant: 'destructive', icon: CircleAlert, cls: '' },
}

function DocStatusBadge({ status }) {
  const { t } = useI18n()
  const known = DOC_STATUS[status]
  const { variant, icon: Icon, cls, spin } = known || { variant: 'outline', icon: Clock, cls: '' }
  return (
    <Badge variant={variant} className={`gap-1 font-normal ${cls}`}>
      <Icon className={`size-3 ${spin ? 'animate-spin' : ''}`} /> {known ? t(`doc.${status}`) : status || '?'}
    </Badge>
  )
}

const fmtDate = (s, lang) => (s ? new Date(s).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }) : '—')
const fmtChars = (n, t, lang) => {
  if (n == null) return '—'
  return n >= 1000 ? t('docs.charsK', { n: (n / 1000).toLocaleString(lang, { maximumFractionDigits: 0 }) }) : t('docs.chars', { n })
}

export default function DocumentsPage() {
  const { t, lang } = useI18n()
  const { status, isActive, refresh } = useIngestStatus({ fast: 2000, slow: 10000 })
  const [docs, setDocs] = useState(null)
  const [starting, setStarting] = useState(false)

  const loadDocs = useCallback(async () => {
    try { setDocs(await getDocuments()) } catch { /* keep the last list */ }
  }, [])
  useEffect(() => { loadDocs() }, [loadDocs, status])

  const relaunch = async () => {
    setStarting(true)
    try {
      await triggerIngest()
      toast.success(t('docs.relaunched'))
      refresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message)
    } finally { setStarting(false) }
  }

  const done = (status?.ingested || 0) + (status?.existing || 0)
  const pct = status?.total ? Math.round((done / status.total) * 100) : 0
  const passState = status?.status
  const PassIcon = isActive ? Loader2 : passState === 'failed' ? CircleAlert : passState === 'completed' ? CircleCheck : Clock

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <PassIcon className={`size-4 ${isActive ? 'animate-spin text-primary' : passState === 'failed' ? 'text-destructive' : passState === 'completed' ? 'text-success' : 'text-muted-foreground'}`} />
                {t('docs.ingestTitle')}
                {status && <Badge variant={passState === 'failed' ? 'destructive' : 'secondary'} className="font-normal">{PASS_STATES.has(passState) ? t(`pass.${passState}`) : passState}</Badge>}
              </CardTitle>
              <CardDescription>{t('docs.ingestHint')}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={relaunch} disabled={isActive || starting || !status}>
              <RefreshCw className={`size-3.5 ${starting ? 'animate-spin' : ''}`} /> {t('docs.relaunch')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!status ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('docs.filesIngested', { ingested: status.ingested, count: status.total })}
                      {status.existing > 0 && <span>{t('docs.alreadyIndexed', { count: status.existing })}</span>}
                      {status.failed > 0 && <span className="text-destructive">{t('docs.failedCount', { count: status.failed })}</span>}
                    </span>
                    <span className="font-medium tabular-nums">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  {status.current_file && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin text-primary" /> {t('docs.current')} <span className="truncate font-medium text-foreground">{fileName(status.current_file)}</span>
                    </p>
                  )}
                  {status.message && !status.current_file && <p className="text-xs text-muted-foreground">{status.message}</p>}
                </div>
                {status.preflight_error && (
                  <Alert variant="destructive">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>{t('docs.pdfUnavailable')}</AlertTitle>
                    <AlertDescription className="break-words">{status.preflight_error}</AlertDescription>
                  </Alert>
                )}
                {status.skipped?.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('docs.skipped', { list: status.skipped.join(', ') })}</p>
                )}
                {status.errors?.length > 0 && (
                  <Alert variant="destructive">
                    <CircleAlert className="size-4" />
                    <AlertTitle>{t('docs.filesFailed', { count: status.errors.length })}</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 space-y-1 text-xs">
                        {status.errors.map((e, i) => (
                          <li key={i} className="break-words"><span className="font-medium">{fileName(e.file)}</span> — {e.error}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="size-4 text-muted-foreground" /> {t('docs.indexedTitle')}</CardTitle>
              <CardDescription>{docs ? t('docs.known', { count: docs.total }) : t('common.loading')}{docs?.message ? ` · ${docs.message}` : ''}</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={loadDocs} aria-label={t('common.refresh')}><RefreshCw className="size-4" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            {!docs ? (
              <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : docs.documents.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">{t('docs.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('docs.colFile')}</TableHead>
                      <TableHead>{t('docs.colStatus')}</TableHead>
                      <TableHead className="text-right">{t('docs.colExcerpts')}</TableHead>
                      <TableHead className="text-right">{t('docs.colSize')}</TableHead>
                      <TableHead className="text-right">{t('docs.colUpdated')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="max-w-[28rem]">
                          <Tooltip>
                            <TooltipTrigger asChild><span className="block truncate font-medium">{fileName(d.file_path)}</span></TooltipTrigger>
                            <TooltipContent className="max-w-md break-all">{d.file_path}</TooltipContent>
                          </Tooltip>
                          {d.error_msg && <span className="block truncate text-xs text-destructive" title={d.error_msg}>{d.error_msg}</span>}
                        </TableCell>
                        <TableCell><DocStatusBadge status={d.status} /></TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{d.chunks_count ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{fmtChars(d.content_length, t, lang)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-muted-foreground">{fmtDate(d.updated_at, lang)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
