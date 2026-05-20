export interface DurationDisplay {
  value: number
  unit: string
  raw_hours?: number
}

export function formatDurationDisplay(
  display?: DurationDisplay | null,
  fallbackDays?: number
): { value: string | number; unit: string } {
  if (display && display.value > 0) {
    return { value: display.value, unit: display.unit }
  }
  if (fallbackDays !== undefined && fallbackDays > 0) {
    if (fallbackDays < 1) {
      const hrs = Math.round(fallbackDays * 24 * 10) / 10
      return { value: hrs === Math.floor(hrs) ? Math.floor(hrs) : hrs, unit: 'hrs' }
    }
    return { value: fallbackDays, unit: 'days' }
  }
  return { value: 0, unit: 'hrs' }
}

export function formatDurationFromDays(days: number): { value: string | number; unit: string } {
  if (days <= 0) return { value: 0, unit: 'hrs' }
  if (days < 1) {
    const hrs = Math.round(days * 24 * 10) / 10
    return { value: hrs === Math.floor(hrs) ? Math.floor(hrs) : hrs, unit: 'hrs' }
  }
  return { value: days, unit: 'days' }
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'high':
      return 'border-palette-rose/40 bg-palette-rose-light'
    case 'medium':
      return 'border-palette-amber/40 bg-palette-amber-light'
    default:
      return 'border-palette-lime/40 bg-palette-lime-light'
  }
}

export function riskColor(score: number): string {
  if (score >= 70) return 'text-palette-rose font-bold'
  if (score >= 40) return 'text-palette-amber font-bold'
  return 'text-palette-teal font-bold'
}
