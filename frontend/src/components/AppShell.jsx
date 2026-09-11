import React from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { MessageSquareText, FolderOpen, Waypoints, Sun, Moon, Loader2, CircleCheck, CircleAlert, ShieldCheck, ExternalLink, Languages } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, SidebarRail,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIngestStatus } from '@/hooks/use-ingest-status'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// label / title are message keys (lib/messages.js)
const NAV = [
  { to: '/admin/chat', label: 'nav.assistant', icon: MessageSquareText, title: 'nav.assistantTitle' },
  { to: '/admin/documents', label: 'nav.documents', icon: FolderOpen, title: 'nav.documentsTitle' },
  { to: '/admin/graph', label: 'nav.graph', icon: Waypoints, title: 'nav.graphTitle' },
]

export const APP_TITLE = window.env?.APP_TITLE || 'EasyRAG'
export const APP_SUBTITLE = window.env?.APP_SUBTITLE || 'Knowledge Retriever'

function IngestPill() {
  const { t } = useI18n()
  const { status, isActive } = useIngestStatus()
  if (!status) return null
  const done = status.ingested + (status.existing || 0)
  const pct = status.total ? Math.round((done / status.total) * 100) : 0
  if (isActive) {
    return (
      <Link to="/admin/documents">
        <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground hover:bg-accent">
          <Loader2 className="size-3 animate-spin text-primary" />
          {t('ingest.pillRunning', { done, total: status.total, pct })}
        </Badge>
      </Link>
    )
  }
  if (status.status === 'failed' || status.failed > 0) {
    return (
      <Link to="/admin/documents">
        <Badge variant="outline" className="gap-1.5 font-normal text-destructive hover:bg-accent">
          <CircleAlert className="size-3" /> {t('ingest.pillFailed', { count: status.failed })}
        </Badge>
      </Link>
    )
  }
  if (status.status === 'completed') {
    return (
      <Link to="/admin/documents">
        <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground hover:bg-accent">
          <CircleCheck className="size-3 text-success" /> {t('ingest.pillDocs', { count: done })}
        </Badge>
      </Link>
    )
  }
  return null
}

export function ThemeToggle() {
  const { t } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme.toggle')} onClick={() => setTheme(dark ? 'light' : 'dark')}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t(dark ? 'theme.light' : 'theme.dark')}</TooltipContent>
    </Tooltip>
  )
}

// ponytail: two languages, so a toggle; turn it into a menu when a third one lands.
export function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('lang.switch')} onClick={() => setLang(lang === 'en' ? 'fr' : 'en')} className="h-9 gap-1.5 px-2 text-xs font-medium">
          <Languages className="size-4" />
          {lang.toUpperCase()}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('lang.switch')}</TooltipContent>
    </Tooltip>
  )
}

export default function AppShell() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const current = NAV.find((n) => pathname.startsWith(n.to)) || NAV[0]
  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild>
                  <Link to="/admin/chat">
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <ShieldCheck className="size-4" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{APP_TITLE}</span>
                      <span className="truncate text-xs text-muted-foreground">{t('shell.admin')}</span>
                    </div>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{t('nav.group')}</SidebarGroupLabel>
              <SidebarMenu>
                {NAV.map(({ to, label, icon: Icon }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton asChild isActive={pathname.startsWith(to)} tooltip={t(label)}>
                      <Link to={to}><Icon /><span>{t(label)}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={t('nav.userView')}>
                  <Link to="/"><ExternalLink /><span>{t('nav.userView')}</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <h1 className="text-sm font-medium">{t(current.title)}</h1>
            <div className="ml-auto flex items-center gap-1">
              <IngestPill />
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </header>
          <main className={cn('flex min-h-0 flex-1 flex-col overflow-hidden')}>
            <Outlet />
          </main>
        </SidebarInset>
        <Toaster position="top-right" richColors closeButton />
      </SidebarProvider>
    </TooltipProvider>
  )
}
