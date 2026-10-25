import SnapLogo from './SnapLogo.jsx'

// Full-screen loading while a photo is prepared or matched: your photo, dimmed,
// behind the snapping logo, with what's happening now.
export default function PhotoLoader({ photoUrl, title, detail, steps = [], flash = true }) {
  return (
    <div className="always-dark fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden bg-ink px-8 text-center" role="status" aria-live="polite">
      {photoUrl && <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 [filter:blur(6px)]" />}
      <span className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/80" aria-hidden />
      {photoUrl && <span className="scan-line absolute inset-x-0 h-0.5 bg-white/70" aria-hidden />}
      {flash && <span className="intro-flash pointer-events-none absolute inset-0 bg-white" aria-hidden />}
      <div className="relative flex flex-col items-center">
        <SnapLogo size={104} mode="loop" />
        <p className="font-display mt-7 text-[26px] font-bold"><span key={title} className="value-in">{title}</span></p>
        <p className="mt-1 max-w-[18rem] text-[15px] text-dim"><span key={detail} className="value-in value-in-late">{detail}</span></p>
        {steps.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2.5 text-left text-[14px]">
            {steps.map((s) => (
              <li key={s.label} className={`flex items-center gap-2.5 ${s.state === 'todo' ? 'text-faint' : ''}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${s.state === 'done' ? 'bg-fg text-ink' : 'bg-white/12'}`}>
                  {s.state === 'done'
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    : <span className={`h-1.5 w-1.5 rounded-full ${s.state === 'now' ? 'pulse-soft bg-fg' : 'bg-faint'}`} />}
                </span>
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
