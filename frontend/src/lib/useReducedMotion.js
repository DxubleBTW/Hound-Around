import { useSyncExternalStore } from 'react'
import { prefersReducedMotion, subscribeMotion } from './motion.js'

export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false)
}
