import { Suspense, useState } from "react"
import { Link, Outlet, useLocation } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboardIcon,
  UsersIcon,
  LayersIcon,
  SettingsIcon,
  Loader2Icon,
  PanelLeftIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
  StoreIcon,
  PackageIcon,
  FolderTreeIcon,
  UserCheckIcon,
  ChevronDownIcon,
  ShoppingBagIcon,
  BuildingIcon,
  UserIcon,
  HomeIcon,
  MessageSquareIcon,
  PaletteIcon,
  EyeIcon,
  ScanBarcodeIcon,
  FileTextIcon,
  SparklesIcon,
} from "lucide-react"

import { useQueryClient } from "@tanstack/react-query"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { cn } from "@/lib/utils"
import { useAppDispatch, useAppSelector } from "@/store"
import { logout } from "@/features/auth/authSlice"
import { THEME, setTheme, toggleSidebar } from "@/features/ui/uiSlice"
import { USER_ROLES } from "@/lib/roles"
import { ROUTES } from "@/lib/routes"

// ---------------------------------------------------------------------------
// Sidebar dimensions
// ---------------------------------------------------------------------------

const SIDEBAR_COLLAPSED_WIDTH = "72px"
const SIDEBAR_EXPANDED_WIDTH = "260px"

const NAV_LINK_BASE =
  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"

// ---------------------------------------------------------------------------
// Nav config — labels are translation keys under "nav."
// ---------------------------------------------------------------------------

interface NavLeaf {
  type: "link"
  to: string
  icon: LucideIcon
  labelKey: string
  adminOnly?: boolean
  merchantOnly?: boolean
  nonAdminOnly?: boolean
  superUserOnly?: boolean
}

interface NavGroup {
  type: "group"
  key: string
  icon: LucideIcon
  labelKey: string
  adminOnly?: boolean
  nonAdminOnly?: boolean
  superUserOnly?: boolean
  children: NavLeaf[]
}

type NavEntry = NavLeaf | NavGroup

const navEntries: NavEntry[] = [
  { type: "link", to: ROUTES.DASHBOARD, icon: LayoutDashboardIcon, labelKey: "nav.dashboard" },
  { type: "link", to: ROUTES.HOMEPAGE, icon: HomeIcon, labelKey: "nav.homepage", adminOnly: true, superUserOnly: true },
  {
    type: "group",
    key: "catalog",
    icon: ShoppingBagIcon,
    labelKey: "nav.catalog",
    adminOnly: true,
    children: [
      { type: "link", to: ROUTES.PRODUCTS, icon: PackageIcon, labelKey: "nav.products", adminOnly: true },
      { type: "link", to: ROUTES.PRODUCT_GROUPS, icon: FolderTreeIcon, labelKey: "nav.productGroups", adminOnly: true },
      { type: "link", to: ROUTES.CATEGORIES, icon: LayersIcon, labelKey: "nav.categories" },
    ],
  },
  {
    type: "group",
    key: "employee-catalog",
    icon: ShoppingBagIcon,
    labelKey: "nav.catalog",
    nonAdminOnly: true,
    children: [
      { type: "link", to: ROUTES.EMPLOYEE_PRODUCTS, icon: PackageIcon, labelKey: "nav.products", nonAdminOnly: true },
    ],
  },
  {
    type: "group",
    key: "business",
    icon: BuildingIcon,
    labelKey: "nav.business",
    adminOnly: true,
    children: [
      { type: "link", to: ROUTES.BUSINESS_PARTNERS, icon: StoreIcon, labelKey: "nav.businessPartners", adminOnly: true },
      { type: "link", to: ROUTES.BP_ASSIGNMENTS, icon: UserCheckIcon, labelKey: "nav.bpAssignments", adminOnly: true },
    ],
  },
  { type: "link", to: ROUTES.USERS, icon: UsersIcon, labelKey: "nav.users", adminOnly: true },
  { type: "link", to: ROUTES.MERCHANT_EMPLOYEES, icon: UserIcon, labelKey: "nav.employees", merchantOnly: true },
  { type: "link", to: ROUTES.WHATSAPP_TEMPLATES, icon: MessageSquareIcon, labelKey: "nav.whatsappTemplates", adminOnly: true, superUserOnly: true },
  { type: "link", to: ROUTES.BRANDING, icon: PaletteIcon, labelKey: "nav.branding", adminOnly: true, superUserOnly: true },
  { type: "link", to: ROUTES.FIELD_VISIBILITY, icon: EyeIcon, labelKey: "nav.fieldVisibility", adminOnly: true },
  {
    type: "group",
    key: "sku",
    icon: ScanBarcodeIcon,
    labelKey: "nav.skuManagement",
    adminOnly: true,
    children: [
      { type: "link", to: ROUTES.SKU_MANAGEMENT_NEW, icon: PackageIcon, labelKey: "nav.skuNew", adminOnly: true },
      { type: "link", to: ROUTES.SKU_MANAGEMENT_CLEANUP, icon: LayersIcon, labelKey: "nav.skuCleanup", adminOnly: true },
      { type: "link", to: ROUTES.SKU_MANAGEMENT_DROPDOWNS, icon: FolderTreeIcon, labelKey: "nav.skuDropdowns", adminOnly: true },
      { type: "link", to: ROUTES.SKU_MANAGEMENT_TEMPLATES, icon: SettingsIcon, labelKey: "nav.skuTemplates", adminOnly: true },
    ],
  },
  { type: "link", to: ROUTES.CREATE_PDF, icon: FileTextIcon, labelKey: "nav.createPdf" },
  { type: "link", to: ROUTES.CREATE_PDF_AI_IMAGES, icon: SparklesIcon, labelKey: "nav.generateAiImages" },
  { type: "link", to: ROUTES.SETTINGS, icon: SettingsIcon, labelKey: "nav.settings" },
]

