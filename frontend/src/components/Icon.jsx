// One icon family: 24px grid, 1.75 stroke, round caps (drawn here, no emoji).
const paths = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  door: <><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21" /><path d="M4 21h16" /><circle cx="14.5" cy="12.5" r=".9" fill="currentColor" /></>,
  restroom: <><circle cx="7.5" cy="5" r="1.8" /><circle cx="16.5" cy="5" r="1.8" /><path d="M7.5 9v12M5 9.5h5v6H5zM16.5 21v-5M14 15l1.2-6h2.6l1.2 6z" /><path d="M12 3v18" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  bookmark: <path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  back: <path d="m14.5 6-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sign: <><rect x="3" y="6" width="18" height="11" rx="2" /><path d="M7 10h4M7 13h7" /></>,
  pin: <><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  elevator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9.5 9 2.5-2.5L14.5 9M9.5 15l2.5 2.5 2.5-2.5" /></>,
  school: <><path d="m3 9 9-5 9 5-9 5z" /><path d="M7 11.5V16c0 1.4 2.2 3 5 3s5-1.6 5-3v-4.5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>,
  coffee: <><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3.5c-.6 1 .6 1.6 0 2.6M12 3.5c-.6 1 .6 1.6 0 2.6" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".9" fill="currentColor" /></>,
  hallway: <><path d="M4 21 9.5 8h5L20 21" /><path d="M12 19v-6" /><path d="m9.8 15.2 2.2-2.2 2.2 2.2" /></>,
  hand: <><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v5M13 10V6a1.5 1.5 0 0 1 3 0v6" /><path d="M16 10.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 5 15l-1.4-2.6a1.5 1.5 0 0 1 2.6-1.5L7 12" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="m9 21 2.5-6.5M14.5 21l-1.5-5-2-3 1-4.5-3.5 2L7 12M12 8.5l2.5 3 3 1" /></>,
  flag: <><path d="M6 21V4M6 4h11l-2 4 2 4H6" /></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
}

export default function Icon({ name, size = 22, className = '', strokeWidth = 1.75 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  )
}
