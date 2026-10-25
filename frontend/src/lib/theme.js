// Light and dark mode. The choice is remembered on this phone; until you pick,
// the app follows the phone's own setting (index.html applies it before the first
// paint). Switching reveals the new theme in a circle from where you tapped.
import { useEffect, useState } from 'react'

const KEY = 'hound.theme'
const BG = { dark: '#0B0B0C', light: '#F1F1EE' }

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

function apply(theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.background = BG[theme]
  window.dispatchEvent(new CustomEvent('hound-theme', { detail: theme }))
}

// `from` is the point to grow the reveal from, e.g. the switch's centre.
export function switchTheme(theme, from) {
  try { localStorage.setItem(KEY, theme) } catch { /* not remembered, still switches */ }
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (still) return apply(theme)
  if (document.startViewTransition) {
    const x = from?.x ?? window.innerWidth / 2, y = from?.y ?? 0
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const t = document.startViewTransition(() => apply(theme))
    t.ready.then(() => document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 600, easing: 'cubic-bezier(.45,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
    )).catch(() => {})
    return
  }
  const root = document.documentElement
  root.classList.add('theme-fade')
  apply(theme)
  setTimeout(() => root.classList.remove('theme-fade'), 450)
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const on = (e) => setTheme(e.detail)
    window.addEventListener('hound-theme', on)
    return () => window.removeEventListener('hound-theme', on)
  }, [])
  return theme
}
