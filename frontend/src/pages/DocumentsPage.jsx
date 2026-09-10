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
import { getDocuments, triggerIngest } from '@/lib/api'
import { fileName } from '@/lib/citations'

const PASS_LABEL = { idle: 'Inactif', scanning: 'Analyse du dossier', running: 'En cours', completed: 'Terminée', failed: 'Échec' }

const DOC_STATUS = {
  processed: { label: 'Indexé', variant: 'default', icon: CircleCheck, cls: 'bg-success/15 text-success hover:bg-success/15 border-transparent' },
  preprocessed: { label: 'Prétraité', variant: 'secondary', icon: Clock, cls: '' },
  processing: { label: 'En cours', variant: 'secondary', icon: Loader2, cls: 'text-primary', spin: true },
  pending: { label: 'En attente', variant: 'outline', icon: Clock, cls: '' },
  failed: { label: 'Échec', variant: 'destructive', icon: CircleAlert, cls: '' },
}

function DocStatusBadge({ status }) {
  const s = DOC_STATUS[status] || { label: status || '?', variant: 'outline', icon: Clock, cls: '' }
  const Icon = s.icon
  return (
    <Badge variant={s.variant} className={`gap-1 font-normal ${s.cls}`}>
      <Icon className={`size-3 ${s.spin ? 'animate-spin' : ''}`} /> {s.label}
    </Badge>
  )
}

const fmtDate = (s) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const fmtChars = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k car.` : `${n} car.`)

export default function DocumentsPage() {
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
      toast.success('Ingestion relancée')
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
                Ingestion du dossier source
                {status && <Badge variant={passState === 'failed' ? 'destructive' : 'secondary'} className="font-normal">{PASS_LABEL[passState] || passState}</Badge>}
              </CardTitle>
              <CardDescription>Analyse (parsing), découpage en extraits, extraction d'entités et indexation de chaque fichier.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={relaunch} disabled={isActive || starting || !status}>
              <RefreshCw className={`size-3.5 ${starting ? 'animate-spin' : ''}`} /> Relancer l'ingestion
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
                      {status.ingested}/{status.total} fichier{status.total > 1 ? 's' : ''} ingéré{status.ingested > 1 ? 's' : ''}
                      {status.existing > 0 && <span> · {status.existing} déjà indexé{status.existing > 1 ? 's' : ''}</span>}
                      {status.failed > 0 && <span className="text-destructive"> · {status.failed} en échec</span>}
                    </span>
                    <span className="font-medium tabular-nums">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  {status.current_file && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin text-primary" /> En cours : <span className="truncate font-medium text-foreground">{fileName(status.current_file)}</span>
                    </p>
                  )}
                  {status.message && !status.current_file && <p className="text-xs text-muted-foreground">{status.message}</p>}
                </div>
                {status.preflight_error && (
                  <Alert variant="destructive">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>Chaîne PDF indisponible</AlertTitle>
                    <AlertDescription className="break-words">{status.preflight_error}</AlertDescription>
                  </Alert>
                )}
                {status.skipped?.length > 0 && (
                  <p className="text-xs text-muted-foreground">Extensions ignorées (non supportées) : {status.skipped.join(', ')}</p>
                )}
                {status.errors?.length > 0 && (
                  <Alert variant="destructive">
                    <CircleAlert className="size-4" />
                    <AlertTitle>{status.errors.length} fichier{status.errors.length > 1 ? 's' : ''} en échec</AlertTitle>
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
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="size-4 text-muted-foreground" /> Documents indexés</CardTitle>
              <CardDescription>{docs ? `${docs.total} document${docs.total > 1 ? 's' : ''} connu${docs.total > 1 ? 's' : ''} de la base` : 'Chargement…'}{docs?.message ? ` · ${docs.message}` : ''}</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={loadDocs} aria-label="Rafraîchir"><RefreshCw className="size-4" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            {!docs ? (
              <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : docs.documents.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Aucun document pour l'instant. Déposez des fichiers dans le dossier source puis relancez l'ingestion.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fichier</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Extraits</TableHead>
                      <TableHead className="text-right">Taille</TableHead>
                      <TableHead className="text-right">Mis à jour</TableHead>
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
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{fmtChars(d.content_length)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-muted-foreground">{fmtDate(d.updated_at)}</TableCell>
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
