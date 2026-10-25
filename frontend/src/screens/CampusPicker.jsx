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
    <main className="enter mx-auto flex min-h-screen max-w-md flex-col gap-6 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
      <div className="space-y-2.5">
        <h1 className="font-display text-[38px] font-semibold leading-[1.02]">Choose a building</h1>
        <p className="text-[17px] leading-snug text-mist">Hound Around only works inside buildings we’ve filmed. Tap a school, or drag its mascot onto the map.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Schools">
        {CAMPUSES.map((item) => {
          const selected = schoolId === item.id
          return (
            <button key={item.id} disabled={!available(item)} aria-pressed={selected}
              draggable={available(item)} onClick={() => choose(item.id)}
              onDragStart={(event) => event.dataTransfer.setData('application/x-hound-school', item.id)}
              onDragEnd={() => setDragging(false)}
              className={`press flex min-h-[64px] min-w-[150px] items-center gap-3 rounded-sm px-3.5 text-left font-bold disabled:opacity-50 ${selected ? 'bg-snow text-night' : 'bg-panel text-snow'}`}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="30" height="30" shapeRendering="crispEdges">
                <path fill={selected ? '#7A1F2B' : '#B0384A'} d="M2 2h3v3h6V2h3v9h-3v3H5v-3H2z" />
                <path fill={selected ? '#FFFFFF' : '#161616'} d="M5 6h2v2H5zm4 0h2v2H9zM7 10h2v2H7z" />
              </svg>
              <span>{item.name}{!available(item) && <span className="block text-xs font-normal">Not filmed yet</span>}</span>
            </button>
          )
        })}
      </div>
      <section aria-label="Illustrated campus selection map"
        onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-hound-school')) { event.preventDefault(); setDragging(true) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.getData('application/x-hound-school')) }}
        className={`relative flex min-h-[320px] flex-1 flex-col justify-end overflow-hidden rounded-[3px] bg-wine p-4 transition-shadow duration-200 ${dragging ? 'shadow-[inset_0_0_0_2px_#FFFFFF]' : ''}`}>
        <svg viewBox="0 0 350 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
          <path d="M-10 240 H90 L150 180 H360 M60 -10 V90 L120 150 V330 M360 60 H260 L200 120 V330" fill="none" stroke="#5A1824" strokeWidth="2" />
          <circle cx="120" cy="180" r="9" fill="#000" stroke="#fff" strokeWidth="3" />
          <circle cx="200" cy="180" r="6" fill="#000" stroke="#5A1824" strokeWidth="2.5" />
          <circle cx="200" cy="120" r="6" fill="#000" stroke="#5A1824" strokeWidth="2.5" />
        </svg>
        <p className="absolute left-4 top-3.5 text-xs text-mist">Illustration only, not a map</p>
        <p role="status" className="relative mb-3 font-display text-xl font-semibold">{dragging ? 'Drop to explore this school' : school.name}</p>
        {school.buildings.map((building) => {
          const config = buildingConfig(school.id, building.id, env)
          return (
            <button key={building.id} disabled={!config.available} onClick={() => onSelect(school.id, building.id)}
              className="press relative mb-2 flex min-h-[72px] items-center justify-between gap-3 rounded-[3px] bg-snow px-4 text-left text-night disabled:opacity-50">
              <span>
                <span className="block font-display text-[26px] font-semibold leading-none">{building.shortName || building.name}</span>
                <span className="mt-1 block text-sm text-[#4A4A4A]">{config.available ? building.name : `${building.name}. Not filmed yet.`}</span>
              </span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
            </button>
          )
        })}
      </section>
      <button onClick={onCancel} className="min-h-[44px] text-base underline underline-offset-[3px]">Back</button>
    </main>
  )
}
