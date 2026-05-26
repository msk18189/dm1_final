export interface DurationDisplay {
  value: number
  unit: string
  raw_hours?: number
}

export function formatDurationDisplay(
  display?: DurationDisplay | null,
  fallbackDays?: number | null
): { value: string | number; unit: string } {
  if (display && display.value !== null && display.value !== undefined) {
    let val = display.value;
    if (val < 0) val = 0;
    if (val === 0) return { value: 0, unit: 'hrs' };
    return { value: val, unit: display.unit || 'hrs' }
  }
  if (fallbackDays !== undefined && fallbackDays !== null) {
    let fallback = fallbackDays;
    if (fallback < 0) fallback = 0;
    if (fallback === 0) return { value: 0, unit: 'hrs' };
    if (fallback < 1) {
      const hrs = Math.round(fallback * 24 * 10) / 10
      return { value: hrs === Math.floor(hrs) ? Math.floor(hrs) : hrs, unit: 'hrs' }
    }
    return { value: fallback, unit: 'days' }
  }
  return { value: 'Limited', unit: '' }
}

export function formatDurationFromDays(days?: number | null): { value: string | number; unit: string } {
  if (days === undefined || days === null) return { value: 'Limited', unit: '' }
  let d = days;
  if (d < 0) d = 0;
  if (d === 0) return { value: 0, unit: 'hrs' }
  if (d < 1) {
    const hrs = Math.round(d * 24 * 10) / 10
    return { value: hrs === Math.floor(hrs) ? Math.floor(hrs) : hrs, unit: 'hrs' }
  }
  return { value: d, unit: 'days' }
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

export function formatTelemetry(
  synced: number | undefined | null,
  expected: number | undefined | null
): string {
  const s = synced !== undefined && synced !== null ? synced : 0;
  const exp = expected !== undefined && expected !== null ? expected : 0;
  
  if (exp <= 0) {
    return `${s}`;
  }
  
  const display_total = Math.max(exp, s);
  return `${s} / ${display_total}`;
}

