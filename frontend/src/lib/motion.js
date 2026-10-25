// Small helpers that respect the user's motion/haptics preferences.

const PAUSE_KEY = 'hound-motion-paused'

// The in-app "pause motion" button, remembered on this device. Storage can be
// blocked (private mode), so every access is guarded.
export function motionPaused() {
  try { return window.localStorage.getItem(PAUSE_KEY) === '1' } catch { return false }
}

export function setMotionPaused(paused) {
  try { window.localStorage.setItem(PAUSE_KEY, paused ? '1' : '0') } catch { /* storage blocked */ }
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = paused ? 'off' : 'on'
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off') return true
  if (!window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Short haptic tick where supported; silent no-op otherwise. Skipped when the
// user asked for reduced motion.
export function tick(pattern = 15) {
  if (prefersReducedMotion()) return
  try { navigator.vibrate?.(pattern) } catch { /* unsupported */ }
}
