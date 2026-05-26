'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

import AppShell, { NavSection } from '@/components/AppShell'
import RepositoryInput from '@/components/RepositoryInput'
import RepositoryStatusPanel from '@/components/RepositoryStatusPanel'
import KPICard from '@/components/KPICard'
import DataTable from '@/components/DataTable'
import DashboardFilters, { DashboardFiltersState } from '@/components/DashboardFilters'
import PRRiskPanel from '@/components/PRRiskPanel'
import StalePRAlerts from '@/components/StalePRAlerts'
import ExportButton from '@/components/ExportButton'

// Module panels — all lazy-loaded for performance
const IssuesPanel = dynamic(() => import('@/components/modules/IssuesPanel'), { ssr: false })
const BranchesPanel = dynamic(() => import('@/components/modules/BranchesPanel'), { ssr: false })
const CICDPanel = dynamic(() => import('@/components/modules/CICDPanel'), { ssr: false })
const ForksPanel = dynamic(() => import('@/components/modules/ForksPanel'), { ssr: false })
const ProjectsPanel = dynamic(() => import('@/components/modules/ProjectsPanel'), { ssr: false })
const DiscussionsPanel = dynamic(() => import('@/components/modules/DiscussionsPanel'), { ssr: false })
const RepoHealthPanel = dynamic(() => import('@/components/modules/RepoHealthPanel'), { ssr: false })
const SettingsPanel = dynamic(() => import('@/components/modules/SettingsPanel'), { ssr: false })

// Charts
const MergeRateDonut = dynamic(() => import('@/components/MergeRateDonut'), { ssr: false })
const MonthlyFlowChart = dynamic(() => import('@/components/Charts').then(m => m.MonthlyFlowChart), { ssr: false })
const ThroughputChart = dynamic(() => import('@/components/Charts').then(m => m.ThroughputChart), { ssr: false })
const ContributorChart = dynamic(() => import('@/components/Charts').then(m => m.ContributorChart), { ssr: false })
const ReviewTurnaroundChart = dynamic(() => import('@/components/Charts').then(m => m.ReviewTurnaroundChart), { ssr: false })

import {
  analyzeRepository, formatApiError,
  getKPI, getOldestPRs, getSlowestPRs, getContributorActivity,
  getMonthlyFlow, getThroughput, getAuthors, getPRRisk, getStaleAlerts,
  getSyncStatus,
} from '@/lib/api'
import { formatDurationDisplay, formatDurationFromDays, formatTelemetry } from '@/lib/format'
import { loadGithubToken, saveGithubToken } from '@/lib/tokenStorage'
import { getAuthUser, signOut, isAuthenticated } from '@/lib/auth'
import {
  AlertCircle, FolderGit2, Clock, Timer, Eye, MessageSquare,
  GitMerge, AlertOctagon, RefreshCw, Zap, Loader2,
} from 'lucide-react'

// ─── Constants ──────────────────────────────────────────────────────────────

const SYNC_POLL_MS = 3000
const SYNC_MAX_POLLS = 120     // 120 × 3s = 6 min max before timeout
const SYNC_COMPLETE_STATUSES = ['COMPLETED', 'FAILED', 'PARTIAL', 'RATE_LIMITED']

