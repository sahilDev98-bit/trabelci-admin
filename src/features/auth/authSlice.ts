import { createAsyncThunk, createSlice } from "@reduxjs/toolkit"
import type { PayloadAction } from "@reduxjs/toolkit"
import type { User } from "@supabase/supabase-js"

import { supabaseClient } from "@/lib/supabaseClient"
import { apiFetch } from "@/lib/apiClient"

export const AUTH_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  AUTHENTICATED: "authenticated",
  UNAUTHENTICATED: "unauthenticated",
} as const
import { normalizeRole } from "@/lib/roles"
import type { UserProfile } from "@/types/auth"

interface AuthState {
  user: User | null
  profile: UserProfile | null
  status: "idle" | "loading" | "authenticated" | "unauthenticated"
  error: string | null
}

const initialState: AuthState = {
  user: null,
  profile: null,
  status: AUTH_STATUS.IDLE,
  error: null,
}

async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabaseClient
    .from("user_profile")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const role = normalizeRole(data?.role)

  if (!role) {
    throw new Error("User does not have a valid role")
  }

  return {
    uid: data.user_id,
    email: data.email,
    displayName: data.display_name,
    role,
  }
}

// Records this login on user_profile.metadata (lastLogin/loginCount) —
// what powers the dashboard's "Active Accounts" chart (BUG-019). Before
// this, admin-web logins never wrote this field at all (only read it for
// display), and the mobile app's own writer was dead-locked behind a
// `loginCount > 0` guard that could never become true for anyone's first
// login — together, every account in production had lastLogin: null,
// loginCount: 0 regardless of actual usage. Best-effort: a failure here
// must never block a successful login.
async function recordLastLogin(userId: string): Promise<void> {
  try {
    const { data } = await supabaseClient
      .from("user_profile")
      .select("metadata")
      .eq("user_id", userId)
      .maybeSingle()

    const currentLoginCount = (data?.metadata as { loginCount?: number } | null)?.loginCount ?? 0
    const metadata = {
      ...(data?.metadata ?? {}),
      loginCount: currentLoginCount + 1,
      lastLogin: new Date().toISOString(),
    }

    await supabaseClient.from("user_profile").update({ metadata }).eq("user_id", userId)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("Failed to record last login", error)
    }
  }
}

export const loadCurrentUser = createAsyncThunk(
  "auth/loadCurrentUser",
  async (_, { rejectWithValue }) => {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabaseClient.auth.getSession()

      if (sessionError) {
        throw sessionError
      }

      if (!session?.user) {
        return {
          user: null as User | null,
          profile: null as UserProfile | null,
        }
      }

      const profile = await fetchUserProfile(session.user.id)

      return { user: session.user, profile }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error loading current user", error)
      }
      return rejectWithValue("Failed to load current user")
    }
  },
)

export const loginWithEmailPassword = createAsyncThunk(
  "auth/loginWithEmailPassword",
  async (payload: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: payload.email,
        password: payload.password,
      })

      if (error || !data.session || !data.user) {
        throw error ?? new Error("Invalid credentials")
      }

      let profile: UserProfile
      try {
        profile = await fetchUserProfile(data.user.id)
      } catch {
        await supabaseClient.auth.signOut()
        return rejectWithValue("Your account does not have a valid role.")
      }

      recordLastLogin(data.user.id)

      return { user: data.user, profile }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error during login", error)
      }

      // BUG-004: tell a deleted account apart from a plain wrong password.
      // Best-effort — if this check itself fails, fall back to the generic
      // message rather than blocking login feedback on it.
      try {
        const result = await apiFetch<{ deleted: boolean }>("/auth/check-deleted-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: payload.email }),
        })
        if (result.deleted) {
          return rejectWithValue("This account has been deactivated. Please contact your administrator.")
        }
      } catch {
        // fall through to the generic message below
      }

      return rejectWithValue("Failed to sign in. Please check your credentials.")
    }
  },
)

export const logout = createAsyncThunk("auth/logout", async () => {
  await supabaseClient.auth.signOut()
})

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setSessionFromListener(
      state,
      action: PayloadAction<{ session: unknown; user: User | null }>,
    ) {
      state.user = action.payload.user
      if (!action.payload.session) {
        state.profile = null
        state.status = AUTH_STATUS.UNAUTHENTICATED
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCurrentUser.pending, (state) => {
        // Only show loading on initial check, not on tab-switch re-checks
        if (state.status !== AUTH_STATUS.AUTHENTICATED) {
          state.status = AUTH_STATUS.LOADING
        }
        state.error = null
      })
      .addCase(loadCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload.user
        state.profile = action.payload.profile
        state.status = action.payload.user ? AUTH_STATUS.AUTHENTICATED : AUTH_STATUS.UNAUTHENTICATED
      })
      .addCase(loadCurrentUser.rejected, (state, action) => {
        state.status = AUTH_STATUS.UNAUTHENTICATED
        state.error = (action.payload as string) ?? "Failed to load current user"
        state.user = null
        state.profile = null
      })
      .addCase(loginWithEmailPassword.pending, (state) => {
        state.status = AUTH_STATUS.LOADING
        state.error = null
      })
      .addCase(loginWithEmailPassword.fulfilled, (state, action) => {
        state.user = action.payload.user
        state.profile = action.payload.profile
        state.status = AUTH_STATUS.AUTHENTICATED
      })
      .addCase(loginWithEmailPassword.rejected, (state, action) => {
        state.status = AUTH_STATUS.UNAUTHENTICATED
        state.error = (action.payload as string) ?? "Failed to sign in."
        state.user = null
        state.profile = null
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null
        state.profile = null
        state.status = AUTH_STATUS.UNAUTHENTICATED
        state.error = null
      })
  },
})

export const { setSessionFromListener } = authSlice.actions

export const authReducer = authSlice.reducer
