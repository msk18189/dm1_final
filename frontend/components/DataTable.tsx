'use client'

import { motion } from 'framer-motion'

interface Column {
  key: string
  label: string
  render?: (value: any, row?: any) => React.ReactNode
}

interface DataTableProps {
  title: string
  columns: Column[]
  data: any[]
  emptyMessage?: string
}

export default function DataTable({
  title,
  columns,
  data,
  emptyMessage = 'No data available',
}: DataTableProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow">
      <h3 className="section-title mb-4">{title}</h3>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-midnight-400">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.04]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brown-200 bg-brown-50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-midnight-400"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-midnight-800 transition hover:bg-palette-emerald-light/50"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-sm text-midnight-200">
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  )
}