const defaultFilters: DashboardFiltersState = {
  days: null, author: 'all', state: 'ALL',
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncStatusData {
  sync_status: 'IDLE' | 'PENDING' | 'VERIFYING' | 'SYNCING' | 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'RATE_LIMITED'
  sync_mode?: 'full' | 'lightweight' | 'partial'
  sync_progress: string | null
  sync_duration: number | null
  sync_started_at?: string | null
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
  rate_limit_reset: string | null
  expected_prs?: number
  expected_issues?: number
  expected_forks?: number
  expected_workflows?: number
  synced_prs?: number
  synced_issues?: number
  synced_forks?: number
  synced_workflows?: number
}

function renderDuration(dur: { value: string | number; unit: string }): string {
  if (typeof dur.value === 'string' && ['Limited', 'Unavailable', 'Partial', 'none'].includes(dur.value)) {
    return dur.value;
  }
  return `${dur.value} ${dur.unit}`.trim()
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  // Auth + Token
  const [githubToken, setGithubToken] = useState<string>(() => loadGithubToken())
  const [userLabel, setUserLabel] = useState<string | undefined>()

  // Repo state
  const [repoId, setRepoId] = useState<number | null>(null)
  const [repoLabel, setRepoLabel] = useState<string>('')
  const [activeSection, setActiveSection] = useState<NavSection>('overview')

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // PR dashboard state (preserved from original)
  const [filters, setFilters] = useState<DashboardFiltersState>(defaultFilters)
  const [authors, setAuthors] = useState<string[]>([])
  const [kpi, setKpi] = useState<any>(null)
  const [oldestPRs, setOldestPRs] = useState<any>(null)
  const [slowestPRs, setSlowestPRs] = useState<any>(null)
  const [contributors, setContributors] = useState<any>(null)
  const [monthlyFlow, setMonthlyFlow] = useState<any[]>([])
  const [throughput, setThroughput] = useState<any[]>([])
  const [prRisk, setPRRisk] = useState<any>(null)
  const [staleAlerts, setStaleAlerts] = useState<any>(null)
  const [loadingPR, setLoadingPR] = useState(false)
  const [prError, setPRError] = useState<string | null>(null)

  // PR table pagination
  const [oldestPage, setOldestPage] = useState(1)
  const [slowestPage, setSlowestPage] = useState(1)
  const [contributorsPage, setContributorsPage] = useState(1)
  const [prRiskPage, setPRRiskPage] = useState(1)
  const [staleAlertsPage, setStaleAlertsPage] = useState(1)

  // App state
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load auth user
  useEffect(() => {
    const loadUser = async () => {
      try {
        const u = await getAuthUser()
        if (u) {
          setUserLabel(u.username)
        }
      } catch (err) {
        console.error("Auth load failed", err)
      }
    }
    loadUser()
  }, [])

  // ─── Sync polling ──────────────────────────────────────────────────────────

  const pollCountRef = useRef<number>(0)

  const startPolling = useCallback((id: number) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollCountRef.current = 0
    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1
      try {
        const status = await getSyncStatus(id)
        setSyncStatus(status as SyncStatusData)
        if (SYNC_COMPLETE_STATUSES.includes(status.sync_status)) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsSyncing(false)
          // Load data for all terminal states except FAILED
          if (status.sync_status !== 'FAILED') {
            loadPRData(id, defaultFilters)
          }
        }
        // Timeout: stop polling after max polls
        if (pollCountRef.current >= SYNC_MAX_POLLS) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsSyncing(false)
          // Load whatever data is available
          loadPRData(id, defaultFilters)
        }
      } catch (_) {}
    }, SYNC_POLL_MS)
  }, [])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // ─── PR Data Loading ───────────────────────────────────────────────────────

  const loadPRData = useCallback(async (id: number, f: DashboardFiltersState) => {
    if (!id) return
    setLoadingPR(true)
    setPRError(null)
    try {
      const [kpiData, auths, monthFlow, tp] = await Promise.all([
        getKPI(id, f), getAuthors(id), getMonthlyFlow(id, 6, f), getThroughput(id, 8, f),
      ])
      setKpi(kpiData)
      setAuthors(auths || [])
      setMonthlyFlow(Array.isArray(monthFlow) ? monthFlow : [])
      setThroughput(Array.isArray(tp) ? tp : [])
    } catch (err) {
      setPRError(formatApiError(err))
    } finally {
      setLoadingPR(false)
    }
  }, [])

  // Hydration and state restoration on mount
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }

    const savedRepoId = localStorage.getItem('prism_repo_id')
    const savedRepoLabel = localStorage.getItem('prism_repo_label')
    const savedActiveSection = localStorage.getItem('prism_active_section')

    if (savedRepoId) {
      const id = parseInt(savedRepoId, 10)
      if (!isNaN(id)) {
        setRepoId(id)
        if (savedRepoLabel) setRepoLabel(savedRepoLabel)
        if (savedActiveSection) setActiveSection(savedActiveSection as NavSection)

        const restoreRepo = async () => {
          try {
            const status = await getSyncStatus(id)
            setSyncStatus(status as SyncStatusData)
            const st = status.sync_status
            if (st === 'SYNCING' || st === 'PENDING' || st === 'VERIFYING') {
              setIsSyncing(true)
              startPolling(id)
            } else if (st === 'COMPLETED' || st === 'PARTIAL' || st === 'RATE_LIMITED') {
              loadPRData(id, defaultFilters)
            }
            // FAILED: just show the status panel, no data to load
          } catch (err) {
            console.error("Failed to restore repo sync status", err)
            // Repo may have been deleted — clear stale state
            localStorage.removeItem('prism_repo_id')
            localStorage.removeItem('prism_repo_label')
            localStorage.removeItem('prism_active_section')
            localStorage.removeItem('prism_dashboard_route')
            setRepoId(null)
            setRepoLabel('')
            router.replace('/analyze')
          } finally {
            setIsHydrated(true)
          }
        }
        restoreRepo()
      } else {
        router.replace('/analyze')
        setIsHydrated(true)
      }
    } else {
      router.replace('/analyze')
      setIsHydrated(true)
    }
  }, [router, startPolling, loadPRData])

  // Save state to localStorage when values change (only after hydration)
  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return
    if (repoId !== null) {
      localStorage.setItem('prism_repo_id', String(repoId))
      localStorage.setItem('prism_dashboard_route', '/dashboard')
    } else {
      localStorage.removeItem('prism_repo_id')
      localStorage.removeItem('prism_dashboard_route')
    }
  }, [repoId, isHydrated])

  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return
    if (repoLabel) {
      localStorage.setItem('prism_repo_label', repoLabel)
    } else {
      localStorage.removeItem('prism_repo_label')
    }
  }, [repoLabel, isHydrated])

  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return
    if (activeSection) {
      localStorage.setItem('prism_active_section', activeSection)
    }
  }, [activeSection, isHydrated])

  // Handle "New Analysis" navigation to reset repo selection
  useEffect(() => {
    if (activeSection === 'analyze') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('prism_repo_id')
        localStorage.removeItem('prism_repo_label')
        localStorage.removeItem('prism_active_section')
        localStorage.removeItem('prism_dashboard_route')
      }
      setRepoId(null)
      setRepoLabel('')
      router.push('/analyze')
    }
  }, [activeSection, router])

  const loadTableData = useCallback(async (
    id: number, f: DashboardFiltersState,
    oPg = oldestPage, sPg = slowestPage, cPg = contributorsPage,
    rPg = prRiskPage, stPg = staleAlertsPage
  ) => {
    if (!id) return
    try {
      const [oldest, slowest, contrib, risk, stale] = await Promise.all([
        getOldestPRs(id, oPg, 10, f), getSlowestPRs(id, sPg, 10, f),
        getContributorActivity(id, cPg, 10, f), getPRRisk(id, rPg, 15),
        getStaleAlerts(id, stPg, 10),
      ])
      setOldestPRs(oldest); setSlowestPRs(slowest); setContributors(contrib)
      setPRRisk(risk); setStaleAlerts(stale)
    } catch (err) {
      console.error('Table data error:', err)
    }
  }, [oldestPage, slowestPage, contributorsPage, prRiskPage, staleAlertsPage])

  useEffect(() => {
    if (repoId && activeSection === 'pull_requests') {
      loadTableData(repoId, filters)
    }
  }, [repoId, activeSection, oldestPage, slowestPage, contributorsPage, prRiskPage, staleAlertsPage])

  // ─── Initial repo load + filter change ────────────────────────────────────

  useEffect(() => {
    if (repoId) {
      loadPRData(repoId, filters)
      if (activeSection === 'pull_requests') {
        loadTableData(repoId, filters)
      }
    }
  }, [filters, repoId])

  useEffect(() => {
    if (kpi) {
      console.log(`[Telemetry][Frontend] Rendered total PRs: ${kpi.total_prs}`)
    }
  }, [kpi])

  useEffect(() => {
    if (monthlyFlow && monthlyFlow.length > 0) {
      console.log(`[Telemetry][Frontend] Rendered monthly flow points: ${monthlyFlow.length}`)
    }
  }, [monthlyFlow])

  useEffect(() => {
    if (throughput && throughput.length > 0) {
      console.log(`[Telemetry][Frontend] Rendered weekly throughput points: ${throughput.length}`)
    }
  }, [throughput])

  // ─── Repository submission ─────────────────────────────────────────────────

  const handleAnalyze = useCallback(async (url: string, token?: string) => {
    setGlobalError(null)
    setIsSyncing(true)
    try {
      const result = await analyzeRepository(url, token || githubToken || undefined)
      const newRepoId: number = result.repo_id ?? result.id
      setRepoId(newRepoId)
      setRepoLabel(result.owner && result.repo ? `${result.owner}/${result.repo}` : url)
      setFilters(defaultFilters)
      setActiveSection('overview')

      // Start polling sync status
      const initialStatus = await getSyncStatus(newRepoId)
      setSyncStatus(initialStatus as SyncStatusData)
      startPolling(newRepoId)
    } catch (err) {
      setIsSyncing(false)
      setGlobalError(formatApiError(err))
    }
  }, [githubToken, startPolling])

  const handleSync = useCallback(async () => {
    if (!repoId || !repoLabel) return
    setIsSyncing(true)
    const url = `https://github.com/${repoLabel}`
    await handleAnalyze(url, githubToken)
  }, [repoId, repoLabel, githubToken, handleAnalyze])

  const handleTokenSave = (t: string) => {
    saveGithubToken(t)
    setGithubToken(t)
  }

  // ─── Sync counts for sidebar badges ───────────────────────────────────────

  const syncCounts = syncStatus ? {
    total_prs: syncStatus.total_prs,
    total_issues: syncStatus.total_issues,
    total_branches: syncStatus.total_branches,
    total_forks: syncStatus.total_forks,
    total_workflow_runs: syncStatus.total_workflow_runs,
    total_discussions: syncStatus.total_discussions,
    total_projects: syncStatus.total_projects,
  } : undefined

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-warm-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-palette-orange" />
          <p className="text-xs font-bold uppercase tracking-wider text-warm-400">Loading PRISM...</p>
        </div>
      </div>
    )
  }

  const hasData = !!(repoId && (
    syncStatus?.initial_sync_completed ||
    syncStatus?.sync_status === 'PARTIAL' ||
    syncStatus?.sync_status === 'RATE_LIMITED'
  ))

  return (
    <AppShell
      hasData={hasData || !!(repoId)}
      repoLabel={repoLabel}
      activeSection={activeSection}
      onNavigate={setActiveSection}
      userLabel={userLabel}
      syncCounts={syncCounts}
      headerActions={
        repoId ? (
          <ExportButton repoId={repoId} filters={filters} />
        ) : undefined
      }
    >
      {/* ── Repository Input (landing only) ── */}
      {!repoId && (
        <div className="space-y-6">
          {globalError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Error:</span>
                <span>{typeof globalError === 'string' ? globalError : String(globalError)}</span>
              </div>
            </div>
          )}
          <RepositoryInput
            githubToken={githubToken}
            onGithubTokenChange={handleTokenSave}
            onAnalyze={handleAnalyze}
            isLoading={isSyncing}
            variant="hero"
          />
        </div>
      )}

      {/* ── Dashboard ── */}
      {repoId && (
        <div className="space-y-6">

          {/* Repository Status Panel (always visible) */}
          {syncStatus && (
            <RepositoryStatusPanel
              repoLabel={repoLabel}
              syncStatus={syncStatus}
              onSync={handleSync}
              isSyncing={isSyncing}
            />
          )}

          {/* VERIFYING banner */}
          {syncStatus?.sync_status === 'VERIFYING' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>Verifying repository access and fetching metadata...</span>
              </div>
            </motion.div>
          )}

          {/* Syncing banner */}
          {isSyncing && syncStatus?.sync_status === 'SYNCING' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-800 text-sm">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>{syncStatus?.sync_progress || 'Ingesting repository data...'}</span>
              </div>
            </motion.div>
          )}

          {/* PARTIAL completion banner */}
          {syncStatus?.sync_status === 'PARTIAL' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Sync completed with partial data. Some modules were skipped. Add a GitHub PAT for full analysis.</span>
              </div>
            </motion.div>
          )}

          {/* RATE_LIMITED banner */}
          {syncStatus?.sync_status === 'RATE_LIMITED' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>GitHub rate limit reached. Dashboard shows available data. Add a PAT for full analysis.</span>
              </div>
            </motion.div>
          )}

          {/* FAILED banner */}
          {syncStatus?.sync_status === 'FAILED' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Sync failed: {syncStatus?.error_message || 'Unknown error'}. You can retry.</span>
              </div>
            </motion.div>
          )}

          {/* ── MODULE DISPATCHER ── */}

          {/* OVERVIEW */}
          {activeSection === 'overview' && (
            <OverviewSection
              kpi={kpi} monthlyFlow={monthlyFlow} throughput={throughput}
              syncStatus={syncStatus} repoLabel={repoLabel}
              onNavigate={setActiveSection}
            />
          )}

          {/* PULL REQUESTS */}
          {activeSection === 'pull_requests' && (
            <PullRequestsSection
              repoId={repoId} kpi={kpi} filters={filters} authors={authors}
              onFiltersChange={setFilters} loading={loadingPR} error={prError}
              oldestPRs={oldestPRs} slowestPRs={slowestPRs} contributors={contributors}
              monthlyFlow={monthlyFlow} throughput={throughput}
              prRisk={prRisk} staleAlerts={staleAlerts}
              oldestPage={oldestPage} onOldestPage={setOldestPage}
              slowestPage={slowestPage} onSlowestPage={setSlowestPage}
              contributorsPage={contributorsPage} onContributorsPage={setContributorsPage}
              prRiskPage={prRiskPage} onPRRiskPage={setPRRiskPage}
              staleAlertsPage={staleAlertsPage} onStaleAlertsPage={setStaleAlertsPage}
              syncStatus={syncStatus}
            />
          )}

          {/* ISSUES */}
          {activeSection === 'issues' && <IssuesPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* BRANCHES */}
          {activeSection === 'branches' && <BranchesPanel repoId={repoId} />}

          {/* CI/CD */}
          {activeSection === 'cicd' && <CICDPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* FORKS */}
          {activeSection === 'forks' && <ForksPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* PROJECTS */}
          {activeSection === 'projects' && <ProjectsPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* DISCUSSIONS */}
          {activeSection === 'discussions' && <DiscussionsPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* REPO HEALTH */}
          {activeSection === 'repo_health' && <RepoHealthPanel repoId={repoId} repoLabel={repoLabel} />}

          {/* SETTINGS */}
          {activeSection === 'settings' && (
            <SettingsPanel repoLabel={repoLabel} onTokenChange={handleTokenSave} />
          )}
        </div>
      )}
    </AppShell>
  )
}

