import { useState } from 'react'
import { destinationLabel } from '../lib/destinations.js'
import { destinationFloor } from '../lib/floors.js'
import Icon from '../components/Icon.jsx'
import FloorPicker from '../components/FloorPicker.jsx'
import { BottomBar, Button, TextAction, TopBar, focusRing } from '../components/ui.jsx'

// Manual locator: pick your floor on the building, then the place you're next to.
// Every listed place is a verified destination (lib/destinations.js) that the live
// /route also accepts as a start (checked 2026-10-25). A typed room is passed
// through for the backend to validate. A typed or chosen start is a routing
// choice, never a training label/correction.
const FLOOR_BY_NAME = { 'Lower level': 'B1', 'Floor 1': 'F1', 'Floor 2': 'F2' }

function placeFloor(item, roomLabels) {
  const code = destinationFloor(item.value, roomLabels).code
  if (code) return code
  return FLOOR_BY_NAME[item.floor] || FLOOR_BY_NAME[(item.label || '').split(' · ')[1]] || ''
}

export default function ManualStart({ onStart, onCancel, dest = '', accessible = false, roomLabels = {}, floors = [], groups = [], flyFrom = null }) {
  const [floor, setFloor] = useState('')
  const [start, setStart] = useState('')
  const [typed, setTyped] = useState('')
  const to = destinationLabel(dest, roomLabels)
  const chosenFloor = floors.find((f) => f.code === floor)
  const places = groups.flatMap((g) => g.items.map((item) => ({ item, g }))).filter(({ item }) => placeFloor(item, roomLabels) === floor)
  const from = typed.trim() || start
  const fromName = typed.trim()
    ? (/^[a-z]?\d+[a-z]?$/i.test(typed.trim()) ? `Room ${typed.trim().toUpperCase()}` : typed.trim())
    : (places.find(({ item }) => item.value === start)?.item.label || '').split(' · ')[0]
  const pickFloor = (code) => { setFloor(code); setStart(''); setTyped('') }

  return (
    <main className="flex flex-1 flex-col pb-32">
      <div className="arrive-late"><TopBar onBack={onCancel} backLabel="Back to the start screen" title="Manual locator" /></div>

      <header className="arrive-late mt-1 text-center">
        <p className="font-display text-[26px] font-bold leading-tight">
          <span key={floor || 'none'} className="value-in">{chosenFloor ? `Where on ${chosenFloor.name}?` : 'Which floor are you on?'}</span>
        </p>
        <p className="mt-1 text-[14px] text-dim">
          <span key={`d${floor}`} className="value-in value-in-late">{chosenFloor ? 'Choose what you’re standing next to.' : 'Tap your floor’s name beside the building.'}</span>
        </p>
      </header>

      <div className="relative -mx-5 mt-1 h-[min(380px,46vh)] text-fg">
        <FloorPicker floors={floors} selected={floor} onSelect={pickFloor} from={flyFrom} />
      </div>

      <p className="arrive-later mt-2 text-center text-[12px] text-faint">Drag the building to look up the tower. Floors 3 and up aren’t in this demo.</p>

      {chosenFloor && (
        <section key={floor} className="rise mt-6" aria-labelledby="near-title">
          <h2 id="near-title" className="text-[13px] font-semibold uppercase tracking-[.08em] text-dim">On {chosenFloor.name}</h2>
          <ul className="mt-1">
            {places.map(({ item, g }) => {
              const [title] = (item.label || '').split(' · ')
              const on = !typed.trim() && start === item.value
              return (
                <li key={item.value}>
                  <button type="button" onClick={() => { setStart(item.value); setTyped('') }} aria-pressed={on}
                    className={`-mx-2 flex min-h-[60px] w-[calc(100%+1rem)] items-center gap-4 rounded-2xl px-2 text-left transition-colors ${on ? 'bg-tint' : 'hover:bg-raise'} ${focusRing}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? 'pop bg-fg text-ink' : 'bg-raise text-dim'}`}><Icon name={g.icon || 'door'} size={20} /></span>
                    <span className="min-w-0 flex-1 border-b border-edge/70 py-3">
                      <span className="block text-[16px] font-semibold">{title}</span>
                      <span className="block text-[14px] text-dim">{[item.note, g.title !== title && g.title].filter(Boolean).join(' · ')}</span>
                    </span>
                    {on && <span className="pop shrink-0"><Icon name="check" size={20} strokeWidth={2.4} className="text-rose" /></span>}
                  </button>
                </li>
              )
            })}
          </ul>

          <label htmlFor="manual-start" className="mt-5 block text-[14px] font-semibold">Not listed? Type the number on the nearest door</label>
          <div className="glass mt-2 flex h-[52px] items-center gap-3 rounded-full px-4 focus-within:ring-2 focus-within:ring-fg">
            <Icon name="door" size={20} className="shrink-0 text-dim" />
            <input id="manual-start" value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="e.g. 263 or B62" inputMode="text" autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-dim" />
          </div>
          <p className="mt-4 flex items-center gap-2 text-[12px] text-dim"><Icon name="lock" size={14} />Typing a room doesn’t teach the photo matcher. Only a confirmed photo does.</p>
        </section>
      )}

      <TextAction onClick={onCancel} className="arrive-later mt-4 self-center">Use the camera instead</TextAction>

      <BottomBar>
        <div className="arrive-later">
        {from && to && (
          <p className="mb-2 text-center text-[14px] text-dim">
            From <span key={from} className="value-in font-semibold text-fg">{fromName}</span> <span aria-hidden>→</span> <span className="font-semibold text-fg">{to}</span>{accessible ? ', elevators only' : ''}
          </p>
        )}
        <Button onClick={() => from && onStart(from)} disabled={!from} className="w-full"><Icon name="walk" size={19} />Get directions</Button>
        </div>
      </BottomBar>
    </main>
  )
}
