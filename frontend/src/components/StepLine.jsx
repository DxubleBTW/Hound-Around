// The four steps drawn as a transit line, in the order the app actually runs:
// Snap → Locate → Confirm → Route. Done stations fill maroon, the current one is
// a white ring, upcoming ones stay grey.
const STOPS = ['Snap', 'Locate', 'Confirm', 'Route']

export default function StepLine({ current = 0 }) {
  return (
    <div role="img" aria-label={`Step ${current + 1} of ${STOPS.length}: ${STOPS[current]}`}
      className="relative grid grid-cols-4 text-center text-xs">
      <span aria-hidden className="absolute left-[12.5%] right-[12.5%] top-[5px] h-[2px] bg-rule" />
      <span aria-hidden className="track-fill absolute left-[12.5%] right-[12.5%] top-[5px] h-[2px] bg-maroon-line"
        style={{ transform: `scaleX(${current / (STOPS.length - 1)})` }} />
      {STOPS.map((stop, i) => (
        <span key={stop} aria-hidden className="relative flex flex-col items-center gap-1.5">
          <span className={`box-border h-3 w-3 rounded-full transition-colors duration-300 ${
            i < current ? 'bg-maroon-line' : i === current ? 'border-[3px] border-snow bg-night' : 'border-2 border-rule bg-night'}`} />
          <span className={i === current ? 'font-bold text-snow' : i < current ? 'text-mist' : 'text-dim'}>{stop}</span>
        </span>
      ))}
    </div>
  )
}
