import { switchTheme, useTheme } from '../lib/theme.js'

// Sun / moon switch: the knob slides across and the new theme spreads out from it
// (lib/theme.js). Remembered on this phone.
const Sun = () => <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
const Moon = () => <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
const glyph = (Shape, size) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><Shape /></svg>
)

export default function ThemeSwitch() {
  const dark = useTheme() === 'dark'
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        switchTheme(dark ? 'light' : 'dark', { x: dark ? r.left + 14 : r.right - 14, y: r.top + r.height / 2 })
      }}
      className="press relative my-auto mr-1 h-[30px] w-[54px] shrink-0 rounded-full bg-panel ring-1 ring-rule">
      <span className={`absolute left-[8px] top-1/2 -translate-y-1/2 text-mist transition-opacity duration-300 ${dark ? 'opacity-60' : 'opacity-0'}`}>{glyph(Sun, 13)}</span>
      <span className={`absolute right-[8px] top-1/2 -translate-y-1/2 text-mist transition-opacity duration-300 ${dark ? 'opacity-0' : 'opacity-60'}`}>{glyph(Moon, 13)}</span>
      <span aria-hidden className={`absolute top-[3px] grid h-[24px] w-[24px] place-items-center rounded-full bg-snow text-night shadow transition-[left] duration-300 ease-[cubic-bezier(.45,0,.2,1)] ${dark ? 'left-[27px]' : 'left-[3px]'}`}>
        {glyph(dark ? Moon : Sun, 13)}
      </span>
    </button>
  )
}
