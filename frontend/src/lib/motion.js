// Small helpers that respect the user's motion/haptics preferences.

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Short haptic tick where supported; silent no-op otherwise. Skipped when the
// user asked for reduced motion.
export function tick(pattern = 15) {
  if (prefersReducedMotion()) return
  try { navigator.vibrate?.(pattern) } catch { /* unsupported */ }
}
