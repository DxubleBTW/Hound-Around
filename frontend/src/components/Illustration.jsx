// Flat character illustrations for the action cards. Drawn for this app in a
// simple five-colour palette: plum hair, coral top, navy trousers, lavender
// devices, warm skin. Decorative only.
const C = { hair: '#7A2E52', top: '#EE6A47', pants: '#1F1D45', device: '#B8C2F2', deviceDark: '#7F8BD6', skin: '#F3B79C', shoe: '#EE6A47', shadow: 'rgb(0 0 0 / .08)' }

// Someone holding up their phone to snap the hallway.
function Snap() {
  return (
    <>
      <ellipse cx="66" cy="134" rx="30" ry="4" fill={C.shadow} />
      {/* back leg, bent */}
      <path d="M66 86 l-4 28 q-1 6 6 7 l14 2 q4 0 4 -4 l-1 -4 -12 -2 2 -26z" fill={C.pants} />
      <path d="M82 117 l10 1 q6 1 6 6 l-14 -1z" fill={C.shoe} />
      {/* front leg */}
      <path d="M58 86 h16 l-3 44 h-10z" fill={C.pants} />
      <path d="M60 128 h12 q8 0 8 5 v1 h-21z" fill={C.shoe} />
      {/* body */}
      <path d="M54 50 q2 -8 12 -8 h6 q10 0 12 10 l4 36 h-36z" fill={C.top} />
      {/* arms reaching up to the phone */}
      <path d="M58 54 q-14 -4 -22 -16 l6 -5 q8 10 20 12z" fill={C.top} />
      <path d="M78 52 q-6 -10 -26 -16 l2 -6 q22 4 30 16z" fill={C.top} />
      <circle cx="37" cy="33" r="4" fill={C.skin} />
      <circle cx="52" cy="31" r="4" fill={C.skin} />
      {/* phone, lens towards the hallway */}
      <rect x="36" y="16" width="15" height="25" rx="3" transform="rotate(-12 43 28)" fill={C.device} />
      <circle cx="41" cy="21" r="2" transform="rotate(-12 43 28)" fill={C.deviceDark} />
      {/* head */}
      <path d="M70 41 v-6 h6 v6z" fill={C.skin} />
      <ellipse cx="79" cy="21" rx="15" ry="13" fill={C.hair} />
      <circle cx="72" cy="25" r="10" fill={C.skin} />
      <path d="M64 20 q6 -10 18 -6 q-6 2 -10 8z" fill={C.hair} />
      <path d="M68 28 q2 2 4 0" stroke={C.pants} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <circle cx="68" cy="24" r="1" fill={C.pants} />
    </>
  )
}

// Someone checking the number on the sign beside a door.
function Sign() {
  return (
    <>
      <ellipse cx="62" cy="134" rx="40" ry="4" fill={C.shadow} />
      {/* door and its sign */}
      <rect x="10" y="30" width="34" height="104" rx="2" fill={C.deviceDark} opacity=".35" />
      <circle cx="38" cy="86" r="2" fill={C.pants} opacity=".5" />
      <rect x="48" y="44" width="22" height="14" rx="2.5" fill={C.device} />
      <path d="M53 49h7M53 53h11" stroke={C.pants} strokeWidth="1.6" strokeLinecap="round" />
      {/* legs */}
      <path d="M80 88 h14 l2 42 h-10z" fill={C.pants} />
      <path d="M94 88 l8 40 h-10 l-6 -40z" fill={C.pants} />
      <path d="M85 128 h12 q6 0 6 5 v1 h-18z" fill={C.shoe} />
      <path d="M93 126 h11 q6 0 6 5 v1 h-17z" fill={C.shoe} />
      {/* body and pointing arm */}
      <path d="M76 52 q2 -8 12 -8 h4 q10 0 12 10 l2 36 h-32z" fill={C.top} />
      <path d="M80 56 q-6 -2 -10 -4 l-8 -2 1 -6 10 2 q6 2 10 4z" fill={C.top} />
      <circle cx="62" cy="47" r="3.6" fill={C.skin} />
      {/* head, looking at the sign */}
      <path d="M86 43 v-6 h6 v6z" fill={C.skin} />
      <ellipse cx="95" cy="23" rx="14" ry="13" fill={C.hair} />
      <circle cx="88" cy="27" r="10" fill={C.skin} />
      <path d="M80 22 q6 -10 18 -6 q-6 2 -10 8z" fill={C.hair} />
      <circle cx="83" cy="26" r="1" fill={C.pants} />
      <path d="M83 31 q2 1.5 4 0" stroke={C.pants} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </>
  )
}

// Each scene with a frame cropped close to its figure.
const ART = { camera: [Snap, '26 8 80 130'], manual: [Sign, '6 22 110 116'] }

export default function Illustration({ name, className = '' }) {
  if (!ART[name]) return null
  const [Art, frame] = ART[name]
  return <svg viewBox={frame} className={className} aria-hidden><Art /></svg>
}
