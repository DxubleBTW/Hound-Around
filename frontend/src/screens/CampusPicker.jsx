import { useState } from 'react'
import { CAMPUSES, buildingConfig } from '../lib/campuses.js'

export default function CampusPicker({ current, env, onSelect, onCancel }) {
  const [schoolId, setSchoolId] = useState(current.schoolId)
  const [dragging, setDragging] = useState(false)
  const school = CAMPUSES.find((item) => item.id === schoolId) || CAMPUSES[0]
  const available = (item) => item.buildings.some((b) => buildingConfig(item.id, b.id, env)?.available)
  const choose = (id) => {
    const item = CAMPUSES.find((candidate) => candidate.id === id)
    if (item && available(item)) setSchoolId(id)
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-6">
      <h1 className="font-display text-3xl font-extrabold">Where are we exploring?</h1>
      <p className="mt-3 text-muted">Drag a mascot onto the map—or tap a school.</p>
      <div className="mt-6 flex gap-3 overflow-x-auto pb-3" aria-label="Schools">
        {CAMPUSES.map((item) => (
          <button key={item.id} disabled={!available(item)} aria-pressed={schoolId === item.id}
            draggable={available(item)} onClick={() => choose(item.id)}
            onDragStart={(event) => event.dataTransfer.setData('application/x-hound-school', item.id)}
            onDragEnd={() => setDragging(false)}
            className={`min-h-[88px] min-w-[140px] border-4 p-3 text-center font-semibold disabled:opacity-50 ${schoolId === item.id ? 'border-scarlet bg-scarlet/5' : 'border-line bg-white'}`}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="48" height="48" className="mx-auto mb-2 text-scarlet" shapeRendering="crispEdges">
              <path fill="currentColor" d="M2 2h3v3h6V2h3v9h-3v3H5v-3H2z" />
              <path fill="white" d="M5 6h2v2H5zm4 0h2v2H9zM7 10h2v2H7z" />
            </svg>
            {item.name}{!available(item) && <span className="block text-xs">Coming soon</span>}
          </button>
        ))}
      </div>
      <section aria-label="Illustrated campus selection map"
        onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-hound-school')) { event.preventDefault(); setDragging(true) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.getData('application/x-hound-school')) }}
        className={`mt-4 flex min-h-[300px] flex-col justify-center border-4 p-5 ${dragging ? 'border-scarlet' : 'border-line'}`}
        style={{ backgroundColor: '#eef2e1', backgroundImage: 'linear-gradient(#dbe4cb 1px,transparent 1px),linear-gradient(90deg,#dbe4cb 1px,transparent 1px)', backgroundSize: '24px 24px' }}>
        <p role="status" className="mb-4 font-display text-xl font-bold">{dragging ? 'Drop to explore a school' : school.name}</p>
        {school.buildings.map((building) => {
          const config = buildingConfig(school.id, building.id, env)
          return <button key={building.id} disabled={!config.available} onClick={() => onSelect(school.id, building.id)}
            className="mb-3 min-h-[64px] border-4 border-ink bg-paper p-4 text-left font-semibold shadow-[4px_4px_0_#1A1414] disabled:opacity-50">
            {config.available ? `Explore ${building.shortName || building.name}` : `${building.name} · Coming soon`}
            <span className="mt-1 block text-sm font-normal">{building.name}</span>
          </button>
        })}
        <p className="mt-4 text-xs text-muted">Illustrative scene, not a floor plan. Only configured buildings are available.</p>
      </section>
      <button onClick={onCancel} className="mt-auto min-h-[44px] py-4 font-semibold">Back to navigation</button>
    </main>
  )
}
