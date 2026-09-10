import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function CopyButton({ text, label = 'Copier', className, size = 'icon' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Impossible de copier')
    }
  }
  return (
    <Button variant="ghost" size={size} className={className} onClick={copy} aria-label={label} title={label}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {size !== 'icon' && <span>{copied ? 'Copié' : label}</span>}
    </Button>
  )
}
