'use client'

import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
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

// Recharts components
import {
  ComposedChart,
  Bar,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

import {
  analyzeRepository, formatApiError,
  getKPI, getOldestPRs, getSlowestPRs, getContributorActivity,
  getMonthlyFlow, getThroughput, getAuthors, getPRRisk, getStaleAlerts,
  getSyncStatus, getRepoHealth,
} from '@/lib/api'
import { formatDurationDisplay, formatDurationFromDays, formatTelemetry } from '@/lib/format'
import { loadGithubToken, saveGithubToken } from '@/lib/tokenStorage'
import { getAuthUser, signOut, isAuthenticated } from '@/lib/auth'
import {
  AlertCircle, FolderGit2, Clock, Timer, Eye, MessageSquare,
  GitMerge, AlertOctagon, RefreshCw, Zap, Loader2, Sparkles,
  CheckCircle, ArrowRight, UserCheck, Flame, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

// ─── Constants ──────────────────────────────────────────────────────────────

const SYNC_POLL_MS = 3000
const SYNC_MAX_POLLS = 120     // 120 × 3s = 6 min max before timeout
const SYNC_COMPLETE_STATUSES = ['COMPLETED', 'FAILED', 'PARTIAL', 'RATE_LIMITED']

const defaultFilters: DashboardFiltersState = {
  days: null, author: 'all', state: 'ALL',
}

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

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Auth + Token
  const [githubToken, setGithubToken] = useState<string>(() => loadGithubToken())
  const [userName, setUserName] = useState<string | undefined>()
  const [userEmail, setUserEmail] = useState<string | undefined>()

  // Repo state
  const [repoId, setRepoId] = useState<number | null>(null)
  const [repoLabel, setRepoLabel] = useState<string>('')
  const [activeSection, setActiveSection] = useState<NavSection>('overview')

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // PR dashboard state
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
  const [repoHealthScore, setRepoHealthScore] = useState<any>(null)
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
          setUserName(u.username || undefined)
          setUserEmail(u.email || undefined)
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
          if (status.sync_status !== 'FAILED') {
            loadPRData(id, defaultFilters)
          }
        }
        if (pollCountRef.current >= SYNC_MAX_POLLS) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsSyncing(false)
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
      const [kpiData, auths, monthFlow, tp, contribs, healthData] = await Promise.all([
        getKPI(id, f), 
        getAuthors(id), 
        getMonthlyFlow(id, 12, f), 
        getThroughput(id, 8, f), 
        getContributorActivity(id, 1, 10, f),
        getRepoHealth(id)
      ])
      setKpi(kpiData)
      setAuthors(auths || [])
      setMonthlyFlow(Array.isArray(monthFlow) ? monthFlow : [])
      setThroughput(Array.isArray(tp) ? tp : [])
      setContributors(contribs)
      setRepoHealthScore(healthData)
    } catch (err) {
      setPRError(formatApiError(err))
    } finally {
      setLoadingPR(false)
    }
  }, [])

  const hasRestoredRef = useRef(false)

  // Hydration and state restoration on mount
  useEffect(() => {
    if (hasRestoredRef.current) return
    
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }

    const urlRepoId = searchParams.get('repoId')
    const urlSection = searchParams.get('section')

    const savedRepoId = localStorage.getItem('prism_repo_id')
    const savedRepoLabel = localStorage.getItem('prism_repo_label')
    const savedActiveSection = localStorage.getItem('prism_active_section')

    const activeIdStr = urlRepoId || savedRepoId
    const activeSectionStr = urlSection || savedActiveSection || 'overview'

    if (activeIdStr) {
      const id = parseInt(activeIdStr, 10)
      if (!isNaN(id)) {
        const restoreRepo = async () => {
          try {
            const status = await getSyncStatus(id)
            setSyncStatus(status as SyncStatusData)
            
            setRepoId(id)
            const label = savedRepoLabel || ''
            setRepoLabel(label)
            
            const urlDays = searchParams.get('days')
            const urlAuthor = searchParams.get('author')
            const urlState = searchParams.get('state')
            const urlStart = searchParams.get('startDate')
            const urlEnd = searchParams.get('endDate')

            const newParams = new URLSearchParams()
            newParams.set('repoId', String(id))
            newParams.set('section', activeSectionStr)
            
            if (urlDays) newParams.set('days', urlDays)
            if (urlAuthor) newParams.set('author', urlAuthor)
            if (urlState) newParams.set('state', urlState)
            if (urlStart) newParams.set('startDate', urlStart)
            if (urlEnd) newParams.set('endDate', urlEnd)

            const targetUrl = `/dashboard?${newParams.toString()}`
            if (window.location.search !== `?${newParams.toString()}`) {
              router.replace(targetUrl)
            }

            localStorage.setItem('prism_repo_id', String(id))
            if (label) localStorage.setItem('prism_repo_label', label)
            localStorage.setItem('prism_active_section', activeSectionStr)

            const st = status.sync_status
            if (st === 'SYNCING' || st === 'PENDING' || st === 'VERIFYING') {
              setIsSyncing(true)
              startPolling(id)
            } else {
              const days = urlDays ? parseInt(urlDays, 10) : null
              const parsedFilters = {
                days: isNaN(days as number) ? null : days,
                author: urlAuthor || 'all',
                state: urlState || 'ALL',
                startDate: urlStart || null,
                endDate: urlEnd || null
              }
              loadPRData(id, parsedFilters)
            }
          } catch (err) {
            console.error("Failed to restore repo sync status", err)
            localStorage.removeItem('prism_repo_id')
            localStorage.removeItem('prism_repo_label')
            localStorage.removeItem('prism_active_section')
            localStorage.removeItem('prism_dashboard_route')
            setRepoId(null)
            setRepoLabel('')
            router.replace('/analyze')
          } finally {
            setIsHydrated(true)
            hasRestoredRef.current = true
          }
        }
        restoreRepo()
      } else {
        router.replace('/analyze')
        setIsHydrated(true)
        hasRestoredRef.current = true
      }
    } else {
      router.replace('/analyze')
      setIsHydrated(true)
      hasRestoredRef.current = true
    }
  }, [router, searchParams, startPolling, loadPRData])

  // Listen to URL search parameter changes
  useEffect(() => {
    if (!isHydrated) return

    const urlRepoId = searchParams.get('repoId')
    const urlSection = searchParams.get('section') as NavSection || 'overview'

    if (urlRepoId) {
      const id = parseInt(urlRepoId, 10)
      if (!isNaN(id) && id !== repoId) {
        setRepoId(id)
        
        getSyncStatus(id).then(status => {
          setSyncStatus(status as SyncStatusData)
          setRepoLabel(status.full_name || `${status.owner}/${status.name}`)
          
          if (['PENDING', 'VERIFYING', 'SYNCING'].includes(status.sync_status)) {
            setIsSyncing(true)
            startPolling(id)
          } else {
            setIsSyncing(false)
            const urlDays = searchParams.get('days')
            const urlAuthor = searchParams.get('author')
            const urlState = searchParams.get('state')
            const urlStart = searchParams.get('startDate')
            const urlEnd = searchParams.get('endDate')
            const days = urlDays ? parseInt(urlDays, 10) : null
            const parsedFilters = {
              days: isNaN(days as number) ? null : days,
              author: urlAuthor || 'all',
              state: urlState || 'ALL',
              startDate: urlStart || null,
              endDate: urlEnd || null
            }
            loadPRData(id, parsedFilters)
          }
        }).catch(err => {
          console.error("Failed to fetch repo sync status on transition", err)
        })
      }
    }
    
    if (urlSection && urlSection !== activeSection) {
      setActiveSection(urlSection)
      localStorage.setItem('prism_active_section', urlSection)
    }
  }, [searchParams, isHydrated, repoId, activeSection, loadPRData, startPolling])

  // Synchronize filters state from URL parameters
  useEffect(() => {
    if (!isHydrated) return

    const urlDays = searchParams.get('days')
    const urlAuthor = searchParams.get('author')
    const urlState = searchParams.get('state')
    const urlStart = searchParams.get('startDate')
    const urlEnd = searchParams.get('endDate')

    const days = urlDays ? parseInt(urlDays, 10) : null
    const parsedFilters: DashboardFiltersState = {
      days: isNaN(days as number) ? null : days,
      author: urlAuthor || 'all',
      state: urlState || 'ALL',
      startDate: urlStart || null,
      endDate: urlEnd || null
    }

    if (
      parsedFilters.days !== filters.days ||
      parsedFilters.author !== filters.author ||
      parsedFilters.state !== filters.state ||
      parsedFilters.startDate !== filters.startDate ||
      parsedFilters.endDate !== filters.endDate
    ) {
      setFilters(parsedFilters)
    }
  }, [searchParams, isHydrated, filters])

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

  const handleSectionChange = useCallback((section: NavSection) => {
    const params = new URLSearchParams(window.location.search)
    params.set('section', section)
    router.push(`/dashboard?${params.toString()}`)
  }, [router])

  const handleFiltersChange = useCallback((newFilters: DashboardFiltersState) => {
    const params = new URLSearchParams(window.location.search)
    if (newFilters.days !== null) {
      params.set('days', String(newFilters.days))
    } else {
      params.delete('days')
    }
    if (newFilters.author && newFilters.author !== 'all') {
      params.set('author', newFilters.author)
    } else {
      params.delete('author')
    }
    if (newFilters.state && newFilters.state !== 'ALL') {
      params.set('state', newFilters.state)
    } else {
      params.delete('state')
    }
    if (newFilters.startDate) {
      params.set('startDate', newFilters.startDate)
    } else {
      params.delete('startDate')
    }
    if (newFilters.endDate) {
      params.set('endDate', newFilters.endDate)
    } else {
      params.delete('endDate')
    }
    router.push(`/dashboard?${params.toString()}`)
  }, [router])

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

  useEffect(() => {
    if (repoId) {
      loadPRData(repoId, filters)
      if (activeSection === 'pull_requests') {
        loadTableData(repoId, filters)
      }
    }
  }, [filters, repoId])

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

      // Update URL to be in sync
      router.push(`/dashboard?repoId=${newRepoId}&section=overview`)

      const initialStatus = await getSyncStatus(newRepoId)
      setSyncStatus(initialStatus as SyncStatusData)
      startPolling(newRepoId)
    } catch (err) {
      setIsSyncing(false)
      setGlobalError(formatApiError(err))
    }
  }, [githubToken, startPolling, router])

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

  const syncCounts = syncStatus ? {
    total_prs: syncStatus.total_prs,
    total_issues: syncStatus.total_issues,
    total_branches: syncStatus.total_branches,
    total_forks: syncStatus.total_forks,
    total_workflow_runs: syncStatus.total_workflow_runs,
    total_discussions: syncStatus.total_discussions,
    total_projects: syncStatus.total_projects,
  } : undefined

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-600" />
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Loading PRISM...</p>
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
      onNavigate={handleSectionChange}
      userName={userName}
      userEmail={userEmail}
      syncCounts={syncCounts}
      syncStatus={syncStatus}
      onSync={handleSync}
      isSyncing={isSyncing}
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

          {/* VERIFYING banner */}
          {syncStatus?.sync_status === 'VERIFYING' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>Verifying repository access and fetching metadata...</span>
              </div>
            </motion.div>
          )}

          {/* Syncing banner */}
          {isSyncing && syncStatus?.sync_status === 'SYNCING' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-800 text-sm">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>{syncStatus?.sync_progress || 'Ingesting repository data...'}</span>
              </div>
            </motion.div>
          )}

          {/* PARTIAL completion banner */}
          {syncStatus?.sync_status === 'PARTIAL' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Sync completed with partial data. Some modules were skipped. Add a GitHub PAT for full analysis.</span>
              </div>
            </motion.div>
          )}

          {/* RATE_LIMITED banner */}
          {syncStatus?.sync_status === 'RATE_LIMITED' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>GitHub rate limit reached. Dashboard shows available data. Add a PAT for full analysis.</span>
              </div>
            </motion.div>
          )}

          {/* FAILED banner */}
          {syncStatus?.sync_status === 'FAILED' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
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
              kpi={kpi} 
              monthlyFlow={monthlyFlow} 
              throughput={throughput}
              syncStatus={syncStatus} 
              repoLabel={repoLabel}
              onNavigate={setActiveSection}
              repoHealth={repoHealthScore}
              contributors={contributors?.data}
            />
          )}

          {/* PULL REQUESTS */}
          {activeSection === 'pull_requests' && (
            <PullRequestsSection
              repoId={repoId} kpi={kpi} filters={filters} authors={authors}
              onFiltersChange={handleFiltersChange} loading={loadingPR} error={prError}
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

// ─── Overview Section Redesign ───────────────────────────────────────────────

function OverviewSection({ kpi, monthlyFlow, syncStatus, repoLabel, onNavigate, repoHealth, contributors }: any) {
  // SVG Radial progress calculations — use real health score, null if not loaded
  const score = repoHealth?.score ?? null
  const radius = 42
  const strokeWidth = 8
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = score !== null ? circumference - (score / 100) * circumference : circumference

  // Breakdown metrics — only render if real health data is present
  const rawPRScore = repoHealth?.components?.pull_requests ?? null
  const rawCICDScore = repoHealth?.components?.ci_cd ?? null
  const rawBranchScore = repoHealth?.components?.branches ?? null
  const rawIssueScore = repoHealth?.components?.issues ?? null
  const rawCommScore = repoHealth?.components?.community ?? null

  const healthMetrics = [
    { label: 'Code Flow', score: rawPRScore !== null ? Math.round((rawPRScore / 20) * 100) : null, color: 'bg-emerald-500' },
    { label: 'Review Health', score: rawCommScore !== null ? Math.round((rawCommScore / 10) * 100) : null, color: 'bg-amber-500' },
    { label: 'Workflow Stability', score: rawCICDScore !== null ? Math.round((rawCICDScore / 25) * 100) : null, color: 'bg-emerald-500' },
    { label: 'Stale Risk', score: rawBranchScore !== null ? Math.round((rawBranchScore / 15) * 100) : null, color: 'bg-amber-500' },
    { label: 'Contributor Balance', score: rawIssueScore !== null ? Math.round((rawIssueScore / 20) * 100) : null, color: 'bg-emerald-500' },
  ]

  // Real-data KPI Analytics strip — computed from actual kpi and repoHealth telemetry
  const realStaleCount = kpi?.stale_prs ?? null
  const realMergeRate = kpi?.merge_rate ?? null
  const realWaitDays = kpi?.avg_wait_for_review ?? null
  const ciScore = rawCICDScore !== null ? Math.round((rawCICDScore / 25) * 100) : null

  const statusStrip = [
    {
      title: 'Merge Rate',
      value: realMergeRate !== null ? `${realMergeRate}%` : '—',
      trend: realMergeRate !== null ? (realMergeRate >= 75 ? 'Healthy' : 'Needs review') : 'No data yet',
      icon: <GitMerge className="h-4 w-4" />,
      style: realMergeRate !== null && realMergeRate >= 75
        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-250 dark:border-emerald-900/30'
        : 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900/30'
    },
    {
      title: 'Review Wait',
      value: realWaitDays !== null ? renderDuration(formatDurationFromDays(realWaitDays)) : '—',
      trend: realWaitDays !== null ? (realWaitDays <= 2 ? 'Within SLA' : 'Above SLA') : 'No data yet',
      icon: <Eye className="h-4 w-4" />,
      style: realWaitDays !== null && realWaitDays <= 2
        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-250 dark:border-emerald-900/30'
        : 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900/30'
    },
    {
      title: 'Stale PRs',
      value: realStaleCount !== null ? `${realStaleCount}` : '—',
      trend: realStaleCount !== null ? (realStaleCount === 0 ? 'None stale' : `${realStaleCount} > 30 days`) : 'No data yet',
      icon: <AlertCircle className="h-4 w-4" />,
      style: realStaleCount !== null && realStaleCount === 0
        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-250 dark:border-emerald-900/30'
        : 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900/30'
    },
    {
      title: 'CI/CD Health',
      value: ciScore !== null ? `${ciScore}%` : '—',
      trend: ciScore !== null ? (ciScore >= 80 ? 'Stable' : 'Needs attention') : 'No data yet',
      icon: <CheckCircle className="h-4 w-4" />,
      style: ciScore !== null && ciScore >= 80
        ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/30'
        : 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900/30'
    },
  ]

  // Main 6 metrics grid — all values from real API data, no fake fallbacks
  const mainKPIs = [
<<<<<<< HEAD
    { label: 'Total PRs', value: syncStatus ? formatTelemetry(syncStatus.synced_prs || syncStatus.total_prs, syncStatus.expected_prs) : (kpi?.total_prs ? formatTelemetry(kpi.total_prs, 0) : '—'), sub: 'All time', icon: <FolderGit2 className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Merge Rate', value: kpi ? `${kpi.merge_rate ?? 0}%` : '—', sub: 'of closed PRs', icon: <GitMerge className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Cycle Time', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time)) : '—', sub: '↓ 12% vs prev 30 days', icon: <Clock className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Review Wait', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_wait_for_review)) : '—', sub: '↑ 8% vs prev 30 days', icon: <Eye className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Review Duration', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_review_duration)) : '—', sub: '↓ 5% vs prev 30 days', icon: <MessageSquare className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Stale PRs', value: kpi?.stale_prs ?? 20, sub: '> 30 days old', icon: <AlertOctagon className="h-4 w-4 text-rose-500" />, onClick: () => onNavigate('pull_requests') },
=======
    { label: 'Total PRs', value: syncStatus ? formatTelemetry(syncStatus.synced_prs || syncStatus.total_prs, syncStatus.expected_prs) : (kpi?.total_prs != null ? formatTelemetry(kpi.total_prs, 0) : '—'), sub: 'All time', icon: <FolderGit2 className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Merge Rate', value: kpi ? `${kpi.merge_rate ?? '—'}%` : '—', sub: 'of closed PRs', icon: <GitMerge className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Cycle Time', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time)) : '—', sub: 'Merged PRs', icon: <Clock className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Review Wait', value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_wait_for_review_display, kpi.avg_wait_for_review)) : '—', sub: 'Time to first review', icon: <Eye className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Review Duration', value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_review_duration_display, kpi.avg_review_duration)) : '—', sub: 'Active review time', icon: <MessageSquare className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Stale PRs', value: kpi?.stale_prs ?? '—', sub: '> 30 days old', icon: <AlertOctagon className="h-4 w-4 text-rose-500" />, onClick: () => onNavigate('pull_requests') },
