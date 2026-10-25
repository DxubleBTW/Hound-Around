// Shared controls in one everyday-app vocabulary: pill buttons, chips, a white
// bottom sheet with a grab handle, and a top bar with a back button.
import Icon from './Icon.jsx'

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg'

export function Button({ variant = 'primary', className = '', children, ...props }) {
  const base = `inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-[background-color,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${focus}`
  const look = {
    primary: 'lg-bright',
    tonal: 'lg text-fg',
    secondary: 'lg text-fg',
    quiet: 'text-rose hover:bg-tint',
  }[variant]
  return <button className={`${base} ${look} ${className}`} {...props}>{children}</button>
}

export function TextAction({ className = '', children, ...props }) {
  return (
    <button className={`min-h-[44px] rounded-full px-3 text-[15px] font-semibold text-fg underline decoration-fg/35 underline-offset-4 hover:decoration-fg disabled:opacity-40 ${focus} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Chip({ selected = false, icon, className = '', children, ...props }) {
  return (
    <button type="button" aria-pressed={selected}
      className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors ${selected ? 'lg-bright' : 'lg text-fg'} [-webkit-backdrop-filter:none] [backdrop-filter:none] ${focus} ${className}`} {...props}>
      {icon && <Icon name={selected && icon === 'elevator' ? 'check' : icon} size={17} strokeWidth={selected ? 2.4 : 1.9} />}
      {children}
    </button>
  )
}

// The white sheet that holds a screen's content, rising from the bottom.
export function Sheet({ className = '', children }) {
  return (
    <section className={`glass-strong -mx-5 mt-4 flex flex-1 flex-col rounded-t-[30px] border-b-0 px-5 pb-36 pt-2 ${className}`}>
      <span aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-fg/25" />
      {children}
    </section>
  )
}

// Actions pinned above the home indicator, on the sheet's white.
export function BottomBar({ children }) {
  return (
    <div className="glass-strong fixed inset-x-0 bottom-0 z-20 border-x-0 border-b-0">
      <div className="mx-auto flex max-w-md flex-col gap-1 px-5 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  )
}

export function TopBar({ title, onBack, backLabel = 'Back' }) {
  return (
    <div className="flex min-h-[56px] items-center gap-2">
      {onBack && (
        <button onClick={onBack} aria-label={backLabel} className={`lg -ml-1 flex h-11 w-11 items-center justify-center rounded-full ${focus}`}>
          <Icon name="back" size={24} />
        </button>
      )}
      {title && <p className="truncate text-[18px] font-semibold">{title}</p>}
    </div>
  )
}

export const focusRing = focus
