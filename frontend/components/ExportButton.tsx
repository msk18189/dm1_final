'use client'

import { Download, FileText } from 'lucide-react'
import { getExportCsvUrl, getExportPdfUrl } from '@/lib/api'
import type { DashboardFiltersState } from '@/components/DashboardFilters'

interface ExportButtonProps {
  repoId: number
  filters: DashboardFiltersState
}

export default function ExportButton({ repoId, filters }: ExportButtonProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => window.open(getExportCsvUrl(repoId, filters), '_blank')}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-md"
        style={{ color: '#1e293b' }}
      >
        <Download className="h-4 w-4 text-emerald-600" />
        <span style={{ color: '#1e293b' }}>Export CSV</span>
      </button>
      <button
        type="button"
        onClick={() => window.open(getExportPdfUrl(repoId, filters), '_blank')}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-indigo-700 hover:shadow-md"
      >
        <FileText className="h-4 w-4" />
        Export PDF
      </button>
    </div>
  )
}
