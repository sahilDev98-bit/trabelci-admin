import { QueryClient } from "@tanstack/react-query"

const QUERY_STALE_TIME_MS = 60_000
const QUERY_RETRY_COUNT = 2
const MUTATION_RETRY_COUNT = 1

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      retry: QUERY_RETRY_COUNT,
    },
    mutations: {
      retry: MUTATION_RETRY_COUNT,
    },
  },
})

