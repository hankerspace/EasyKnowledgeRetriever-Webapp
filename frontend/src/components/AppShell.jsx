import React from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { MessageSquareText, FolderOpen, Waypoints, Sun, Moon, Loader2, CircleCheck, CircleAlert, Sparkles } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/chat', label: 'Assistant', icon: MessageSquareText, title: 'Assistant' },
  { to: '/documents', label: 'Documents', icon: FolderOpen, title: 'Documents & ingestion' },
  { to: '/graph', label: 'Graphe', icon: Waypoints, title: 'Graphe de connaissances' },
]

const APP_TITLE = window.env?.APP_TITLE || 'EasyRAG'
const APP_SUBTITLE = window.env?.APP_SUBTITLE || 'Knowledge Retriever'

function IngestPill() {
  const { status, isActive } = useIngestStatus()
  if (!status) return null
  const done = status.ingested + (status.existing || 0)
  const pct = status.total ? Math.round((done / status.total) * 100) : 0
  if (isActive) {
    return (
      <Link to="/documents">
        <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground hover:bg-accent">
          <Loader2 className="size-3 animate-spin text-primary" />
          Ingestion {done}/{status.total} · {pct}%
        </Badge>
      </Link>
    )
  }
  if (status.status === 'failed' || status.failed > 0) {
    return (
      <Link to="/documents">
        <Badge variant="outline" className="gap-1.5 font-normal text-destructive hover:bg-accent">
          <CircleAlert className="size-3" /> {status.failed} échec{status.failed > 1 ? 's' : ''} d'ingestion
        </Badge>
      </Link>
    )
  }
  if (status.status === 'completed') {
    return (
      <Link to="/documents">
        <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground hover:bg-accent">
          <CircleCheck className="size-3 text-success" /> {done} document{done > 1 ? 's' : ''}
        </Badge>
      </Link>
    )
  }
  return null
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Changer de thème" onClick={() => setTheme(dark ? 'light' : 'dark')}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? 'Thème clair' : 'Thème sombre'}</TooltipContent>
    </Tooltip>
  )
}

export default function AppShell() {
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
                  <Link to="/chat">
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{APP_TITLE}</span>
                      <span className="truncate text-xs text-muted-foreground">{APP_SUBTITLE}</span>
                    </div>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarMenu>
                {NAV.map(({ to, label, icon: Icon }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton asChild isActive={pathname.startsWith(to)} tooltip={label}>
                      <Link to={to}><Icon /><span>{label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <p className="px-2 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
              Réponses générées à partir de vos documents, avec sources.
            </p>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <h1 className="text-sm font-medium">{current.title}</h1>
            <div className="ml-auto flex items-center gap-2">
              <IngestPill />
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
