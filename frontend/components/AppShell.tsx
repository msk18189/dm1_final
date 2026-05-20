'use client'

import {
  LayoutDashboard,
  Search,
  BarChart3,
  Brain,
  Table2,
  GitCompare,
  GitBranch,
  Bell,
  Plus,
} from 'lucide-react'

export type NavSection =
  | 'analyze'
  | 'overview'
  | 'insights'
  | 'charts'
  | 'tables'

interface NavItem {
  id: NavSection
  label: string
  icon: React.ReactNode
  requiresData?: boolean
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, requiresData: true },
  { id: 'insights', label: 'Insights', icon: <Brain className="h-4 w-4" />, requiresData: true },
  { id: 'charts', label: 'Charts', icon: <BarChart3 className="h-4 w-4" />, requiresData: true },
  { id: 'tables', label: 'Tables', icon: <Table2 className="h-4 w-4" />, requiresData: true },
]

interface AppShellProps {
  children: React.ReactNode
  hasData: boolean
  repoLabel?: string
  headerActions?: React.ReactNode
  activeSection?: NavSection
  onNavigate?: (section: NavSection) => void
}

export default function AppShell({
  children,
  hasData,
  repoLabel,
  headerActions,
  activeSection = 'analyze',
  onNavigate,
}: AppShellProps) {
  const scrollTo = (id: NavSection) => {
    onNavigate?.(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* Landing — centered analyze card only (no sidebar) */
  if (!hasData) {
    return (
      <div className="landing-center">
        <div className="w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="landing-hero-title mb-10 space-y-4">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-palette-emerald-light shadow-sm">
              <GitBranch className="h-8 w-8 text-palette-emerald" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-midnight-50 sm:text-5xl">PRISM</h1>
            <p className="mx-auto mt-2 max-w-xl text-base text-midnight-400 sm:text-lg">GitHub PR Intelligence</p>
          </div>
          {children}
        </div>
      </div>
    )
  }

  /* Dashboard — gig-share style: warm sidebar + rounded main panel */
  return (
    <div className="flex min-h-screen bg-warm-50 p-3 sm:p-4">
      {/* Sidebar */}
      <aside className="hidden w-[220px] shrink-0 flex-col rounded-shell bg-warm-900 p-5 text-white/90 shadow-shell lg:flex">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-palette-emerald/90">
            <GitBranch className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">prism</span>
        </div>

        {repoLabel && (
          <div className="mb-6 rounded-2xl bg-white/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Repository</p>
            <p className="truncate text-sm font-medium text-white">{repoLabel}</p>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollTo(item.id)}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-white/65 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </nav>

        <button
          type="button"
          onClick={() => scrollTo('analyze')}
          className="mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/25 bg-white/5 px-4 py-5 text-center transition hover:border-palette-emerald/50 hover:bg-white/10"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-palette-emerald/80">
            <Plus className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-medium text-white/90">New analysis</span>
          <span className="text-[10px] text-white/45">Change repository</span>
        </button>
      </aside>

      {/* Main panel */}
      <div className="flex min-h-[calc(100vh-2rem)] min-w-0 flex-1 flex-col overflow-hidden rounded-shell bg-warm-100 shadow-shell">
        <header className="flex flex-wrap items-center gap-4 border-b border-warm-200/80 bg-white/60 px-5 py-4 backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-midnight-50">Overview</h2>
            {repoLabel && (
              <span className="rounded-full bg-palette-rose-light px-2.5 py-0.5 text-xs font-semibold text-palette-rose">
                {repoLabel.split('/').pop()}
              </span>
            )}
          </div>

          <div className="mx-auto hidden max-w-md flex-1 sm:block">
            <div className="flex items-center gap-2 rounded-2xl border border-warm-200 bg-warm-50 px-4 py-2.5">
              <Search className="h-4 w-4 text-midnight-400" />
              <span className="text-sm text-midnight-400">Search metrics, PRs, authors…</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl p-2 text-midnight-400 transition hover:bg-warm-100 hover:text-midnight-200"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
            </button>
            {headerActions}
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-2 overflow-x-auto border-b border-warm-200/80 bg-white/40 px-4 py-2 lg:hidden">
          {NAV.map((item) => {
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollTo(item.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                  active
                    ? 'bg-palette-orange text-white'
                    : 'bg-warm-200/60 text-midnight-300'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </nav>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  )
}
