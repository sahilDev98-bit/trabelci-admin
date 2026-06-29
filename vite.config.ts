import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const adminBackendUrl = env.VITE_ADMIN_API_BASE_URL || "http://localhost:3000"

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      watch: {
        // Python server writes output here — ignore to prevent spurious HMR reloads
        ignored: ["**/python-works/openai-output/**", "**/python-works/pdfs/**"],
      },
      proxy: {
        "/api": {
          target: adminBackendUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
