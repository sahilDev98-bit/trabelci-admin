import { Suspense, lazy } from "react"
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import { Loader2Icon } from "lucide-react"

import { USER_ROLES } from "@/lib/roles"
import { AuthListener } from "@/components/AuthListener"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ThemeSync } from "@/components/ThemeSync"
import { LanguageSync } from "@/components/LanguageSync"
import { RequireAuth } from "@/routes/RequireAuth"
import { RequireRole } from "@/routes/RequireRole"
import { AdminLayout } from "@/layouts/AdminLayout"
import { Toaster } from "@/components/ui/sonner"

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then(m => ({ default: m.DashboardPage })))
const LoginPage = lazy(() => import("@/pages/auth/LoginPage").then(m => ({ default: m.LoginPage })))
const ForgotPasswordPage = lazy(() => import("@/pages/auth/ForgotPasswordPage").then(m => ({ default: m.ForgotPasswordPage })))
const CategoriesPage = lazy(() => import("@/pages/categories/CategoriesPage").then(m => ({ default: m.CategoriesPage })))
const BusinessPartnerDetailPage = lazy(() => import("@/pages/business-partners/BusinessPartnerDetailPage").then(m => ({ default: m.BusinessPartnerDetailPage })))
const BusinessPartnersPage = lazy(() => import("@/pages/business-partners/BusinessPartnersPage").then(m => ({ default: m.BusinessPartnersPage })))
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage").then(m => ({ default: m.SettingsPage })))
const NewUserPage = lazy(() => import("@/pages/users/NewUserPage").then(m => ({ default: m.NewUserPage })))
const UsersPage = lazy(() => import("@/pages/users/UsersPage").then(m => ({ default: m.UsersPage })))
const MerchantEmployeesPage = lazy(() => import("@/pages/merchant/MerchantEmployeesPage").then(m => ({ default: m.MerchantEmployeesPage })))
const ProductsPage = lazy(() => import("@/pages/products/ProductsPage").then(m => ({ default: m.ProductsPage })))
const ProductDetailPage = lazy(() => import("@/pages/products/ProductDetailPage").then(m => ({ default: m.ProductDetailPage })))
const ProductGroupsPage = lazy(() => import("@/pages/product-groups/ProductGroupsPage").then(m => ({ default: m.ProductGroupsPage })))
const ProductGroupManagePage = lazy(() => import("@/pages/product-groups/ProductGroupManagePage").then(m => ({ default: m.ProductGroupManagePage })))
const BPAssignmentsPage = lazy(() => import("@/pages/bp-assignments/BPAssignmentsPage").then(m => ({ default: m.BPAssignmentsPage })))
const EmployeeProductsPage = lazy(() => import("@/pages/employee/EmployeeProductsPage").then(m => ({ default: m.EmployeeProductsPage })))
const HomepagePage = lazy(() => import("@/pages/homepage/HomepagePage").then(m => ({ default: m.HomepagePage })))
const WhatsAppTemplatesPage = lazy(() => import("@/pages/whatsapp-templates/WhatsAppTemplatesPage").then(m => ({ default: m.WhatsAppTemplatesPage })))
const BrandingPage = lazy(() => import("@/pages/branding/BrandingPage").then(m => ({ default: m.BrandingPage })))
const FieldVisibilityPage = lazy(() => import("@/pages/field-visibility/FieldVisibilityPage").then(m => ({ default: m.FieldVisibilityPage })))
const SkuManagementPage = lazy(() => import("@/pages/sku-management/SkuManagementPage").then(m => ({ default: m.SkuManagementPage })))
const SkuNewCreationPage = lazy(() => import("@/pages/sku-management/SkuNewCreationPage").then(m => ({ default: m.SkuNewCreationPage })))
const SkuCleanupPage = lazy(() => import("@/pages/sku-management/SkuCleanupPage").then(m => ({ default: m.SkuCleanupPage })))
const SkuDropdownsPage = lazy(() => import("@/pages/sku-management/SkuDropdownsPage").then(m => ({ default: m.SkuDropdownsPage })))
const SkuTemplatesPage = lazy(() => import("@/pages/sku-management/SkuTemplatesPage").then(m => ({ default: m.SkuTemplatesPage })))
const CreatePdfPage = lazy(() => import("@/pages/create-pdf/CreatePdfPage").then(m => ({ default: m.CreatePdfPage })))
const PdfTemplateEditorPage = lazy(() => import("@/pages/create-pdf/PdfTemplateEditorPage").then(m => ({ default: m.PdfTemplateEditorPage })))

