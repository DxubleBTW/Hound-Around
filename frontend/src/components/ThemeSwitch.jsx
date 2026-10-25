import Icon from './Icon.jsx'
import { focusRing } from './ui.jsx'
import { switchTheme, useTheme } from '../lib/theme.js'

// Sun / moon switch: the knob slides across and the app changes theme from there.
export default function ThemeSwitch({ className = '' }) {
  const dark = useTheme() === 'dark'
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        switchTheme(dark ? 'light' : 'dark', { x: dark ? r.left + 16 : r.right - 16, y: r.top + r.height / 2 })
      }}
      className={`lg relative h-[38px] w-[68px] shrink-0 rounded-full ${focusRing} ${className}`}>
      <Icon name="sun" size={15} className={`absolute left-[11px] top-1/2 -translate-y-1/2 transition-opacity duration-300 ${dark ? 'opacity-40' : 'opacity-0'}`} />
      <Icon name="moon" size={15} className={`absolute right-[11px] top-1/2 -translate-y-1/2 transition-opacity duration-300 ${dark ? 'opacity-0' : 'opacity-40'}`} />
      <span aria-hidden className={`absolute top-[4px] flex h-[28px] w-[28px] items-center justify-center rounded-full bg-fg text-ink shadow transition-[left] duration-300 ease-[cubic-bezier(.45,0,.2,1)] ${dark ? 'left-[34px]' : 'left-[4px]'}`}>
        <Icon name={dark ? 'moon' : 'sun'} size={15} strokeWidth={2} />
      </span>
    </button>
  )
}
