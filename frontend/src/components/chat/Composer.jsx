import React, { useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export default function Composer({ onSend, onStop, busy, disabled, placeholder, leading }) {
  const [value, setValue] = useState('')

  const submit = () => {
    const q = value.trim()
    if (!q || busy || disabled) return
    onSend(q)
    setValue('')
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit() }}
      className={cn(
        'relative flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-shadow',
        'focus-within:ring-2 focus-within:ring-ring/40',
        disabled && 'opacity-60',
      )}
    >
      {leading && <div className="flex shrink-0 items-center self-end pb-0.5">{leading}</div>}
      {/* ponytail: native field-sizing grows the box with its content; older Safari keeps one scrolling row. */}
      <Textarea
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder || 'Posez votre question…'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
        }}
        className="max-h-[200px] min-h-0 resize-none border-0 bg-transparent px-2 py-2 shadow-none [field-sizing:content] focus-visible:ring-0"
      />
      {busy ? (
        <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Arrêter la génération" className="shrink-0 rounded-xl">
          <Square className="size-4 fill-current" />
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={disabled || !value.trim()} aria-label="Envoyer" className="shrink-0 rounded-xl">
          <ArrowUp className="size-4" />
        </Button>
      )}
    </form>
  )
}
