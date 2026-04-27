import { useEffect } from "react"

import { supabaseClient } from "@/lib/supabaseClient"
import { useAppDispatch } from "@/store"
import { loadCurrentUser, setSessionFromListener } from "@/features/auth/authSlice"

export function AuthListener() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const { data } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      dispatch(setSessionFromListener({ session, user: session?.user ?? null }))
      dispatch(loadCurrentUser())
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [dispatch])

  return null
}

