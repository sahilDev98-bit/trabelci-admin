let pending = 0
const listeners = new Set<() => void>()

export function beginLoad() {
  pending++
}

export function endLoad() {
  pending = Math.max(0, pending - 1)
  if (pending === 0) listeners.forEach((l) => l())
}

export function isIdle() {
  return pending === 0
}

export function onIdle(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
