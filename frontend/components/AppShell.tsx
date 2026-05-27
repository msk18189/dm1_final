'use client'

import { useState } from 'react'
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
  ChevronLeft,
  LogOut,
  Star,
  Calendar,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/auth'

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

interface SyncStatus {
  sync_status: 'IDLE' | 'PENDING' | 'VERIFYING' | 'SYNCING' | 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'RATE_LIMITED'
  sync_progress: string | null
  sync_duration: number | null
  initial_sync_completed: boolean
  last_synced_at: string | null
  last_successful_sync: string | null
  error_message: string | null
  total_prs: number
  total_issues: number
  total_branches: number
  total_forks: number
  total_workflow_runs: number
  total_discussions: number
  total_projects: number
  rate_limit_remaining: number | null
  rate_limit_limit: number | null
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
  syncStatus?: SyncStatus | null
  onSync?: () => void
  isSyncing?: boolean
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
  syncStatus,
  onSync,
  isSyncing,
}: AppShellProps) {
  const router = useRouter()
  const [isCollapsed, setIsCollapsed] = useState(false)

  const handleSignOut = () => {
    signOut()
    router.replace('/login')
  }

  const NAV: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4 shrink-0" />, requiresData: true },
    {
      id: 'pull_requests', label: 'Pull Requests', icon: <GitPullRequest className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_prs,
    },
    {
      id: 'issues', label: 'Issues', icon: <CircleDot className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_issues,
    },
    {
      id: 'branches', label: 'Branches', icon: <GitBranch className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_branches,
    },
    {
      id: 'cicd', label: 'CI/CD', icon: <Zap className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_workflow_runs,
    },
    {
      id: 'forks', label: 'Forks', icon: <GitFork className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_forks,
    },
    {
      id: 'projects', label: 'Projects', icon: <Kanban className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_projects,
    },
    {
      id: 'discussions', label: 'Discussions', icon: <MessageCircle className="h-4 w-4 shrink-0" />,
      requiresData: true, badge: syncCounts?.total_discussions,
    },
    { id: 'repo_health', label: 'Repo Health', icon: <Heart className="h-4 w-4 shrink-0" />, requiresData: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4 shrink-0" />, requiresData: false },
  ]

  const navigate = (id: NavSection) => {
    onNavigate?.(id)
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
      <div className="landing-center relative bg-slate-50">
        {userLabel && (
          <div className="absolute top-6 right-6 flex items-center gap-2.5 z-20 bg-white border border-slate-200 px-3.5 py-2 rounded-xl shadow-sm">
            <span className="text-xs font-semibold text-slate-700">{userLabel}</span>
            <span className="h-3.5 w-px bg-slate-200"></span>
            <button
              onClick={handleSignOut}
              className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1.5 transition"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        )}
        <div className="w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="landing-hero-title mb-10 space-y-4">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-50 border border-indigo-100 shadow-sm">
              <GitBranch className="h-8 w-8 text-indigo-600" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">PRISM</h1>
            <p className="mx-auto mt-2 max-w-xl text-base text-slate-500 sm:text-lg">
              Enterprise GitHub Engineering Intelligence Platform
            </p>
          </div>
          {children}
        </div>
      </div>
    )
  }  const activeNavItem = NAV.find(n => n.id === activeSection)

  const isEmail = !!userLabel && userLabel.includes('@')
  const displayName = isEmail && userLabel ? userLabel.split('@')[0] : (userLabel || 'Arpit Gupta')
  const displayEmail = isEmail && userLabel ? userLabel : (userLabel ? `${userLabel.toLowerCase().replace(/\s+/g, '')}@example.com` : 'arpit@example.com')

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 dark:bg-slate-950 p-0 text-slate-600 dark:text-slate-350">

      {/* ── Sidebar ── */}
      <aside 
        className={`hidden shrink-0 flex-col bg-white dark:bg-[#0b0f19] border-r border-slate-200 dark:border-slate-800 p-4 text-slate-600 dark:text-slate-400 transition-all duration-300 lg:flex ${
          isCollapsed ? 'w-[76px]' : 'w-[260px]'
        }`}
      >
        {/* Logo and toggle */}
        <div className="mb-6 flex items-center justify-between px-1">
          {!isCollapsed && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm text-white">
                <GitBranch className="h-4.5 w-4.5" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-slate-950 dark:text-white">PRISM</span>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Engineering Intelligence</p>
              </div>
            </div>
          )}
          {isCollapsed && (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm text-white mx-auto">
              <GitBranch className="h-4.5 w-4.5" />
            </div>
          )}
          <button 
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hidden lg:block"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Compact Repository selector */}
        {repoLabel && !isCollapsed && (
          <div className="mb-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/80 px-3 py-2 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Workspace</p>
              <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200" title={repoLabel}>{repoLabel}</p>
            </div>
            <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 ml-1.5 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = activeSection === item.id
            const badge = formatBadge(item.badge)
            return (
              <button
                key={item.id}
                type="button"
                id={`nav-${item.id}`}
                onClick={() => navigate(item.id)}
                className={`group flex items-center rounded-xl px-3 py-2.5 text-xs font-semibold transition-all relative ${
                  active
                    ? 'bg-orange-50 dark:bg-orange-950/20 text-[#c2410c] dark:text-orange-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/40 hover:text-slate-950 dark:hover:text-white'
                } ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                title={isCollapsed ? item.label : undefined}
              >
                <span className={active ? 'text-[#c2410c] dark:text-orange-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-350'}>
                  {item.icon}
                </span>
                {!isCollapsed && <span className="flex-1 text-left">{item.label}</span>}
                {!isCollapsed && badge && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    active 
                      ? 'bg-orange-100 dark:bg-orange-950/40 text-[#c2410c] dark:text-orange-400' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}>
                    {badge}
                  </span>
                )}
                {active && !isCollapsed && <ChevronRight className="h-3 w-3 text-[#c2410c] dark:text-orange-400 shrink-0" />}
              </button>
            )
          })}
        </nav>

        {/* Floating Sync Status Card */}
        {!isCollapsed && syncStatus && (
          <div className="mb-4 mt-4 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Sync Status</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                syncStatus.sync_status === 'COMPLETED' 
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' 
                  : 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400'
              }`}>
                {syncStatus.sync_status === 'COMPLETED' ? 'Completed' : syncStatus.sync_status}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              <div className="flex justify-between">
                <span>Last sync</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {syncStatus.last_successful_sync 
                    ? new Date(syncStatus.last_successful_sync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                    : 'Never'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Next Sync</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">In 59 minutes</span>
              </div>
            </div>
            {onSync && (
              <button
                type="button"
                onClick={onSync}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync Now
              </button>
            )}
          </div>
        )}

        {/* Sidebar Footer — User profile block */}
        <div className={`mt-auto border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'} px-1`}>
          <div className="h-8 w-8 shrink-0 rounded-full bg-[#fdf2ec] dark:bg-orange-950/20 text-[#c2410c] dark:text-orange-400 flex items-center justify-center font-bold text-xs border border-[#fce6d8] dark:border-orange-950/30">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">{displayName}</p>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate" title={displayEmail}>{displayEmail}</p>
            </div>
          )}
          {!isCollapsed && (
            <button 
              type="button" 
              onClick={handleSignOut} 
              className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition p-1"
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Panel ── */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-[#080c14]">

        {/* Sticky Top Navbar */}
        <header className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-[#0b0f19] px-5 py-3 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            {/* Repo selector and display */}
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-850 text-slate-600 dark:text-slate-400">
                <GitBranch className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{repoLabel || 'OpenBMB / MiniCPM-V'}</span>
              <button type="button" className="text-slate-300 dark:text-slate-600 hover:text-amber-500 transition">
                <Star className="h-3.5 w-3.5 fill-current" />
              </button>
            </div>

            {/* Sync Completed badge */}
            <span className="hidden rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-250 dark:border-emerald-850 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 sm:inline-block">
              Completed
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative hidden md:block w-48 lg:w-60">
              <Search className="absolute left-2.5 top-1.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search resources..."
                className="w-full pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-[#0f1422] transition"
              />
            </div>

            {/* Date Range Picker */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-450 dark:border-slate-800 shadow-sm">
              <Calendar className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Apr 26 - May 26, 2025</span>
            </div>

            {/* Bell/Notifications */}
            <button
              type="button"
              className="rounded-lg p-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-500 dark:text-slate-400 transition"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>

            {/* Header Actions */}
            {headerActions && (
              <div className="flex items-center gap-1.5">
                {headerActions}
              </div>
            )}
          </div>
        </header>

        {/* Mobile Navigation bar */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-slate-200 dark:border-slate-850 bg-white dark:bg-[#0b0f19] px-4 py-2 lg:hidden scrollbar-none">
          {NAV.map((item) => {
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                  active
                    ? 'bg-[#fdf2ec] dark:bg-orange-950/20 text-[#c2410c] dark:text-orange-400 border border-[#fce6d8] dark:border-orange-950/30'
                    : 'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  )
}
