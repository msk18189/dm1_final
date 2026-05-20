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
        className="btn-secondary flex items-center gap-2 text-sm"
      >
        <Download className="h-4 w-4 text-palette-teal" />
        CSV
      </button>
      <button
        type="button"
        onClick={() => window.open(getExportPdfUrl(repoId, filters), '_blank')}
        className="btn-primary flex items-center gap-2 text-sm"
      >
        <FileText className="h-4 w-4" />
        PDF
      </button>
    </div>
  )
}
