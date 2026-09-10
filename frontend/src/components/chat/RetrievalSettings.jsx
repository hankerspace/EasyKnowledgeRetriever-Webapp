import React from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MODES, RESPONSE_TYPES, DEFAULT_SETTINGS, modeLabel } from '@/lib/retrieval'

const RESPONSE_LABELS = { 'Multiple Paragraphs': 'Plusieurs paragraphes', 'Single Paragraph': 'Un paragraphe', 'Bullet Points': 'Liste à puces' }

/** Retrieval strategy and tuning, sent with every query. */
export default function RetrievalSettings({ value, onChange, disabled }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const mode = MODES.find((m) => m.value === value.mode)
  const noRetrieval = value.mode === 'bypass'
  const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS)
  const num = (v, fallback) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : fallback }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label="Réglages de recherche" className="h-8 shrink-0 gap-1.5 rounded-xl px-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-4" />
              <span className="hidden sm:inline">{modeLabel(value.mode)}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Mode de recherche et réglages</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" className="w-80 space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Réglages de recherche</h3>
          <p className="text-xs text-muted-foreground">Appliqués à la prochaine question et mémorisés dans ce navigateur.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rs-mode">Mode de retrieval</Label>
          <Select value={value.mode} onValueChange={(mode) => set({ mode })}>
            <SelectTrigger id="rs-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  <span className="font-medium">{m.label}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{m.value}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mode && <p className="text-xs text-muted-foreground">{mode.hint}</p>}
        </div>

        <div className={noRetrieval ? 'pointer-events-none opacity-50' : ''}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rs-topk">Top K</Label>
              <Input id="rs-topk" type="number" min={1} max={200} value={value.top_k} onChange={(e) => set({ top_k: num(e.target.value, value.top_k) })} />
              <p className="text-[11px] leading-tight text-muted-foreground">Entités, relations ou extraits retenus.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-chunks">Extraits (chunk top K)</Label>
              <Input id="rs-chunks" type="number" min={1} max={200} placeholder="défaut" value={value.chunk_top_k ?? ''} onChange={(e) => set({ chunk_top_k: e.target.value === '' ? null : num(e.target.value, value.chunk_top_k) })} />
              <p className="text-[11px] leading-tight text-muted-foreground">Extraits gardés après reranking. Vide : défaut de la librairie.</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="rs-decomp">Décomposition de la question</Label>
              <p className="text-[11px] text-muted-foreground">Découpe les questions complexes en sous-requêtes.</p>
            </div>
            <Switch id="rs-decomp" checked={value.query_decomposition} onCheckedChange={(query_decomposition) => set({ query_decomposition })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rs-resp">Forme de la réponse</Label>
          <Select value={value.response_type} onValueChange={(response_type) => set({ response_type })}>
            <SelectTrigger id="rs-resp"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESPONSE_TYPES.map((r) => <SelectItem key={r} value={r}>{RESPONSE_LABELS[r] || r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Button type="button" variant="ghost" size="sm" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_SETTINGS })} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
          <RotateCcw className="size-3.5" /> Rétablir les valeurs par défaut
        </Button>
      </PopoverContent>
    </Popover>
  )
}
