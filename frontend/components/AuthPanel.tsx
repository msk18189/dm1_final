'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp, getAuthUser, hasStoredUsers } from '@/lib/auth'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  GitBranch, 
  ShieldCheck, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  AlertCircle,
  Loader2,
  CheckCircle2
} from 'lucide-react'

interface AuthPanelProps {
  onAuthenticated?: (username: string) => void
}

export default function AuthPanel({ onAuthenticated }: AuthPanelProps) {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSignUp = mode === 'signup'

  useEffect(() => {
    if (getAuthUser()) {
      router.replace('/')
      return
    }

    if (hasStoredUsers()) {
      setMode('signin')
    } else {
      setMode('signup')
    }
  }, [router])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')

    if (!email.trim()) {
      setMessageType('error')
      setMessage('Please enter your email address.')
      return
    }

    if (!password) {
      setMessageType('error')
      setMessage('Please enter your password.')
      return
    }

    if (isSignUp && password !== confirmPassword) {
      setMessageType('error')
      setMessage('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    
    // Simulate secure network delay
    await new Promise((resolve) => setTimeout(resolve, 800))

    const normalizedEmail = email.trim().toLowerCase()
    const result = isSignUp ? signUp(normalizedEmail, password) : signIn(normalizedEmail, password)
    
    setIsSubmitting(false)

    if (!result.success) {
      setMessageType('error')
      setMessage(result.error || 'Authentication failed.')
      return
    }

    if (isSignUp) {
      setMode('signin')
      setPassword('')
      setConfirmPassword('')
      setMessageType('success')
      setMessage('Account created successfully. Please sign in.')
      return
    }

    setMessageType('success')
    setMessage('Signed in successfully. Redirecting...')
    onAuthenticated?.(normalizedEmail)
    setTimeout(() => router.push('/'), 400)
  }

  const handleTabChange = (newMode: 'signin' | 'signup') => {
    setMode(newMode)
    setMessage('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  return (
    <div className="auth-bg min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
      {/* Decorative radial gradient meshes */}
      <div className="auth-glow-1"></div>
      <div className="auth-glow-2"></div>

      <div className="relative z-10 w-full max-w-[420px] flex flex-col items-center">
        
        {/* Brand Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-col items-center mb-6 text-center"
        >
          {/* Security Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-palette-orange/10 border border-palette-orange/20 text-[10px] font-bold uppercase tracking-wider text-palette-orange-dark mb-4 shadow-sm">
            <ShieldCheck className="h-3.5 w-3.5 text-palette-orange animate-pulse" />
            <span>Secure Authentication</span>
          </div>

          {/* Logo Icon */}
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-palette-orange to-palette-amber text-white shadow-md shadow-palette-orange/15 mb-3">
            <GitBranch className="h-5.5 w-5.5" />
          </div>

          {/* Title & Description */}
          <h1 className="text-2xl font-extrabold tracking-tight text-warm-900">PRISM</h1>
          <p className="mt-1 text-xs text-warm-500 font-semibold max-w-[320px] leading-relaxed">
            AI-Powered GitHub PR Intelligence
          </p>
        </motion.div>

        {/* Main Auth Card */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, cubicBezier: [0.16, 1, 0.3, 1], delay: 0.2 }}
          className="w-full bg-white border border-warm-200 shadow-card hover:shadow-[0_12px_40px_rgba(44,38,32,0.08)] transition-all duration-300 rounded-2xl p-6 sm:p-8"
        >
          {/* Card Header Subtitle */}
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold text-warm-900 tracking-tight">
              {isSignUp ? 'Create Workspace' : 'Welcome Back'}
            </h2>
            <p className="text-xs text-warm-500 mt-1.5 leading-normal">
              {isSignUp 
                ? 'Sign up to analyze repository cycle time & risk factors.' 
                : 'Login to access engineering workflow intelligence.'}
            </p>
          </div>

          {/* Segmented Auth Tabs */}
          <div className="flex p-1 bg-warm-100 rounded-xl border border-warm-200/50 mb-6">
            <button
              type="button"
              className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                !isSignUp 
                  ? 'bg-white text-warm-900 shadow-sm border border-warm-200/20' 
                  : 'text-warm-500 hover:text-warm-900'
              }`}
              onClick={() => handleTabChange('signin')}
              disabled={isSubmitting}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                isSignUp 
                  ? 'bg-white text-warm-900 shadow-sm border border-warm-200/20' 
                  : 'text-warm-500 hover:text-warm-900'
              }`}
              onClick={() => handleTabChange('signup')}
              disabled={isSubmitting}
            >
              Create Account
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Email field */}
            <div>
              <label htmlFor="email" className="block text-[10px] font-bold uppercase tracking-wider text-warm-600 mb-1.5">
                Email Address
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3.5 h-4.5 w-4.5 text-warm-400 pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  disabled={isSubmitting}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full bg-warm-50/40 hover:bg-warm-50/80 focus:bg-white text-warm-900 placeholder:text-warm-400 pl-10 pr-4 py-3 rounded-xl border border-warm-200 focus:border-palette-orange focus:ring-4 focus:ring-palette-orange/15 shadow-sm transition-all text-sm outline-none"
                  placeholder="name@company.com"
                  required
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password" className="block text-[10px] font-bold uppercase tracking-wider text-warm-600 mb-1.5">
                Password
              </label>
              <div className="relative flex items-center">
                <Lock className="absolute left-3.5 h-4.5 w-4.5 text-warm-400 pointer-events-none" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  disabled={isSubmitting}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full bg-warm-50/40 hover:bg-warm-50/80 focus:bg-white text-warm-900 placeholder:text-warm-400 pl-10 pr-10 py-3 rounded-xl border border-warm-200 focus:border-palette-orange focus:ring-4 focus:ring-palette-orange/15 shadow-sm transition-all text-sm outline-none"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 text-warm-400 hover:text-warm-600 focus:outline-none transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {/* Confirm Password field (Sign Up only) */}
            {isSignUp && (
              <div>
                <label htmlFor="confirmPassword" className="block text-[10px] font-bold uppercase tracking-wider text-warm-600 mb-1.5">
                  Confirm Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 h-4.5 w-4.5 text-warm-400 pointer-events-none" />
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    disabled={isSubmitting}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full bg-warm-50/40 hover:bg-warm-50/80 focus:bg-white text-warm-900 placeholder:text-warm-400 pl-10 pr-10 py-3 rounded-xl border border-warm-200 focus:border-palette-orange focus:ring-4 focus:ring-palette-orange/15 shadow-sm transition-all text-sm outline-none"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 text-warm-400 hover:text-warm-600 focus:outline-none transition-colors"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Notification alert banner */}
            <AnimatePresence mode="wait">
              {message && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs font-semibold leading-normal ${
                    messageType === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : messageType === 'success'
                      ? 'border-palette-orange/20 bg-palette-orange/5 text-palette-orange-dark'
                      : 'border-warm-200 bg-warm-50/50 text-warm-800'
                  }`}
                >
                  {messageType === 'error' ? (
                    <AlertCircle className="h-4.5 w-4.5 shrink-0 text-red-550 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-palette-orange mt-0.5" />
                  )}
                  <span>{message}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Symmetrical CTA Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-palette-orange hover:bg-palette-orange-dark text-white font-semibold py-3 px-4 rounded-xl text-sm shadow-[0_4px_12px_rgba(198,123,92,0.2)] hover:shadow-[0_6px_20px_rgba(198,123,92,0.3)] transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-palette-orange/20 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none mt-6"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
              )}
            </button>
          </form>

          {/* Symmetrical Security Footer */}
          <div className="mt-8 pt-6 border-t border-warm-100">
            <div className="grid grid-cols-3 gap-1.5 text-[9px] text-warm-400 font-bold uppercase tracking-wider text-center">
              <div className="flex flex-col items-center gap-1.5 justify-center">
                <Lock className="h-4 w-4 text-warm-400" />
                <span>Protected Access</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 justify-center border-x border-warm-200/60">
                <ShieldCheck className="h-4 w-4 text-warm-400" />
                <span>SSL Encrypted</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 justify-center">
                <CheckCircle2 className="h-4 w-4 text-warm-400" />
                <span>Secure Auth</span>
              </div>
            </div>
          </div>

        </motion.div>
      </div>
    </div>
  )
}
