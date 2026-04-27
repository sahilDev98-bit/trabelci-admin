export const bpAssignmentKeys = {
  all: ["bpAssignments"] as const,
  assignments: (bpId: string) => [...bpAssignmentKeys.all, "assignments", bpId] as const,
  effectiveProducts: (bpId: string) => [...bpAssignmentKeys.all, "effectiveProducts", bpId] as const,
} as const
