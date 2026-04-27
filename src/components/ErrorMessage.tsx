import { cn } from "@/lib/utils"

interface ErrorMessageProps {
  children: React.ReactNode
  className?: string
}

export function ErrorMessage({ children, className }: ErrorMessageProps) {
  return (
    <p className={cn("text-sm text-destructive", className)} role="alert">
      {children}
    </p>
  )
}
