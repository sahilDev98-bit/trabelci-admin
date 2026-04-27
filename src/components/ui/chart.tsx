import * as React from "react"

import { cn } from "@/lib/utils"

export type ChartConfig = Record<
  string,
  {
    label: string
    color: string
    theme?: {
      light: string
      dark: string
    }
  }
>

function isDarkMode() {
  return document.documentElement.classList.contains("dark")
}

function ChartContainer({
  className,
  config,
  children,
  ...props
}: React.ComponentProps<"div"> & { config: ChartConfig }) {
  const [dark, setDark] = React.useState(isDarkMode)

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(isDarkMode())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  const styleVars = React.useMemo(() => {
    const entries = Object.entries(config).map(([key, value]) => {
      const color = value.theme ? (dark ? value.theme.dark : value.theme.light) : value.color
      return [`--color-${key}`, color] as const
    })
    return Object.fromEntries(entries) as React.CSSProperties
  }, [config, dark])

  return (
    <div
      data-slot="chart-container"
      className={cn("w-full", className)}
      style={styleVars}
      {...props}
    >
      {children}
    </div>
  )
}

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: unknown[]
  label?: string
}) {
  if (!active || !payload?.length) return null

  const items = payload
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => Boolean(p))

  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      <div className="grid gap-1">
        {items.map((p, idx) => {
          const key = typeof p.dataKey === "string" ? p.dataKey : String(idx)
          const name =
            typeof p.name === "string"
              ? p.name
              : typeof p.dataKey === "string"
                ? p.dataKey
                : "Value"
          const value = p.value
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{name}</span>
              <span className="font-medium tabular-nums">{String(value ?? "")}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ChartContainer, ChartTooltipContent }

