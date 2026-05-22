'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Github, Loader, KeyRound, ShieldCheck, Lock, Search } from 'lucide-react'
import { verifyRepositoryAccess, formatApiError } from '@/lib/api'

interface RepositoryInputProps {
  githubToken: string
  onGithubTokenChange: (value: string) => void
  onAnalyze: (url: string, githubToken?: string) => Promise<void>
  isLoading: boolean
  variant?: 'hero' | 'dashboard'
}

export default function RepositoryInput({
  githubToken,
  onGithubTokenChange,
  onAnalyze,
  isLoading,
  variant = 'dashboard',
}: RepositoryInputProps) {
  const [url, setUrl] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
  const [verifyOk, setVerifyOk] = useState(false)

  const tokenForRequest = () => {
    const t = githubToken.trim()
    return t ? t : undefined
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) await onAnalyze(url.trim(), tokenForRequest())
  }

  const handleVerify = async () => {
    if (!url.trim()) {
      setVerifyMessage('Enter a repository URL first.')
      setVerifyOk(false)
      return
    }
    setVerifying(true)
    setVerifyMessage(null)
    setVerifyOk(false)
    try {
      const result = await verifyRepositoryAccess(url.trim(), tokenForRequest())
      const privacy = result.is_private ? 'private' : 'public'
      const source =
        result.token_source === 'user'
          ? 'your token'
          : result.token_source === 'env'
            ? 'server .env'
            : 'no token'
      setVerifyOk(true)
      setVerifyMessage(`Access confirmed: ${result.owner}/${result.repo} (${privacy}) via ${source}.`)
    } catch (err) {
      setVerifyOk(false)
      setVerifyMessage(formatApiError(err))
    } finally {
      setVerifying(false)
    }
  }

  const isHero = variant === 'hero'

  return (
    <motion.form
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className={isHero ? 'p-12 sm:p-16 lg:p-24' : 'card card-hover'}
    >
      {!isHero && (
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-palette-emerald-light">
            <Search className="h-5 w-5 text-palette-emerald" />
          </div>
          <div>
            <h2 className="text-base font-bold text-primary">Change repository</h2>
            <p className="text-xs text-muted">Run a new analysis</p>
          </div>
        </div>
      )}

      {isHero && (
        <div className="mb-8 text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Analyze repository</h2>
          <p className="text-base text-secondary">Paste a GitHub URL to start the repository analytics workflow</p>
        </div>
      )}

      <div className={`mb-6 flex gap-3 rounded-2xl border border-warm-200 bg-warm-50 p-4 ${isHero ? 'border-palette-amber/20 bg-palette-amber-light/30' : 'border-palette-amber/20 bg-palette-amber-light/50'}`}>
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-palette-amber" />
        <p className="text-xs leading-relaxed text-secondary sm:text-sm">
          Private repos need a{' '}
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-palette-emerald hover:underline"
          >
            PAT
          </a>{' '}
          with <span className="font-medium text-primary">repo</span> scope.
        </p>
      </div>

      <div className={isHero ? 'space-y-6 sm:space-y-8' : 'space-y-4'}>
        <div>
          <label className={`mb-2 block font-semibold uppercase tracking-wider text-secondary ${isHero ? 'text-xs sm:text-sm' : 'text-[10px]'}`}>
            Repository URL
          </label>
          <div className="relative">
            <Github className={`absolute top-1/2 -translate-y-1/2 text-muted ${isHero ? 'h-6 w-6 left-5' : 'h-4 w-4 left-3.5'}`} />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setVerifyMessage(null)
                setVerifyOk(false)
              }}
              placeholder="github.com/owner/repo"
              className={`input-field ${isHero ? 'h-14 pr-5 !rounded-2xl text-lg' : 'pr-4 text-sm'}`}
              style={{ paddingLeft: isHero ? '4rem' : '3rem' }}
              disabled={isLoading}
            />
          </div>
        </div>

        <div>
          <label className={`mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wider text-secondary ${isHero ? 'text-xs sm:text-sm' : 'text-[10px]'}`}>
            <KeyRound className={isHero ? 'h-4 w-4' : 'h-3 w-3'} />
            Token <span className="normal-case font-normal text-muted">(optional)</span>
          </label>
          <input
            type="password"
            autoComplete="off"
            value={githubToken}
            onChange={(e) => {
              onGithubTokenChange(e.target.value)
              setVerifyMessage(null)
              setVerifyOk(false)
            }}
            placeholder="ghp_…"
            className={`input-field font-mono ${isHero ? 'h-14 px-5 !rounded-2xl text-lg' : 'text-sm'}`}
            disabled={isLoading}
          />
        </div>

        {verifyMessage && (
          <p
            className={`font-medium ${isHero ? 'text-base' : 'text-xs'} ${verifyOk ? 'text-palette-emerald' : 'text-palette-amber'}`}
            role="status"
          >
            {verifyMessage}
          </p>
        )}

        <div className="flex flex-col gap-4 pt-2 sm:flex-row">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isLoading || verifying || !url.trim()}
            className={`btn-secondary flex items-center justify-center gap-2.5 sm:flex-none transition-all duration-300 ${isHero ? 'text-lg h-14 px-8 !rounded-2xl' : 'text-sm sm:px-5'}`}
          >
            {verifying ? <Loader className={isHero ? 'h-6 w-6 animate-spin' : 'h-4 w-4 animate-spin'} /> : <ShieldCheck className={isHero ? 'h-6 w-6' : 'h-4 w-4'} />}
            <span>Test</span>
          </button>
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className={`btn-primary flex flex-1 items-center justify-center gap-2.5 transition-all duration-300 ${isHero ? 'text-lg h-14 !rounded-2xl font-bold shadow-lg hover:shadow-xl' : 'text-sm'}`}
          >
            {isLoading ? (
              <>
                <Loader className={isHero ? 'h-6 w-6 animate-spin' : 'h-4 w-4 animate-spin'} />
                <span>Analyzing…</span>
              </>
            ) : (
              <span>Run analysis</span>
            )}
          </button>
        </div>
      </div>
    </motion.form>
  )
}
