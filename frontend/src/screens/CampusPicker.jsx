import { useState } from 'react'
import { CAMPUSES, buildingConfig } from '../lib/campuses.js'
import Icon from '../components/Icon.jsx'
import { TextAction, focusRing } from '../components/ui.jsx'

// Public descriptions only: no floor plans, graph or private data.
const ABOUT = {
  'bu:cds': { address: '665 Comm Ave', floors: 'Lower level, Floor 1 and Floor 2 are mapped. More floors and buildings join as we film them.' },
}

export default function CampusPicker({ current, env, onSelect, onCancel }) {
  const [schoolId, setSchoolId] = useState(current.schoolId)
  const school = CAMPUSES.find((item) => item.id === schoolId) || CAMPUSES[0]
  const available = (item) => item.buildings.some((b) => buildingConfig(item.id, b.id, env)?.available)
  return (
    <main className="rise mx-auto flex min-h-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-[28px] font-bold leading-tight">Choose a building</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-dim">Hound Around only works inside buildings we’ve filmed.</p>

      {CAMPUSES.length > 1 && (
        <div className="mt-6 flex gap-2 overflow-x-auto" role="group" aria-label="Schools">
          {CAMPUSES.map((item) => (
            <button key={item.id} disabled={!available(item)} aria-pressed={schoolId === item.id} onClick={() => setSchoolId(item.id)}
              className={`min-h-[44px] shrink-0 rounded-full border px-4 text-[14px] disabled:opacity-40 ${schoolId === item.id ? 'border-fg bg-fg text-ink font-bold' : 'border-edge'} ${focusRing}`}>
              {item.name}{!available(item) && ' · Coming soon'}
            </button>
          ))}
        </div>
      )}

      <section className="mt-8">
        <p className="flex items-center gap-2 text-[14px] font-bold"><Icon name="school" size={18} className="text-rose" />{school.name}</p>
        <ul className="mt-3 space-y-2">
          {school.buildings.map((building) => {
            const config = buildingConfig(school.id, building.id, env)
            const about = ABOUT[`${school.id}:${building.id}`]
            return (
              <li key={building.id}>
                <button disabled={!config.available} onClick={() => onSelect(school.id, building.id)}
                  className={`flex min-h-[76px] w-full items-center gap-3 rounded-3xl bg-card px-5 py-4 text-left shadow-[var(--shadow-float)] transition hover:shadow-md disabled:text-dim ${focusRing}`}>
                  <span className="min-w-0 flex-1">
                    <span className="font-display block text-[20px] font-bold leading-tight">{building.shortName || building.name}</span>
                    <span className="block text-[14px] text-dim">{building.name}{about ? `, ${about.address}` : ''}{!config.available ? ' · Coming soon' : ''}</span>
                  </span>
                  <Icon name="back" size={22} className="shrink-0 rotate-180 text-rose" />
                </button>
                {about && <p className="mt-3 text-[14px] leading-relaxed text-dim">{about.floors}</p>}
              </li>
            )
          })}
        </ul>
      </section>

      <TextAction onClick={onCancel} className="mt-auto self-start">Back to navigation</TextAction>
    </main>
  )
}