// ---------------------------------------------------------------------------
// Sidebar link
// ---------------------------------------------------------------------------

function SidebarNavLink({
  to,
  icon: Icon,
  label,
  collapsed,
  indent = false,
}: {
  to: string
  icon: LucideIcon
  label: string
  collapsed: boolean
  indent?: boolean
}) {
  return (
    <Link
      to={to as string}
      className={cn(
        NAV_LINK_BASE,
        collapsed && "justify-center px-2",
        indent && !collapsed && "ps-9",
      )}
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
      inactiveProps={{ className: "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground" }}
    >
      <Icon className="size-4" />
      {!collapsed ? <span>{label}</span> : null}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Collapsible group
// ---------------------------------------------------------------------------

function SidebarGroup({
  entry,
  collapsed,
  isOpen,
  onToggle,
  isAdmin,
  isNonAdmin,
}: {
  entry: NavGroup
  collapsed: boolean
  isOpen: boolean
  onToggle: () => void
  isAdmin: boolean
  isNonAdmin: boolean
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const visibleChildren = entry.children.filter(
    (c) => (!c.adminOnly || isAdmin) && (!c.nonAdminOnly || isNonAdmin),
  )

  if (visibleChildren.length === 0) return null

  const isChildActive = visibleChildren.some((c) => location.pathname.startsWith(c.to))
  const Icon = entry.icon

  if (collapsed) {
    return (
      <Link
        to={visibleChildren[0].to as string}
        className={cn(
          NAV_LINK_BASE,
          "justify-center px-2",
          isChildActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
        activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
      >
        <Icon className="size-4" />
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          NAV_LINK_BASE,
          "w-full justify-between",
          isChildActive
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
      >
        <span className="flex items-center gap-3">
          <Icon className="size-4" />
          <span>{t(entry.labelKey)}</span>
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform duration-200",
            isOpen ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-0.5 pt-0.5">
            {visibleChildren.map((child) => (
              <SidebarNavLink
                key={child.to}
                to={child.to}
                icon={child.icon}
                label={t(child.labelKey)}
                collapsed={false}
                indent
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function AdminLayout() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { sidebarCollapsed, theme } = useAppSelector((s) => s.ui)
  const profile = useAppSelector((s) => s.auth.profile)
  const isAdmin = profile?.role === USER_ROLES.ADMIN
  const isMerchant = profile?.role === USER_ROLES.MERCHANT
  const isSuperUser = profile?.email === "rafel1995@gmail.com"

  // Auto-open groups whose children are active on mount
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const entry of navEntries) {
      if (entry.type === "group") {
        const hasActiveChild = entry.children.some((c) =>
          location.pathname.startsWith(c.to),
        )
        if (hasActiveChild) initial.add(entry.key)
      }
    }
    return initial
  })

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[auto_1fr]">
        <aside
          className="sticky top-0 h-screen border-e border-border/60 bg-sidebar text-sidebar-foreground"
          style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}
        >
          <div className="flex h-full flex-col">
            {/* Sidebar header */}
            <div className={`flex items-center gap-2 px-3 py-3 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
              <div className={cn("flex items-center gap-2", sidebarCollapsed && "justify-center")}>
                <div className="grid size-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <span className="text-sm font-semibold">T</span>
                </div>
                {!sidebarCollapsed ? (
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm font-semibold">{t("common.appName")}</span>
                    <span className="text-xs text-muted-foreground">{t("common.admin")}</span>
                  </div>
                ) : null}
              </div>
              {!sidebarCollapsed ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-sidebar-foreground/80 hover:text-sidebar-foreground"
                  onClick={() => dispatch(toggleSidebar())}
                >
                  <PanelLeftIcon />
                  <span className="sr-only">{t("common.toggleSidebar")}</span>
                </Button>
              ) : null}
            </div>

            {/* Navigation */}
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
              {navEntries.map((entry) => {
                if (entry.type === "link") {
                  if (entry.adminOnly && !isAdmin) return null
                  if (entry.merchantOnly && !isMerchant) return null
                  if (entry.nonAdminOnly && isAdmin) return null
                  if (entry.superUserOnly && !isSuperUser) return null
                  return (
                    <SidebarNavLink
                      key={entry.to}
                      to={entry.to}
                      icon={entry.icon}
                      label={t(entry.labelKey)}
                      collapsed={sidebarCollapsed}
                    />
                  )
                }

                if (entry.adminOnly && !isAdmin) return null
                if (entry.nonAdminOnly && isAdmin) return null
                if (entry.superUserOnly && !isSuperUser) return null
                return (
                  <SidebarGroup
                    key={entry.key}
                    entry={entry}
                    collapsed={sidebarCollapsed}
                    isOpen={openGroups.has(entry.key)}
                    onToggle={() => toggleGroup(entry.key)}
                    isAdmin={isAdmin}
                    isNonAdmin={!isAdmin}
                  />
                )
              })}
            </nav>

            {/* User footer */}
            <div className="px-3 py-3">
              <Separator className="mb-3 opacity-70" />
              <div className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
                <div className="grid size-9 place-items-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground">
                  <span className="text-xs font-semibold">
                    {(profile?.displayName ?? profile?.email ?? "U").slice(0, 1).toUpperCase()}
                  </span>
                </div>
                {!sidebarCollapsed ? (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {profile?.displayName ?? t("common.user")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="min-w-0">
          <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
            {sidebarCollapsed ? (
              <Button
                className="absolute top-3.5 start-3.5"
                variant="ghost"
                size="icon"
                onClick={() => dispatch(toggleSidebar())}
              >
                <PanelLeftIcon />
                <span className="sr-only">{t("common.expandSidebar")}</span>
              </Button>
            ) : null}
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
              <div className="flex items-center gap-3">
                <Breadcrumb>
                  <BreadcrumbList>
                    {(() => {
                      const isId = (s: string) =>
                        /^\d+$/.test(s) ||
                        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

                      const segments = location.pathname.split("/").filter(Boolean)
                      return segments.map((segment, idx) => {
                        const path = "/" + segments.slice(0, idx + 1).join("/")
                        const label = isId(segment)
                          ? t("breadcrumb.details")
                          : t(`breadcrumb.${segment}`, segment)
                        const isLast = idx === segments.length - 1

                        return (
                          <BreadcrumbItem key={path}>
                            {idx > 0 ? <BreadcrumbSeparator /> : null}
                            {isLast ? (
                              <BreadcrumbPage>{label}</BreadcrumbPage>
                            ) : (
                              <BreadcrumbLink asChild>
                                <Link to={path as string}>{label}</Link>
                              </BreadcrumbLink>
                            )}
                          </BreadcrumbItem>
                        )
                      })
                    })()}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>

              <div className="flex items-center gap-2">
                <LanguageSwitcher />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => dispatch(setTheme(theme === THEME.DARK ? THEME.LIGHT : THEME.DARK))}
                >
                  {theme === THEME.DARK ? <SunIcon /> : <MoonIcon />}
                  <span className="sr-only">{t("common.toggleTheme")}</span>
                </Button>
                <Button variant="ghost" size="icon" onClick={() => { queryClient.clear(); dispatch(logout()) }}>
                  <LogOutIcon />
                  <span className="sr-only">{t("common.signOut")}</span>
                </Button>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl p-6">
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  )
}
