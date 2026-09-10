import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ThemeToggle, APP_TITLE, APP_SUBTITLE } from '@/components/AppShell'

/** End-user surface: the chat alone, no console chrome. */
export default function UserShell() {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-svh flex-col overflow-hidden bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="grid leading-tight">
            <span className="text-sm font-semibold">{APP_TITLE}</span>
            <span className="text-xs text-muted-foreground">{APP_SUBTITLE}</span>
          </div>
          <div className="ml-auto"><ThemeToggle /></div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
        <Toaster position="top-right" richColors closeButton />
      </div>
    </TooltipProvider>
  )
}
