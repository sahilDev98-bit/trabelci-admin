const FALLBACK = "---"

/**
 * Formats a date string into a readable local date-time string.
 * Example: "Mar 13, 2026, 1:05 AM"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return FALLBACK

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return FALLBACK

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
