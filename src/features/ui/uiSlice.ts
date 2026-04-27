import { createSlice } from "@reduxjs/toolkit"
import type { PayloadAction } from "@reduxjs/toolkit"

export type ThemeMode = "dark" | "light"

export const THEME = {
  DARK: "dark",
  LIGHT: "light",
} as const

const UI_STORAGE_KEY = "ui-state"

interface UiState {
  sidebarCollapsed: boolean
  theme: ThemeMode
}

function loadUiState(): UiState {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
        theme: parsed.theme === THEME.LIGHT || parsed.theme === THEME.DARK ? parsed.theme : THEME.DARK,
      }
    }
  } catch {
    // ignore corrupt data
  }
  return { sidebarCollapsed: false, theme: THEME.DARK }
}

function persistUiState(state: UiState) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota errors
  }
}

const initialState: UiState = loadUiState()

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed
      persistUiState(state)
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload
      persistUiState(state)
    },
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload
      persistUiState(state)
    },
  },
})

export const { toggleSidebar, setSidebarCollapsed, setTheme } = uiSlice.actions

export const uiReducer = uiSlice.reducer

