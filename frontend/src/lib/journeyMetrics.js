// Page-memory aggregates only. No photos, places, identifiers, history, storage,
// or network transmission. "Ready" means a usable route response, not arrival.
const LIMITS_MS = [500, 1000, 2000, 4000, 8000, 16000, 30000, 60000]

export class JourneyMetrics {
  constructor(now = () => performance.now()) {
    this.now = now
    this.active = null
    this.counts = { photoJourneysStarted: 0, routesReady: 0, withoutRetake: 0, afterRejection: 0, viaManualFallback: 0, retakes: 0 }
    this.timings = Array(LIMITS_MS.length + 1).fill(0)
  }

  begin(startedAt = this.now()) {
    if (!this.active) {
      this.active = { startedAt, retaken: false, rejected: false, manual: false }
      this.counts.photoJourneysStarted++
    }
  }

  rejected() { if (this.active) this.active.rejected = true }
  manual() { if (this.active) this.active.manual = true }
  retake() {
    if (this.active) {
      this.active.retaken = true
      this.counts.retakes++
    }
  }

  ready() {
    if (!this.active) return
    const duration = Math.max(0, this.now() - this.active.startedAt)
    if (!Number.isFinite(duration)) return
    const index = LIMITS_MS.findIndex((limit) => duration <= limit)
    this.timings[index < 0 ? LIMITS_MS.length : index]++
    this.counts.routesReady++
    this.counts.withoutRetake += Number(!this.active.retaken)
    this.counts.afterRejection += Number(this.active.rejected)
    this.counts.viaManualFallback += Number(this.active.manual)
    this.active = null
  }

  cancel() { this.active = null }
  snapshot() { return { ...this.counts, bucketsMs: [...LIMITS_MS], photoToRoute: [...this.timings] } }
}

export const journeyMetrics = new JourneyMetrics()
if (typeof window !== 'undefined' && import.meta.env?.VITE_LOCAL_METRICS === '1') {
  window.houndMetrics = () => journeyMetrics.snapshot()
}
