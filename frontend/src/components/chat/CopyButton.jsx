import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

export default function CopyButton({ text, label, className, size = 'icon' }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const name = label ?? t('common.copy')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('common.copyFailed'))
    }
  }
  return (
    <Button variant="ghost" size={size} className={className} onClick={copy} aria-label={name} title={name}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {size !== 'icon' && <span>{copied ? t('common.copied') : name}</span>}
    </Button>
  )
}
