import React from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MODES, RESPONSE_TYPES, DEFAULT_SETTINGS } from '@/lib/retrieval'
import { useI18n } from '@/lib/i18n'

/** Retrieval strategy and tuning, sent with every query. */
export default function RetrievalSettings({ value, onChange, disabled }) {
  const { t } = useI18n()
  const set = (patch) => onChange({ ...value, ...patch })
  const knownMode = MODES.includes(value.mode)
  const noRetrieval = value.mode === 'bypass'
  const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS)
  const num = (v, fallback) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : fallback }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={t('settings.title')} className="h-8 shrink-0 gap-1.5 rounded-xl px-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-4" />
              <span className="hidden sm:inline">{knownMode ? t(`mode.${value.mode}`) : value.mode}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('settings.tooltip')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" className="w-80 space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t('settings.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings.hint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rs-mode">{t('settings.mode')}</Label>
          <Select value={value.mode} onValueChange={(mode) => set({ mode })}>
            <SelectTrigger id="rs-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  <span className="font-medium">{t(`mode.${m}`)}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{m}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {knownMode && <p className="text-xs text-muted-foreground">{t(`mode.${value.mode}.hint`)}</p>}
        </div>

        <div className={noRetrieval ? 'pointer-events-none opacity-50' : ''}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rs-topk">{t('settings.topK')}</Label>
              <Input id="rs-topk" type="number" min={1} max={200} value={value.top_k} onChange={(e) => set({ top_k: num(e.target.value, value.top_k) })} />
              <p className="text-[11px] leading-tight text-muted-foreground">{t('settings.topKHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-chunks">{t('settings.chunkTopK')}</Label>
              <Input id="rs-chunks" type="number" min={1} max={200} placeholder={t('settings.default')} value={value.chunk_top_k ?? ''} onChange={(e) => set({ chunk_top_k: e.target.value === '' ? null : num(e.target.value, value.chunk_top_k) })} />
              <p className="text-[11px] leading-tight text-muted-foreground">{t('settings.chunkTopKHint')}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="rs-decomp">{t('settings.decomposition')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('settings.decompositionHint')}</p>
            </div>
            <Switch id="rs-decomp" checked={value.query_decomposition} onCheckedChange={(query_decomposition) => set({ query_decomposition })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rs-resp">{t('settings.responseType')}</Label>
          <Select value={value.response_type} onValueChange={(response_type) => set({ response_type })}>
            <SelectTrigger id="rs-resp"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESPONSE_TYPES.map((r) => <SelectItem key={r} value={r}>{t(`response.${r}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Button type="button" variant="ghost" size="sm" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_SETTINGS })} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
          <RotateCcw className="size-3.5" /> {t('settings.reset')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