const SuspenseFallback = (
  <div className="flex min-h-screen items-center justify-center">
    <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
  </div>
)

const rootRoute = createRootRoute({
  component: () => (
    <ErrorBoundary>
      <ThemeSync />
      <LanguageSync />
      <AuthListener />
      <Toaster richColors closeButton />
      <Suspense fallback={SuspenseFallback}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  ),
  notFoundComponent: () => {
    throw redirect({ to: "/" })
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
})

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: () => (
    <RequireAuth>
      <AdminLayout />
    </RequireAuth>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" })
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/dashboard",
  component: DashboardPage,
})

const categoriesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/categories",
  component: CategoriesPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
  component: SettingsPage,
})

const usersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/users",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <UsersPage />
    </RequireRole>
  ),
})

const usersNewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/users/new",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <NewUserPage />
    </RequireRole>
  ),
})

const merchantEmployeesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/merchant/employees",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.MERCHANT]}>
      <MerchantEmployeesPage />
    </RequireRole>
  ),
})

const businessPartnersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/business-partners",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <BusinessPartnersPage />
    </RequireRole>
  ),
})

const businessPartnerDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/business-partners/$id",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <BusinessPartnerDetailPage />
    </RequireRole>
  ),
})

const productsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/products",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <ProductsPage />
    </RequireRole>
  ),
})

const productDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/products/$id",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <ProductDetailPage />
    </RequireRole>
  ),
})

const productGroupsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/product-groups",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <ProductGroupsPage />
    </RequireRole>
  ),
})

const productGroupDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/product-groups/$id",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <ProductGroupManagePage />
    </RequireRole>
  ),
})

const bpAssignmentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/bp-assignments",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <BPAssignmentsPage />
    </RequireRole>
  ),
})

const employeeProductsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/employee/products",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.EMPLOYEE, USER_ROLES.MERCHANT]}>
      <EmployeeProductsPage />
    </RequireRole>
  ),
})

const homepageRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/homepage",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <HomepagePage />
    </RequireRole>
  ),
})

const whatsappTemplatesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/whatsapp-templates",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <WhatsAppTemplatesPage />
    </RequireRole>
  ),
})

const brandingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/branding",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <BrandingPage />
    </RequireRole>
  ),
})

const fieldVisibilityRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/field-visibility",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <FieldVisibilityPage />
    </RequireRole>
  ),
})

const skuManagementRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sku-management",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <SkuManagementPage />
    </RequireRole>
  ),
})

const skuNewCreationRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sku-management/new",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <SkuNewCreationPage />
    </RequireRole>
  ),
})

const skuCleanupRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sku-management/cleanup",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <SkuCleanupPage />
    </RequireRole>
  ),
})

const skuDropdownsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sku-management/dropdowns",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <SkuDropdownsPage />
    </RequireRole>
  ),
})

const skuTemplatesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/sku-management/templates",
  component: () => (
    <RequireRole allowedRoles={[USER_ROLES.ADMIN]}>
      <SkuTemplatesPage />
    </RequireRole>
  ),
})

const createPdfRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/create-pdf",
  component: CreatePdfPage,
})

const pdfTemplateNewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/create-pdf/templates/new",
  component: PdfTemplateEditorPage,
})

const pdfTemplateEditRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/create-pdf/templates/$templateId",
  component: PdfTemplateEditorPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  appLayoutRoute.addChildren([
    indexRoute,
    dashboardRoute,
    categoriesRoute,
    settingsRoute,
    usersRoute,
    usersNewRoute,
    merchantEmployeesRoute,
    businessPartnersRoute,
    businessPartnerDetailRoute,
    productsRoute,
    productDetailRoute,
    productGroupsRoute,
    productGroupDetailRoute,
    bpAssignmentsRoute,
    employeeProductsRoute,
    homepageRoute,
    whatsappTemplatesRoute,
    brandingRoute,
    fieldVisibilityRoute,
    skuManagementRoute,
    skuNewCreationRoute,
    skuCleanupRoute,
    skuDropdownsRoute,
    skuTemplatesRoute,
    createPdfRoute,
    pdfTemplateNewRoute,
    pdfTemplateEditRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
})

export { loginRoute, productDetailRoute, businessPartnerDetailRoute, productGroupDetailRoute }

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