>>>>>>> 01a85de (New Chahges in ui)
  ]

  // Contributor activity formatted
  const topContributors = (contributors || []).slice(0, 6)
  const maxPRCount = Math.max(...topContributors.map((c: any) => c.total_prs || 1), 1)

  return (
    <div className="space-y-6">

      {/* Asymmetric layout header row (Executive Summary & Health Score) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Executive Summary Hero Card */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-5 flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="absolute right-0 top-0 h-40 w-40 bg-gradient-to-bl from-indigo-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-bold text-primary">Executive Summary</h3>
              </div>
              <button className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 text-xs font-semibold rounded-lg transition">
                <Sparkles className="h-3.5 w-3.5" />
                AI Insights
              </button>
            </div>
            
            <p className="text-secondary text-sm leading-relaxed max-w-2xl font-medium">
              {kpi ? (
                <>
                  Merge rate is{' '}
                  <span className={`font-bold ${(kpi.merge_rate ?? 0) >= 75 ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}`}>
                    {kpi.merge_rate ?? '—'}%
                  </span>
                  {'. '}
                  {kpi.stale_prs > 0 ? (
                    <><span className="font-bold text-orange-600 dark:text-orange-400 underline decoration-wavy">{kpi.stale_prs} stale PR{kpi.stale_prs !== 1 ? 's' : ''}</span> need attention.</>
                  ) : (
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">No stale PRs detected.</span>
                  )}
                </>
              ) : (
                <span className="text-muted italic">Sync repository to see executive insights.</span>
              )}
            </p>
          </div>

          {/* Metric horizontal strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 border-t border-border pt-4">
            {statusStrip.map((item) => (
              <div key={item.title} className="space-y-1">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">{item.title}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${item.style}`}>
                    {item.icon}
                    {item.value}
                  </span>
                </div>
                <span className="text-[10px] text-muted block">{item.trend}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Repository Health Score Radial Ring */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-primary">Repository Health Score</h3>
            <button onClick={() => onNavigate('repo_health')} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
              View details &rarr;
            </button>
          </div>

          {score === null ? (
            <div className="flex items-center justify-center h-32 text-muted text-xs italic">Health score loading...</div>
          ) : (
            <div className="flex items-center gap-6">
              {/* Radial score ring */}
              <div className="relative flex items-center justify-center shrink-0">
                <svg className="w-24 h-24 transform -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r={radius}
                    stroke="var(--bg-surface-soft)"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r={radius}
                    stroke="#10b981"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-800 ease-out"
                  />
                </svg>
                <div className="absolute text-center">
                  <span className="text-3xl font-extrabold text-primary tracking-tight">{score}</span>
                  <span className="text-[10px] text-muted block font-semibold mt-[-2px]">/100</span>
                </div>
              </div>

              {/* Health component list — only rendered when real data is present */}
              <div className="flex-1 space-y-2 min-w-0">
                {healthMetrics.slice(0, 5).map((m) => (
                  <div key={m.label} className="space-y-0.5">
                    <div className="flex justify-between text-[10px] font-semibold text-secondary">
                      <span className="truncate pr-1">{m.label}</span>
                      <span className="text-primary font-bold">{m.score !== null ? `${m.score}/100` : '—'}</span>
                    </div>
                    <div className="h-1 bg-surface-soft rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${m.color}`} style={{ width: m.score !== null ? `${m.score}%` : '0%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI analytics strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {mainKPIs.map((card) => (
          <button
            key={card.label}
            onClick={card.onClick}
            className="rounded-2xl border border-border bg-surface p-4 text-left shadow-sm hover:bg-bg-hover transition flex flex-col justify-between gap-3 group relative overflow-hidden"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{card.label}</span>
              <div className="p-1.5 rounded-lg bg-surface-soft border border-border text-muted group-hover:scale-105 transition">
                {card.icon}
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-2xl font-black text-primary tracking-tight leading-none">{card.value}</p>
              <p className="text-[10px] font-semibold text-muted">{card.sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Asymmetric charts & lists grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PR Flow Chart (ComposedChart) */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-primary">PR Flow</h3>
            <p className="text-[10px] text-muted font-semibold">Created · Merged · Closed (not merged) · Open at month end</p>
          </div>
          {monthlyFlow && monthlyFlow.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={monthlyFlow} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-muted)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--border-primary)" tick={{ fontSize: 9, fontWeight: 600, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--border-primary)" tick={{ fontSize: 9, fontWeight: 600, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--text-primary)', fontSize: 11 }} />
                <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }} />
                <Bar dataKey="created" name="Created" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="merged" name="Merged" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="closed" name="Closed (not merged)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-muted text-sm italic">No PR flow data available yet</div>
          )}
        </div>

        {/* Top Contributors & Review Turnaround vertical stack */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col justify-between gap-6">
          
          {/* Top Contributors list */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-primary">Top Contributors</h3>
              <button onClick={() => onNavigate('pull_requests')} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">View all</button>
            </div>
            <div className="space-y-3">
              {topContributors.map((c: any) => {
                const ratio = Math.round(((c.total_prs || 0) / maxPRCount) * 100)
                return (
                  <div key={c.username} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 flex items-center justify-center font-bold text-[10px] border border-orange-200 dark:border-orange-900/20 shrink-0">
                      {c.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex justify-between text-[11px] font-semibold text-secondary">
                        <span className="truncate pr-2">{c.username}</span>
                        <span className="text-primary font-bold">{c.opened_prs ?? c.total_prs} / {c.merged_prs}</span>
                      </div>
                      <div className="h-1.5 bg-surface-soft border border-border rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${ratio}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
              {!topContributors.length && (
                <p className="text-xs text-muted py-6 text-center">No contributor activity</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Needs Attention alerts center — all values from real telemetry */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-3">Needs Attention</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">

          {/* Real stale PR count from KPI */}
          <div className="rounded-xl border border-rose-100 dark:border-rose-900/25 bg-rose-50/40 dark:bg-rose-950/15 p-3 flex items-start gap-2.5 hover:bg-rose-50 dark:hover:bg-rose-950/25 transition cursor-pointer" onClick={() => onNavigate('pull_requests')}>
            <AlertCircle className="h-4.5 w-4.5 text-rose-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-rose-900 dark:text-rose-250">
                {kpi?.stale_prs != null ? `${kpi.stale_prs} Stale PR${kpi.stale_prs !== 1 ? 's' : ''}` : 'Stale PRs'}
              </p>
              <p className="text-[10px] text-rose-600 dark:text-rose-400">
                {kpi?.stale_prs != null ? (kpi.stale_prs === 0 ? 'None stale' : '> 30 days old') : 'Loading...'}
              </p>
            </div>
          </div>

          {/* Open PRs awaiting any review — from real open_prs count */}
          <div className="rounded-xl border border-amber-100 dark:border-amber-900/25 bg-amber-50/40 dark:bg-amber-950/15 p-3 flex items-start gap-2.5 hover:bg-amber-50 dark:hover:bg-amber-950/25 transition cursor-pointer" onClick={() => onNavigate('pull_requests')}>
            <Clock className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-900 dark:text-amber-250">
                {kpi?.open_prs != null ? `${kpi.open_prs} Open PR${kpi.open_prs !== 1 ? 's' : ''}` : 'Open PRs'}
              </p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                {kpi?.open_prs != null ? `${kpi.open_prs} awaiting merge` : 'Loading...'}
              </p>
            </div>
          </div>

          {/* CI/CD health from repo health score */}
          <div className="rounded-xl border border-red-100 dark:border-red-900/25 bg-red-50/40 dark:bg-red-950/15 p-3 flex items-start gap-2.5 hover:bg-red-50 dark:hover:bg-red-950/25 transition cursor-pointer" onClick={() => onNavigate('cicd')}>
            <AlertCircle className="h-4.5 w-4.5 text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-red-900 dark:text-red-250">CI/CD Health</p>
              <p className="text-[10px] text-red-600 dark:text-red-400">
                {repoHealth?.components?.ci_cd != null
                  ? `${Math.round((repoHealth.components.ci_cd / 25) * 100)}% reliability`
                  : 'View CI/CD panel'}
              </p>
            </div>
          </div>

          {/* Avg cycle time from KPI */}
          <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/25 bg-indigo-50/40 dark:bg-indigo-950/15 p-3 flex items-start gap-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/25 transition cursor-pointer" onClick={() => onNavigate('pull_requests')}>
            <Clock className="h-4.5 w-4.5 text-indigo-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-indigo-900 dark:text-indigo-250">Avg Cycle Time</p>
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400">
                {kpi?.avg_cycle_time != null
                  ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time))
                  : 'Loading...'}
              </p>
            </div>
          </div>

        </div>
      </div>

    </div>
  )
}

// ─── Pull Requests Section Redesign ──────────────────────────────────────────

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

  // Pie chart variables — use real KPI fields, no fake fallbacks
  const openCount = kpi?.open_prs ?? 0
  const mergedCount = kpi?.merged_prs ?? 0
  const closedCount = kpi?.closed_not_merged_prs ?? 0
  const hasRealPieData = kpi != null && (openCount + mergedCount + closedCount) > 0

  const pieData = [
    { name: 'Open', value: openCount, color: '#f97316' },
    { name: 'Merged', value: mergedCount, color: '#10b981' },
    { name: 'Closed (not merged)', value: closedCount, color: '#64748b' },
  ]

  // KPI Row
  const prStrip = [
    { 
      title: 'Open PRs', 
      value: openCount, 
      labelCls: 'text-orange-600/70 dark:text-orange-400/80', 
      valueCls: 'text-orange-700 dark:text-orange-300', 
      cardCls: 'bg-orange-50 dark:bg-orange-950/10 border-orange-100 dark:border-orange-900/20' 
    },
    { 
      title: 'Merged PRs', 
      value: mergedCount, 
      labelCls: 'text-emerald-600/70 dark:text-emerald-400/80', 
      valueCls: 'text-emerald-700 dark:text-emerald-300', 
      cardCls: 'bg-emerald-50 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/20' 
    },
    { 
      title: 'Closed (not merged)', 
      value: closedCount, 
      labelCls: 'text-muted/80', 
      valueCls: 'text-secondary font-bold', 
      cardCls: 'bg-surface-soft border-border' 
    },
    { 
      title: 'Avg Cycle Time', 
      value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time)) : '—', 
      labelCls: 'text-indigo-600/70 dark:text-indigo-400/80', 
      valueCls: 'text-indigo-700 dark:text-indigo-300', 
      cardCls: 'bg-indigo-50 dark:bg-indigo-950/10 border-indigo-100 dark:border-indigo-900/20' 
    },
    { 
      title: 'Review Wait', 
      value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_wait_for_review_display, kpi.avg_wait_for_review)) : '—', 
      labelCls: 'text-orange-700/70 dark:text-orange-400/80', 
      valueCls: 'text-orange-700 dark:text-orange-400', 
      cardCls: 'bg-[#fdf2ec] dark:bg-[#c2410c]/5 border-[#fce6d8] dark:border-orange-900/20' 
    },
    { 
      title: 'Review Duration', 
      value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_review_duration_display, kpi.avg_review_duration)) : '—', 
      labelCls: 'text-purple-600/70 dark:text-purple-400/80', 
      valueCls: 'text-purple-700 dark:text-purple-300', 
      cardCls: 'bg-purple-50 dark:bg-purple-950/10 border-purple-100 dark:border-purple-900/20' 
    },
  ]

  return (
    <div className="space-y-6">
      
      {/* Filters row */}
      <DashboardFilters
        filters={localFilters}
        authors={authors}
        onChange={setLocalFilters}
        onApply={() => onFiltersChange(localFilters)}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
          {typeof error === 'string' ? error : String(error)}
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {prStrip.map((item) => {
          const strVal = String(item.value)
          const isShort = strVal.length <= 6
          return (
            <div key={item.title} className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-2 ${item.cardCls}`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider block ${item.labelCls}`}>{item.title}</span>
              <span
                className={`font-black tracking-tight leading-none truncate ${isShort ? 'text-2xl' : 'text-base'} ${item.valueCls}`}
                title={strVal}
              >{item.value}</span>
            </div>
          )
        })}
      </div>

      {/* PR Lifecycle donut & bottlenecks list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PR Lifecycle Flow - Donut chart */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-primary mb-1">PR Status Distribution</h3>
            <p className="text-[10px] text-muted font-semibold">Total Lifecycle PRs: {kpi?.total_prs ?? '—'}</p>
          </div>
          
          {hasRealPieData ? (
            <div className="flex items-center justify-between gap-4 py-4">
              <ResponsiveContainer width="45%" height={120}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={50}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              {/* Custom Legend */}
              <div className="flex-1 space-y-1.5 text-xs font-semibold text-secondary">
                {pieData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span>{item.name}</span>
                    </div>
                    <span className="font-bold text-primary">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted text-xs italic">No PR data available yet</div>
          )}
        </div>

        {/* Bottleneck analysis list — computed from real stale/open PR metrics */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-primary mb-1">Bottleneck Analysis</h3>
            <p className="text-[10px] text-muted font-semibold">Flagging reviewer constraints and latency risks</p>
          </div>

          <div className="space-y-3 mt-4">
            {/* Stale open PRs (no review in 30+ days) — from real stale_prs count */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-50/50 dark:bg-orange-950/10 border border-orange-100 dark:border-orange-900/20">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
                  <UserCheck className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-orange-900 dark:text-orange-200">Stale open PRs</span>
              </div>
              <span className="text-xs font-black text-orange-700 dark:text-orange-400">
                {kpi?.stale_prs != null ? `${kpi.stale_prs} PR${kpi.stale_prs !== 1 ? 's' : ''} > 30 days` : '— (loading)'}
              </span>
            </div>

            {/* Total open PRs awaiting merge */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/20">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                  <CheckCircle className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-amber-900 dark:text-amber-200">Open PRs awaiting merge</span>
              </div>
              <span className="text-xs font-black text-amber-700 dark:text-amber-400">
                {kpi?.open_prs != null ? `${kpi.open_prs} open` : '— (loading)'}
              </span>
            </div>

            {/* Avg review wait from KPI */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/50 dark:bg-purple-950/10 border border-purple-100 dark:border-purple-900/20">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
                  <Timer className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-purple-900 dark:text-purple-200">Avg review wait</span>
              </div>
              <span className="text-xs font-black text-purple-700 dark:text-purple-400">
                {kpi?.avg_wait_for_review != null
                  ? renderDuration(formatDurationFromDays(kpi.avg_wait_for_review))
                  : '— (no review data)'}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* PR Risk & Stale Alerts */}
      {prRisk && (
        <PRRiskPanel data={prRisk} page={prRiskPage} onPageChange={onPRRiskPage} />
      )}
      {staleAlerts && (
        <StalePRAlerts data={staleAlerts} page={staleAlertsPage} onPageChange={onStaleAlertsPage} />
      )}

      {/* Main Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {oldestPRs && (
          <DataTable
            title="Oldest Open PRs"
            icon={<Clock className="h-4.5 w-4.5 text-orange-500" />}
            columns={['PR', 'Title', 'Author', 'Age', 'Reviews']}
            data={oldestPRs?.data ?? []}
            page={oldestPage} pages={oldestPRs?.pages ?? 1}
            onPageChange={onOldestPage}
            renderRow={(row: any) => (
              <>
<<<<<<< HEAD
                <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">#{row.number || row.pr_number}</td>
                <td className="px-4 py-2.5 text-slate-900 text-xs font-medium max-w-[220px] truncate" title={row.title}>{row.title}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.author}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs font-bold">{row.age_days}d</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.review_count}</td>
=======
                <td className="px-4 py-2.5 font-mono text-muted text-xs">#{row.number}</td>
                <td className="px-4 py-2.5 text-primary text-xs font-medium max-w-[220px] truncate" title={row.title}>{row.title}</td>
                <td className="px-4 py-2.5 text-secondary text-xs">{row.author}</td>
                <td className="px-4 py-2.5 text-secondary text-xs font-bold">{row.age_days}d</td>
                <td className="px-4 py-2.5 text-secondary text-xs">{row.review_count}</td>
>>>>>>> 01a85de (New Chahges in ui)
              </>
            )}
          />
        )}
        {slowestPRs && (
          <DataTable
            title="Slowest Merged PRs"
            icon={<Timer className="h-4.5 w-4.5 text-indigo-500" />}
            columns={['PR', 'Title', 'Author', 'Cycle Time', 'Reviews']}
            data={slowestPRs?.data ?? []}
            page={slowestPage} pages={slowestPRs?.pages ?? 1}
            onPageChange={onSlowestPage}
            renderRow={(row: any) => (
              <>
<<<<<<< HEAD
                <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">#{row.number || row.pr_number}</td>
                <td className="px-4 py-2.5 text-slate-900 text-xs font-medium max-w-[220px] truncate" title={row.title}>{row.title}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.author}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs font-bold">{renderDuration(formatDurationFromDays(row.cycle_time_days))}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.review_count}</td>
=======
                <td className="px-4 py-2.5 font-mono text-muted text-xs">#{row.number}</td>
                <td className="px-4 py-2.5 text-primary text-xs font-medium max-w-[220px] truncate" title={row.title}>{row.title}</td>
                <td className="px-4 py-2.5 text-secondary text-xs">{row.author}</td>
                <td className="px-4 py-2.5 text-secondary text-xs font-bold">{renderDuration(formatDurationFromDays(row.cycle_time_days))}</td>
                <td className="px-4 py-2.5 text-secondary text-xs">{row.review_count}</td>
>>>>>>> 01a85de (New Chahges in ui)
              </>
            )}
          />
        )}
      </div>

      {contributors && (
        <DataTable
          title="Contributor Activity"
          icon={<Eye className="h-4.5 w-4.5 text-emerald-500" />}
          columns={['Author', 'PRs', 'Merged', 'Avg Cycle Time', 'Avg Review Wait']}
          data={contributors?.data ?? []}
          page={contributorsPage} pages={contributors?.pages ?? 1}
          onPageChange={onContributorsPage}
          renderRow={(row: any) => (
            <>
<<<<<<< HEAD
              <td className="px-4 py-2.5 text-slate-900 text-xs font-bold">{row.username}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs">{row.total_prs}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs">{row.merged_prs}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs font-semibold">{renderDuration(formatDurationFromDays(row.avg_cycle_time))}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs font-semibold">{renderDuration(formatDurationFromDays(row.avg_wait_for_review))}</td>
=======
              <td className="px-4 py-2.5 text-primary text-xs font-bold">{row.username}</td>
              <td className="px-4 py-2.5 text-secondary text-xs">{row.total_prs}</td>
              <td className="px-4 py-2.5 text-secondary text-xs">{row.merged_prs}</td>
              <td className="px-4 py-2.5 text-secondary text-xs font-semibold">{renderDuration(formatDurationFromDays(row.avg_cycle_time))}</td>
              <td className="px-4 py-2.5 text-secondary text-xs font-semibold">{renderDuration(formatDurationFromDays(row.avg_wait_for_review))}</td>
>>>>>>> 01a85de (New Chahges in ui)
            </>
          )}
        />
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-600" />
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Loading PRISM...</p>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
