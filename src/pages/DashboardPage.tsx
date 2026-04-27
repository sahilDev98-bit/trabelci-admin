import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Check, Percent, Pencil } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { useUsersQuery } from "@/features/users/api"
import { useMerchantDashboardStatsQuery, useEmployeeDashboardStatsQuery, useMerchantPriceMultiplierQuery, useUpdateMerchantPriceMultiplierMutation } from "@/features/dashboard/api"
import { USER_ROLES } from "@/lib/roles"
import { useAppSelector } from "@/store"
import type { UserRole } from "@/types/auth"

export function DashboardPage() {
  const { t } = useTranslation()
  const profile = useAppSelector((s) => s.auth.profile)
  const role = profile?.role

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {role === USER_ROLES.ADMIN
            ? t("dashboard.adminSubtitle")
            : t("dashboard.welcomeBack", { name: profile?.displayName ?? t("common.user") })}
        </p>
      </header>

      {role === USER_ROLES.ADMIN ? (
        <AdminDashboard />
      ) : role === USER_ROLES.MERCHANT ? (
        <MerchantDashboard />
      ) : (
        <EmployeeDashboard />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type KpiItem = { title: string; value: number; description: string }

const GRID_COLS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
}

function KpiCards({ items, isLoading }: { items: KpiItem[]; isLoading: boolean }) {
  return (
    <div className={`grid gap-4 ${GRID_COLS[items.length] ?? "md:grid-cols-3"}`}>
      {items.map((item) => (
        <Card key={item.title} className="bg-card/70">
          <CardHeader className="pb-2">
            <CardDescription>{item.title}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {isLoading ? "—" : item.value.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ActivityChart({
  data,
  rangeDays,
  onRangeChange,
  title,
  description,
  rangeLabels,
}: {
  data: { date: string; active: number }[]
  rangeDays: 90 | 30 | 7
  onRangeChange: (days: 90 | 30 | 7) => void
  title: string
  description: string
  rangeLabels: { days: 90 | 30 | 7; label: string }[]
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {rangeLabels.map((opt) => (
            <Button
              key={opt.days}
              variant={rangeDays === opt.days ? "secondary" : "outline"}
              size="sm"
              onClick={() => onRangeChange(opt.days)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            active: {
              label: "Active",
              color: "var(--chart-2)",
            },
          }}
          className="h-[320px] w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(value) => String(value).slice(5)}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <Tooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="active"
                name="Active"
                stroke="var(--color-active)"
                fill="var(--color-active)"
                fillOpacity={0.25}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function buildTimeSeries(
  loginDates: (string | null | undefined)[],
  rangeDays: number,
) {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - (rangeDays - 1))
  start.setHours(0, 0, 0, 0)

  const dayKey = (d: Date) => d.toISOString().slice(0, 10)

  const buckets = new Map<string, number>()
  for (let i = 0; i < rangeDays; i += 1) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    buckets.set(dayKey(d), 0)
  }

  for (const raw of loginDates) {
    if (!raw) continue
    const d = new Date(String(raw))
    if (Number.isNaN(d.getTime())) continue
    d.setHours(0, 0, 0, 0)
    if (d < start) continue
    const key = dayKey(d)
    if (!buckets.has(key)) continue
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  return Array.from(buckets.entries()).map(([date, active]) => ({ date, active }))
}

// ---------------------------------------------------------------------------
// Admin Dashboard
// ---------------------------------------------------------------------------

function AdminDashboard() {
  const { t } = useTranslation()
  const { data: users, isLoading } = useUsersQuery()
  const [rangeDays, setRangeDays] = useState<90 | 30 | 7>(90)

  const counts = useMemo(() => {
    const list = users ?? []
    const byRole: Record<UserRole, number> = { [USER_ROLES.ADMIN]: 0, [USER_ROLES.MERCHANT]: 0, [USER_ROLES.EMPLOYEE]: 0 }
    for (const u of list) byRole[u.role] += 1
    return { total: list.length, ...byRole }
  }, [users])

  const series = useMemo(() => {
    const logins = (users ?? []).map((u) => u.metadata?.lastLogin)
    return buildTimeSeries(logins, rangeDays)
  }, [rangeDays, users])

  const kpi: KpiItem[] = [
    { title: t("dashboard.totalUsers"), value: counts.total, description: t("dashboard.allAccounts") },
    { title: t("dashboard.admins"), value: counts.ADMIN, description: t("dashboard.adminAccounts") },
    { title: t("dashboard.merchants"), value: counts.MERCHANT, description: t("dashboard.merchantAccounts") },
    { title: t("dashboard.employeesKpi"), value: counts.EMPLOYEE, description: t("dashboard.employeeAccounts") },
  ]

  const rangeLabels = [
    { days: 90 as const, label: t("dashboard.last3Months") },
    { days: 30 as const, label: t("dashboard.last30Days") },
    { days: 7 as const, label: t("dashboard.last7Days") },
  ]

  return (
    <>
      <KpiCards items={kpi} isLoading={isLoading} />
      <ActivityChart
        data={series}
        rangeDays={rangeDays}
        onRangeChange={setRangeDays}
        title={t("dashboard.activeAccounts")}
        description={t("dashboard.activeAccountsDesc")}
        rangeLabels={rangeLabels}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Merchant Dashboard
// ---------------------------------------------------------------------------

const MULTIPLIER_PRESETS = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]

/** Round UP to the next integer ending in 9, only if last digit > 0. Numbers ending in 0 stay as-is. */
function roundUpToNine(value: number): number {
  const integer = Math.ceil(value)
  const lastDigit = integer % 10
  if (lastDigit === 0 || lastDigit === 9) return integer
  return integer + (9 - lastDigit)
}

function MerchantDashboard() {
  const { t } = useTranslation()
  const { data: stats, isLoading } = useMerchantDashboardStatsQuery()
  const { data: currentMultiplier, isLoading: multiplierLoading } = useMerchantPriceMultiplierQuery()
  const multiplierMutation = useUpdateMerchantPriceMultiplierMutation()
  const [rangeDays, setRangeDays] = useState<90 | 30 | 7>(90)
  const [customMultiplier, setCustomMultiplier] = useState("")
  const [showCustomInput, setShowCustomInput] = useState(false)

  const multiplier = currentMultiplier ?? 1.0

  const handleMultiplierChange = (value: string) => {
    setShowCustomInput(false)
    setCustomMultiplier("")
    multiplierMutation.mutate(Number(value))
  }

  const handleCustomSubmit = () => {
    const val = parseFloat(customMultiplier)
    if (Number.isFinite(val) && val >= 1.0 && val <= 10.0) {
      multiplierMutation.mutate(val)
      setShowCustomInput(false)
      setCustomMultiplier("")
    }
  }

  const series = useMemo(() => {
    const logins = (stats?.employees ?? []).map((e) => e.metadata?.lastLogin)
    return buildTimeSeries(logins, rangeDays)
  }, [rangeDays, stats])

  const kpi: KpiItem[] = [
    { title: t("dashboard.employeesKpi"), value: stats?.totalEmployees ?? 0, description: t("dashboard.employeesInBusiness") },
    { title: t("dashboard.productsKpi"), value: stats?.totalProducts ?? 0, description: t("dashboard.productsAssigned") },
  ]

  const rangeLabels = [
    { days: 90 as const, label: t("dashboard.last3Months") },
    { days: 30 as const, label: t("dashboard.last30Days") },
    { days: 7 as const, label: t("dashboard.last7Days") },
  ]

  return (
    <>
      {/* Price Multiplier Card */}
      <Card className="bg-card/70 overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Percent className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Price Multiplier</CardTitle>
              <CardDescription className="text-xs">
                Apply a profit margin to customer prices
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          {/* Current Value Display */}
          <div className="flex items-center gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground">Active Multiplier</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                {multiplierLoading ? "—" : `${multiplier}x`}
              </p>
            </div>
            {!multiplierLoading && multiplier > 1.0 && (
              <Badge variant="default" className="text-xs">
                +{Math.round((multiplier - 1) * 100)}% margin
              </Badge>
            )}
            {!multiplierLoading && multiplier === 1.0 && (
              <Badge variant="secondary" className="text-xs">
                No markup
              </Badge>
            )}
          </div>

          {/* Preset Buttons */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Quick Select</p>
            <div className="flex flex-wrap gap-2">
              {MULTIPLIER_PRESETS.map((preset) => {
                const isActive = !multiplierLoading && multiplier === preset && !showCustomInput
                return (
                  <Button
                    key={preset}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className="min-w-[60px] tabular-nums"
                    onClick={() => handleMultiplierChange(String(preset))}
                    disabled={multiplierLoading || multiplierMutation.isPending}
                  >
                    {isActive && <Check className="mr-1 size-3" />}
                    {preset}x
                  </Button>
                )
              })}
              <Button
                variant={showCustomInput || (!multiplierLoading && !MULTIPLIER_PRESETS.includes(multiplier)) ? "default" : "outline"}
                size="sm"
                className="min-w-[60px]"
                onClick={() => setShowCustomInput(!showCustomInput)}
                disabled={multiplierLoading || multiplierMutation.isPending}
              >
                <Pencil className="mr-1 size-3" />
                Custom
              </Button>
            </div>
          </div>

          {/* Custom Input */}
          {(showCustomInput || (!multiplierLoading && !MULTIPLIER_PRESETS.includes(multiplier))) && (
            <div className="flex items-end gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="grid flex-1 gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Custom Value (1.0 – 10.0)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="1"
                  max="10"
                  placeholder="e.g. 1.35"
                  className="bg-background"
                  value={customMultiplier || (!MULTIPLIER_PRESETS.includes(multiplier) ? String(multiplier) : "")}
                  onChange={(e) => setCustomMultiplier(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit() }}
                  autoFocus
                />
              </div>
              <Button onClick={handleCustomSubmit} disabled={multiplierMutation.isPending}>
                {multiplierMutation.isPending ? "Saving..." : "Apply"}
              </Button>
              <Button variant="outline" onClick={() => { setShowCustomInput(false); setCustomMultiplier("") }}>
                Cancel
              </Button>
            </div>
          )}

          {/* Example Preview */}
          {!multiplierLoading && multiplier > 1.0 && (
            <div className="rounded-lg border border-dashed bg-muted/10 px-4 py-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">₪ 100.00</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold">₪ {roundUpToNine(100 * multiplier).toFixed(2)}</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-muted-foreground">₪ 56.00</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold">₪ {roundUpToNine(56 * multiplier).toFixed(2)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <KpiCards items={kpi} isLoading={isLoading} />
      <ActivityChart
        data={series}
        rangeDays={rangeDays}
        onRangeChange={setRangeDays}
        title={t("dashboard.employeeActivity")}
        description={t("dashboard.employeeActivityDesc")}
        rangeLabels={rangeLabels}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Employee Dashboard
// ---------------------------------------------------------------------------

function EmployeeDashboard() {
  const { t } = useTranslation()
  const { data: stats, isLoading } = useEmployeeDashboardStatsQuery()

  const kpi: KpiItem[] = [
    { title: t("dashboard.productsKpi"), value: stats?.totalProducts ?? 0, description: t("dashboard.productsAssigned") },
  ]

  return <KpiCards items={kpi} isLoading={isLoading} />
}
