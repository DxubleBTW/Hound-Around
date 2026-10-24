// Keep network failures readable without exposing raw server/proxy responses.
export class ApiError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryable = retryable
  }
}

function responseError(status, operation) {
  const messages = {
    410: 'This photo has expired or was already corrected. Take another photo to teach this spot again.',
    413: 'The photo is too large. Take another photo and try again.',
    415: 'This photo format is not supported. Try a JPEG or PNG photo.',
    429: 'Too many attempts. Wait a minute before trying again.',
    503: 'The service is not ready yet. Wait a moment and try again.',
  }
  if (status === 404 && operation === 'route') {
    return new ApiError('No route is available for this destination and route setting. Try another destination.', { status })
  }
  if (status === 422) {
    const message = operation === 'locate'
      ? 'We could not read this photo. Take another photo and try again.'
      : operation === 'route'
        ? 'We could not use this location or destination. Check the room number or take another photo.'
        : 'We could not use that correction. Choose another spot or take a new photo.'
    return new ApiError(message, { status })
  }
  return new ApiError(messages[status] || (status >= 500
    ? 'The service had a problem. Please try again.'
    : 'The request could not be completed. Please try again.'), {
    status, retryable: status === 429 || status >= 500,
  })
}

export async function requestJson(url, {
  signal, timeoutMs = 8000, operation, ...options
} = {}) {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) throw responseError(response.status, operation)
    try {
      const data = await response.json()
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      if (!validResponse(data, operation)) throw new Error('Incomplete response')
      return data
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new ApiError('The service returned an unreadable response. Please try again.', { retryable: true })
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (timedOut) {
      throw new ApiError('This is taking too long. Check your connection and try again.', { retryable: true })
    }
    if (error instanceof ApiError) throw error
    throw new ApiError('Could not connect. Check your Wi-Fi or mobile data and try again.', { retryable: true })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

function validResponse(data, operation) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const spot = (value) => typeof value === 'string' && value.length > 0
  const nonnegative = (value) => Number.isFinite(value) && value >= 0
  if (operation === 'locate') {
    return spot(data.photo_id) && spot(data.spot) && [-1, 1, 2].includes(data.floor)
      && (data.heading === null || spot(data.heading))
      && nonnegative(data.confidence) && data.confidence <= 1
      && (data.ocr_room === null || spot(data.ocr_room))
      && (data.ocr_floor === null || [-1, 1, 2].includes(data.ocr_floor))
      && nonnegative(data.ms)
      && Array.isArray(data.top3) && data.top3.length > 0 && data.top3.length <= 3
      && data.top3.every((vote) => vote && spot(vote.spot) && Number.isInteger(vote.votes) && vote.votes >= 0)
  }
  if (operation === 'route') {
    return Array.isArray(data.steps) && nonnegative(data.total_meters) && nonnegative(data.est_seconds)
      && data.steps.every((step) => step && spot(step.node) && spot(step.instruction) && nonnegative(step.meters))
  }
  if (operation === 'correct') return data.ok === true && Number.isInteger(data.index_size) && data.index_size >= 0
  return true
}

// Mock requests honor cancellation too, including when navigating away.
export function delay(ms, value, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'))
    const cancel = () => {
      clearTimeout(timeout)
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve(value)
    }, ms)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
