'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated, getAuthUser } from '@/lib/auth'
import { loadGithubToken, saveGithubToken } from '@/lib/tokenStorage'
import { analyzeRepository, formatApiError, getSyncStatus } from '@/lib/api'
import { Loader2 } from 'lucide-react'
import AppShell from '@/components/AppShell'
import RepositoryInput from '@/components/RepositoryInput'

export default function AnalyzePage() {
  const router = useRouter()
  const [githubToken, setGithubToken] = useState<string>('')
  const [userLabel, setUserLabel] = useState<string | undefined>()
  const [isSyncing, setIsSyncing] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }

    const savedRepoId = localStorage.getItem('prism_repo_id')
    if (savedRepoId) {
      const id = parseInt(savedRepoId, 10)
      if (!isNaN(id)) {
        // Validate repo still exists before redirecting
        getSyncStatus(id).then(() => {
          router.replace('/dashboard')
        }).catch(() => {
          // Repo no longer exists — clear stale state
          localStorage.removeItem('prism_repo_id')
          localStorage.removeItem('prism_repo_label')
          localStorage.removeItem('prism_active_section')
          localStorage.removeItem('prism_dashboard_route')
        })
        return
      }
    }

    // Set token on client side
    setGithubToken(loadGithubToken())
    setIsHydrated(true)

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
  }, [router])

  const handleAnalyze = useCallback(async (url: string, token?: string) => {
    setGlobalError(null)
    setIsSyncing(true)
    try {
      const result = await analyzeRepository(url, token || githubToken || undefined)
      const newRepoId: number = result.repo_id ?? result.id
      const label = result.owner && result.repo ? `${result.owner}/${result.repo}` : url

      // Store in localStorage
      localStorage.setItem('prism_repo_id', String(newRepoId))
      localStorage.setItem('prism_repo_label', label)
      localStorage.setItem('prism_active_section', 'overview')
      localStorage.setItem('prism_dashboard_route', '/dashboard')

      // Redirect to dashboard
      router.push('/dashboard')
    } catch (err) {
      setIsSyncing(false)
      setGlobalError(formatApiError(err))
    }
  }, [githubToken, router])

  const handleTokenSave = (t: string) => {
    saveGithubToken(t)
    setGithubToken(t)
  }

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

  return (
    <AppShell
      hasData={false}
      repoLabel=""
      activeSection="analyze"
      userLabel={userLabel}
    >
      <div className="space-y-6">
        {globalError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Error:</span>
              <span>{globalError}</span>
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
    </AppShell>
  )
}
