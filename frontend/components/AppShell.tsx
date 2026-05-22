'use client'

import {
  LayoutDashboard,
  GitPullRequest,
  CircleDot,
  GitBranch,
  Zap,
  GitFork,
  Kanban,
  MessageCircle,
  Heart,
  Settings,
  Plus,
  Bell,
  ChevronRight,
} from 'lucide-react'

export type NavSection =
  | 'analyze'
  | 'overview'
  | 'pull_requests'
  | 'issues'
  | 'branches'
  | 'cicd'
  | 'forks'
  | 'projects'
  | 'discussions'
  | 'repo_health'
  | 'settings'

interface NavItem {
  id: NavSection
  label: string
  icon: React.ReactNode
  requiresData?: boolean
  badge?: number | string | null
}

interface AppShellProps {
  children: React.ReactNode
  hasData: boolean
  repoLabel?: string
  headerActions?: React.ReactNode
  userLabel?: string
  activeSection?: NavSection
  onNavigate?: (section: NavSection) => void
  syncCounts?: {
    total_prs?: number
    total_issues?: number
    total_branches?: number
    total_forks?: number
    total_workflow_runs?: number
    total_discussions?: number
    total_projects?: number
  }
}

export default function AppShell({
  children,
  hasData,
  repoLabel,
  headerActions,
  userLabel,
  activeSection = 'analyze',
  onNavigate,
  syncCounts,
}: AppShellProps) {

  const NAV: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" />, requiresData: true },
    {
      id: 'pull_requests', label: 'Pull Requests', icon: <GitPullRequest className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_prs,
    },
    {
      id: 'issues', label: 'Issues', icon: <CircleDot className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_issues,
    },
    {
      id: 'branches', label: 'Branches', icon: <GitBranch className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_branches,
    },
    {
      id: 'cicd', label: 'CI / CD', icon: <Zap className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_workflow_runs,
    },
    {
      id: 'forks', label: 'Forks', icon: <GitFork className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_forks,
    },
    {
      id: 'projects', label: 'Projects', icon: <Kanban className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_projects,
    },
    {
      id: 'discussions', label: 'Discussions', icon: <MessageCircle className="h-4 w-4" />,
      requiresData: true, badge: syncCounts?.total_discussions,
    },
    { id: 'repo_health', label: 'Repo Health', icon: <Heart className="h-4 w-4" />, requiresData: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, requiresData: false },
  ]

  const navigate = (id: NavSection) => {
    onNavigate?.(id)
    // For non-scroll-based navigation, just update state
    const el = document.getElementById(`section-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const formatBadge = (n?: number | string | null): string | null => {
    if (!n) return null
    const num = typeof n === 'string' ? parseInt(n) : n
    if (isNaN(num) || num === 0) return null
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
    return String(num)
  }

  /* Landing — no sidebar */
  if (!hasData) {
    return (
      <div className="landing-center">
        <div className="w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="landing-hero-title mb-10 space-y-4">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-palette-emerald-light shadow-sm">
              <GitBranch className="h-8 w-8 text-palette-emerald" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-midnight-50 sm:text-5xl">PRISM</h1>
            <p className="mx-auto mt-2 max-w-xl text-base text-midnight-400 sm:text-lg">
              Enterprise GitHub Engineering Intelligence Platform
            </p>
          </div>
          {children}
        </div>
      </div>
    )
  }

  const activeNavItem = NAV.find(n => n.id === activeSection)

  return (
    <div className="flex min-h-screen bg-warm-50 p-3 sm:p-4">

      {/* ── Sidebar ── */}
      <aside className="hidden w-[240px] shrink-0 flex-col rounded-shell bg-warm-900 p-4 text-white/90 shadow-shell lg:flex">

        {/* Logo */}
        <div className="mb-6 flex items-center gap-2.5 px-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg">
            <GitBranch className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-white">PRISM</span>
            <p className="text-[9px] font-medium uppercase tracking-widest text-white/40">Intelligence</p>
          </div>
        </div>

        {/* Repo badge */}
        {repoLabel && (
          <div className="mb-4 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/40 mb-0.5">Repository</p>
            <p className="truncate text-sm font-semibold text-white">{repoLabel}</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = activeSection === item.id
            const badge = formatBadge(item.badge)
            return (
              <button
                key={item.id}
                type="button"
                id={`nav-${item.id}`}
                onClick={() => navigate(item.id)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-white/[0.12] text-white shadow-sm'
                    : 'text-white/55 hover:bg-white/[0.07] hover:text-white/90'
                }`}
              >
                <span className={active ? 'text-indigo-300' : 'text-white/40 group-hover:text-white/70'}>
                  {item.icon}
                </span>
                <span className="flex-1 text-left">{item.label}</span>
                {badge && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    active ? 'bg-indigo-500/40 text-indigo-200' : 'bg-white/[0.08] text-white/40'
                  }`}>
                    {badge}
                  </span>
                )}
                {active && <ChevronRight className="h-3 w-3 text-indigo-400 shrink-0" />}
              </button>
            )
          })}
        </nav>

        {/* New Analysis button */}
        <button
          type="button"
          onClick={() => navigate('analyze')}
          className="mt-4 flex items-center gap-2.5 rounded-xl border border-dashed border-white/20 bg-white/[0.04] px-3 py-3 text-left transition hover:border-indigo-500/50 hover:bg-white/[0.08]"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600/80">
            <Plus className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold text-white/80">New Analysis</p>
            <p className="text-[10px] text-white/35">Analyze another repo</p>
          </div>
        </button>
      </aside>

      {/* ── Main Panel ── */}
      <div className="flex min-h-[calc(100vh-2rem)] min-w-0 flex-1 flex-col overflow-hidden rounded-shell bg-warm-100 shadow-shell">

        {/* Header */}
        <header className="flex flex-wrap items-center gap-4 border-b border-warm-200/80 bg-white/60 px-5 py-3.5 backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-midnight-50">
              {activeNavItem?.label ?? 'PRISM'}
            </h2>
            {repoLabel && (
              <span className="hidden rounded-full bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 sm:inline-block">
                {repoLabel}
              </span>
            )}
          </div>
          {userLabel && (
            <div className="ml-2 hidden items-center rounded-xl border border-warm-200 bg-warm-50 px-3 py-1.5 text-xs text-midnight-500 sm:flex">
              <span className="font-semibold text-midnight-700">{userLabel}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl p-2 text-midnight-400 transition hover:bg-warm-100 hover:text-midnight-200"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
            {headerActions}
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-warm-200/80 bg-white/40 px-4 py-2 lg:hidden">
          {NAV.map((item) => {
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-warm-200/60 text-midnight-300 hover:bg-warm-200'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </nav>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}
