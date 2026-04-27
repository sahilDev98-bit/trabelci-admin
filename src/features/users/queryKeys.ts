export const usersQueryKeys = {
  all: ["users"] as const,
  byId: (uid: string) => ["users", "byId", uid] as const,
} as const

