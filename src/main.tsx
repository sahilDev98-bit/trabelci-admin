import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "react-redux"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { RouterProvider } from "@tanstack/react-router"

import "./index.css"
import "./i18n"
import { store } from "./store"
import { queryClient } from "./lib/queryClient"
import { router } from "./router"

// A deploy replaces every JS chunk with a new content-hashed filename. A tab
// left open across a deploy still holds the old chunk manifest, so clicking
// into any route it hasn't already loaded 404s on the now-deleted file —
// the click silently does nothing from the user's perspective. Vite fires
// this event in that exact case; reload once to pick up the new build
// rather than leaving the user on a half-broken page. Guarded with
// sessionStorage so a persistent failure (e.g. a real network outage)
// doesn't reload-loop the tab forever.
const PRELOAD_ERROR_RELOAD_KEY = "trabelci-admin:reloaded-after-preload-error"
window.addEventListener("vite:preloadError", () => {
  if (!sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY)) {
    sessionStorage.setItem(PRELOAD_ERROR_RELOAD_KEY, "1")
    window.location.reload()
  }
})
// Reaching this line means the current load's own chunks resolved fine, so
// any leftover flag is from an earlier deploy in this tab's history — clear
// it so a *later* deploy during this same session can still trigger a reload.
sessionStorage.removeItem(PRELOAD_ERROR_RELOAD_KEY)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
)
