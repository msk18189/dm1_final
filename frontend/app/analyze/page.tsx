'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'
import { Loader2 } from 'lucide-react'

export default function AnalyzePage() {
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/dashboard')
    } else {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-warm-50">
      <div className="text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-palette-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-warm-400">Loading PRISM...</p>
      </div>
    </div>
  )
}
