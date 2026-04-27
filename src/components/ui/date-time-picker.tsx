import * as React from "react"
import { format, isValid } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DateTimePickerProps {
  value?: string          // ISO string (or "")
  onChange: (iso: string | undefined) => void
  placeholder?: string
  disabled?: boolean
  minDate?: Date
  className?: string
}

/**
 * A date + time picker built on the shadcn Calendar + a native time input,
 * displayed inside a Popover trigger.
 *
 * `value`  – ISO string like "2026-04-10T14:30:00.000Z", or undefined/""
 * `onChange` – called with an ISO string when the user picks a date/time,
 *              or undefined when cleared
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick a date & time",
  disabled,
  minDate,
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Parse incoming ISO string → local Date (or undefined)
  const selected: Date | undefined = React.useMemo(() => {
    if (!value) return undefined
    const d = new Date(value)
    return isValid(d) ? d : undefined
  }, [value])

  // Local time string "HH:mm" derived from the selected date
  const timeString = selected ? format(selected, "HH:mm") : "00:00"

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) {
      onChange(undefined)
      return
    }
    // Preserve the current time when selecting a new day
    const [hh, mm] = timeString.split(":").map(Number)
    day.setHours(hh, mm, 0, 0)
    onChange(day.toISOString())
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const base = selected ?? new Date()
    const [hh, mm] = e.target.value.split(":").map(Number)
    const updated = new Date(base)
    updated.setHours(hh, mm, 0, 0)
    onChange(updated.toISOString())
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(undefined)
  }

  const displayLabel = selected
    ? format(selected, "MMM d, yyyy  HH:mm")
    : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0 opacity-60" />
          <span className="flex-1 truncate">{displayLabel}</span>
          {selected && (
            <span
              role="button"
              aria-label="Clear date"
              className="ml-1 rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={handleClear}
            >
              ✕
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        {/* Calendar */}
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleDaySelect}
          disabled={minDate ? (d) => d < minDate : undefined}
          captionLayout="dropdown"
          autoFocus
        />

        {/* Time input */}
        <div className="flex items-center gap-2 border-t px-3 py-2.5">
          <span className="text-sm text-muted-foreground">Time</span>
          <input
            type="time"
            value={timeString}
            onChange={handleTimeChange}
            className="ml-auto h-8 w-28 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