// ─── Overview Section ─────────────────────────────────────────────────────────

function OverviewSection({ kpi, monthlyFlow, throughput, syncStatus, repoLabel, onNavigate }: any) {
  const cards = [
    { label: 'Total PRs', value: syncStatus ? formatTelemetry(syncStatus.synced_prs || syncStatus.total_prs, syncStatus.expected_prs) : (kpi?.total_prs ? formatTelemetry(kpi.total_prs, 0) : '—'), icon: <FolderGit2 />, color: 'from-indigo-500 to-violet-600', onClick: () => onNavigate('pull_requests') },
    { label: 'Merge Rate', value: kpi ? `${kpi.merge_rate ?? 0}%` : '—', icon: <GitMerge />, color: 'from-emerald-500 to-teal-600', onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Cycle Time', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time)) : '—', icon: <Clock />, color: 'from-amber-500 to-orange-600', onClick: () => onNavigate('pull_requests') },
    { label: 'Total Issues', value: syncStatus ? formatTelemetry(syncStatus.synced_issues || syncStatus.total_issues, syncStatus.expected_issues) : '—', icon: <AlertCircle />, color: 'from-rose-500 to-pink-600', onClick: () => onNavigate('issues') },
    { label: 'Branches', value: syncStatus?.total_branches?.toLocaleString() ?? '—', icon: <Timer />, color: 'from-sky-500 to-cyan-600', onClick: () => onNavigate('branches') },
    { label: 'CI/CD Runs', value: syncStatus ? formatTelemetry(syncStatus.synced_workflows || syncStatus.total_workflow_runs, syncStatus.expected_workflows) : '—', icon: <Zap />, color: 'from-violet-500 to-purple-600', onClick: () => onNavigate('cicd') },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <motion.button key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            onClick={c.onClick}
            className="rounded-2xl border border-warm-200 bg-white p-5 flex flex-col gap-3 text-left hover:bg-warm-50 transition-all shadow-sm group">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${c.color} text-white group-hover:scale-105 transition-transform`}>
              {c.icon}
            </div>
            <div>
              <p className="text-xl font-bold text-primary">{c.value}</p>
              <p className="text-xs text-secondary mt-0.5">{c.label}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {(monthlyFlow?.length > 0 || throughput?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {monthlyFlow?.length > 0 && (
            <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-primary mb-4">Monthly PR Flow</h3>
              <MonthlyFlowChart data={monthlyFlow} />
            </div>
          )}
          {throughput?.length > 0 && (
            <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-primary mb-4">Weekly Throughput</h3>
              <ThroughputChart data={throughput} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Pull Requests Section (preserved from original) ─────────────────────────

function PullRequestsSection({
  repoId, kpi, filters, authors, onFiltersChange, loading, error,
  oldestPRs, slowestPRs, contributors, monthlyFlow, throughput,
  prRisk, staleAlerts,
  oldestPage, onOldestPage, slowestPage, onSlowestPage,
  contributorsPage, onContributorsPage, prRiskPage, onPRRiskPage,
  staleAlertsPage, onStaleAlertsPage,
  syncStatus,
}: any) {
  const [localFilters, setLocalFilters] = useState(filters)

  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  return (
    <div className="space-y-6">
      <DashboardFilters
        filters={localFilters}
        authors={authors}
        onChange={setLocalFilters}
        onApply={() => onFiltersChange(localFilters)}
      />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
          {typeof error === 'string' ? error : String(error)}
        </div>
      )}

      {/* KPI Cards */}
      {kpi && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard icon={<FolderGit2 />} title="Total PRs" value={syncStatus ? formatTelemetry(syncStatus.synced_prs || syncStatus.total_prs, syncStatus.expected_prs) : (kpi.total_prs ? formatTelemetry(kpi.total_prs, 0) : '—')} accent="teal" />
          <KPICard icon={<GitMerge />} title="Merge Rate" value={`${kpi.merge_rate ?? 0}%`} accent="emerald" />
          <KPICard icon={<Clock />} title="Avg Cycle Time" value={formatDurationFromDays(kpi.avg_cycle_time).value} unit={formatDurationFromDays(kpi.avg_cycle_time).unit} accent="amber" />
          <KPICard icon={<Eye />} title="Avg Review Wait" value={formatDurationDisplay(kpi.avg_review_wait).value} unit={formatDurationDisplay(kpi.avg_review_wait).unit} accent="lime" />
          <KPICard icon={<MessageSquare />} title="Avg Review Duration" value={formatDurationDisplay(kpi.avg_review_duration).value} unit={formatDurationDisplay(kpi.avg_review_duration).unit} accent="orange" />
          <KPICard icon={<AlertOctagon />} title="Stale PRs" value={(kpi.stale_prs ?? 0).toLocaleString()} accent="rose" />
        </div>
      )}

      {/* Charts */}
      {(monthlyFlow?.length > 0 || throughput?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {monthlyFlow?.length > 0 && (
            <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-primary mb-4">Monthly PR Flow</h3>
              <MonthlyFlowChart data={monthlyFlow} />
            </div>
          )}
          {kpi && (
            <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-primary mb-4">Merge Rate</h3>
              <MergeRateDonut mergeRate={kpi.merge_rate ?? 0} openPrs={kpi.open_prs ?? 0} stalePrs={kpi.stale_prs ?? 0} />
            </div>
          )}
        </div>
      )}

      {throughput?.length > 0 && (
        <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-primary mb-4">Weekly Throughput</h3>
          <ThroughputChart data={throughput} />
        </div>
      )}

      {/* PR Intelligence Tables */}
      {prRisk && (
        <PRRiskPanel data={prRisk} page={prRiskPage} onPageChange={onPRRiskPage} />
      )}
      {staleAlerts && (
        <StalePRAlerts data={staleAlerts} page={staleAlertsPage} onPageChange={onStaleAlertsPage} />
      )}
      {oldestPRs && (
        <DataTable
          title="Oldest Open PRs"
          icon={<Clock className="h-4 w-4" />}
          columns={['PR', 'Title', 'Author', 'Age', 'Reviews']}
          data={oldestPRs?.data ?? []}
          page={oldestPage} pages={oldestPRs?.pages ?? 1}
          onPageChange={onOldestPage}
          renderRow={(row: any) => (
            <>
              <td className="py-2.5 pr-4 font-mono text-muted text-xs">#{row.pr_number}</td>
              <td className="py-2.5 pr-4 text-primary text-xs max-w-[220px] truncate">{row.title}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{row.author}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{row.age_days}d</td>
              <td className="py-2.5 text-secondary text-xs">{row.review_count}</td>
            </>
          )}
        />
      )}
      {slowestPRs && (
        <DataTable
          title="Slowest Merged PRs"
          icon={<Timer className="h-4 w-4" />}
          columns={['PR', 'Title', 'Author', 'Cycle Time', 'Reviews']}
          data={slowestPRs?.data ?? []}
          page={slowestPage} pages={slowestPRs?.pages ?? 1}
          onPageChange={onSlowestPage}
          renderRow={(row: any) => (
            <>
              <td className="py-2.5 pr-4 font-mono text-muted text-xs">#{row.pr_number}</td>
              <td className="py-2.5 pr-4 text-primary text-xs max-w-[220px] truncate">{row.title}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{row.author}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{renderDuration(formatDurationFromDays(row.cycle_time_days))}</td>
              <td className="py-2.5 text-secondary text-xs">{row.review_count}</td>
            </>
          )}
        />
      )}
      {contributors && (
        <DataTable
          title="Contributor Activity"
          icon={<Eye className="h-4 w-4" />}
          columns={['Author', 'PRs', 'Merged', 'Avg Cycle Time', 'Avg Review Wait']}
          data={contributors?.data ?? []}
          page={contributorsPage} pages={contributors?.pages ?? 1}
          onPageChange={onContributorsPage}
          renderRow={(row: any) => (
            <>
              <td className="py-2.5 pr-4 text-primary text-xs font-semibold">{row.username}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{row.total_prs}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{row.merged_prs}</td>
              <td className="py-2.5 pr-4 text-secondary text-xs">{renderDuration(formatDurationFromDays(row.avg_cycle_time))}</td>
              <td className="py-2.5 text-secondary text-xs">{renderDuration(formatDurationDisplay(row.avg_review_time))}</td>
            </>
          )}
        />
      )}
    </div>
  )
}
