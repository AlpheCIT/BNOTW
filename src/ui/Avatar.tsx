/**
 * Faces, drawn rather than downloaded.
 *
 * Every avatar is a handful of indices into fixed palettes, so a persona costs
 * a few bytes to store, renders identically everywhere, and needs no image
 * assets or network. A persona can carry a photo instead, and then the photo
 * wins.
 */

import { AVATAR_BG, AVATAR_HAIR_COLOR, AVATAR_SKIN, type AvatarSpec } from '../engine/persona'

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = clamp(((n >> 16) & 255) * amount)
  const g = clamp(((n >> 8) & 255) * amount)
  const b = clamp((n & 255) * amount)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function Hair({ style, color }: { style: number; color: string }) {
  const dark = shade(color, 0.75)
  switch (style) {
    case 0: // Bald — just a highlight on the crown.
      return <ellipse cx="45" cy="28" rx="7" ry="3.5" fill="#fff" opacity="0.12" />
    case 1: // Buzz
      return <path d="M29 40 A21 22 0 0 1 71 40 L71 36 A21 21 0 0 0 29 36 Z" fill={color} />
    case 2: // Short crop
      return (
        <g fill={color}>
          <path d="M28 42 A22 23 0 0 1 72 42 L72 33 A22 20 0 0 0 28 33 Z" />
          <path d="M28 40 q8 -9 22 -9 t22 9 l0 -6 q-10 -10 -22 -10 t-22 10 Z" fill={dark} />
        </g>
      )
    case 3: // Side part
      return (
        <g fill={color}>
          <path d="M28 41 A22 23 0 0 1 72 41 L72 32 A22 20 0 0 0 28 32 Z" />
          <path d="M40 22 q18 -3 31 12 l0 -8 q-12 -13 -31 -10 Z" fill={dark} />
        </g>
      )
    case 4: // Waves
      return (
        <g fill={color}>
          <path d="M27 44 A23 24 0 0 1 73 44 L73 34 A23 21 0 0 0 27 34 Z" />
          <path d="M27 38 q7 6 14 0 t14 0 t14 0 l0 -5 q-7 5 -14 0 t-14 0 t-14 0 Z" fill={dark} />
        </g>
      )
    case 5: // Curls
      return (
        <g fill={color}>
          {[[34, 26], [43, 21], [53, 20], [63, 25], [69, 33], [29, 34]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={8} />
          ))}
        </g>
      )
    case 6: // Long
      return (
        <g fill={color}>
          <path d="M25 72 q-2 -34 8 -44 q17 -12 34 0 q10 10 8 44 l-7 0 q3 -28 -5 -34 q-13 -9 -26 0 q-8 6 -5 34 Z" />
          <path d="M28 38 A22 21 0 0 1 72 38 L72 32 A22 20 0 0 0 28 32 Z" fill={dark} />
        </g>
      )
    default: // Top knot
      return (
        <g fill={color}>
          <circle cx="50" cy="17" r="7" />
          <path d="M29 40 A21 22 0 0 1 71 40 L71 35 A21 21 0 0 0 29 35 Z" />
        </g>
      )
  }
}

function Facial({ style, color, skin }: { style: number; color: string; skin: string }) {
  switch (style) {
    case 1: // Moustache
      return <path d="M42 56 q8 -4 16 0 q-8 3 -16 0 Z" fill={color} />
    case 2: // Goatee
      return (
        <g fill={color}>
          <path d="M43 56 q7 -3 14 0 q-7 3 -14 0 Z" />
          <path d="M44 62 q6 8 12 0 q-3 10 -12 0 Z" />
        </g>
      )
    case 3: // Full beard
      return (
        <g fill={color}>
          <path d="M29 46 q0 24 21 24 t21 -24 q0 18 -21 18 t-21 -18 Z" />
          <path d="M42 56 q8 -4 16 0 q-8 3 -16 0 Z" />
        </g>
      )
    case 4: // Stubble
      return (
        <path
          d="M29 46 q0 24 21 24 t21 -24 q0 18 -21 18 t-21 -18 Z"
          fill={shade(skin, 0.62)}
          opacity="0.55"
        />
      )
    default:
      return null
  }
}

function Accessory({ style, accent }: { style: number; accent: string }) {
  switch (style) {
    case 1: // Glasses
      return (
        <g fill="none" stroke="#20242a" strokeWidth="2">
          <circle cx="41" cy="44" r="7.5" fill="#cfe4f2" fillOpacity="0.35" />
          <circle cx="59" cy="44" r="7.5" fill="#cfe4f2" fillOpacity="0.35" />
          <path d="M48.5 44 h3" />
          <path d="M33.5 43 h-5" />
          <path d="M66.5 43 h5" />
        </g>
      )
    case 2: // Shades
      return (
        <g>
          <rect x="32" y="38" width="17" height="12" rx="3" fill="#15181c" />
          <rect x="51" y="38" width="17" height="12" rx="3" fill="#15181c" />
          <path d="M49 43 h2" stroke="#15181c" strokeWidth="2.5" />
          <path d="M32 41 h-4 M68 41 h4" stroke="#15181c" strokeWidth="2" />
          <path d="M34 40 l5 4" stroke="#fff" strokeWidth="1.5" opacity="0.35" />
        </g>
      )
    case 3: // Ball cap
      return (
        <g>
          <path d="M28 34 A22 22 0 0 1 72 34 L72 37 L28 37 Z" fill={accent} />
          <path d="M28 34 q-9 2 -11 7 l46 0 l0 -7 Z" fill={shade(accent, 0.78)} />
          <circle cx="50" cy="15" r="2.6" fill={shade(accent, 0.7)} />
        </g>
      )
    case 4: // Visor
      return (
        <g>
          <path d="M29 36 L71 36 L71 40 L29 40 Z" fill={accent} rx="2" />
          <path d="M29 36 q-10 3 -12 8 l50 0 l0 -8 Z" fill={shade(accent, 0.8)} opacity="0.95" />
        </g>
      )
    case 5: // Headphones
      return (
        <g>
          <path d="M27 44 A23 23 0 0 1 73 44" fill="none" stroke="#2a2f36" strokeWidth="4" />
          <rect x="21" y="40" width="9" height="15" rx="4" fill="#2a2f36" />
          <rect x="70" y="40" width="9" height="15" rx="4" fill="#2a2f36" />
          <rect x="23" y="43" width="5" height="9" rx="2.5" fill={accent} />
          <rect x="72" y="43" width="5" height="9" rx="2.5" fill={accent} />
        </g>
      )
    default:
      return null
  }
}

export function Avatar({
  spec, size = 40, alt = '', ring,
}: {
  spec: AvatarSpec
  size?: number
  alt?: string
  /** Optional ring colour, used to mark the acting seat. */
  ring?: string
}) {
  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'block',
    flex: '0 0 auto',
    boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
  } as const

  if (spec.photo) {
    return <img src={spec.photo} alt={alt} style={{ ...style, objectFit: 'cover' }} />
  }

  const bg = AVATAR_BG[spec.bg % AVATAR_BG.length]
  const skin = AVATAR_SKIN[spec.skin % AVATAR_SKIN.length]
  const hair = AVATAR_HAIR_COLOR[spec.hairColor % AVATAR_HAIR_COLOR.length]

  return (
    <svg viewBox="0 0 100 100" style={style} role="img" aria-label={alt || 'Player avatar'}>
      <circle cx="50" cy="50" r="50" fill={bg} />
      <circle cx="50" cy="50" r="50" fill="url(#av-shine)" opacity="0.18" />
      <defs>
        <radialGradient id="av-shine" cx="35%" cy="22%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* shoulders */}
      <ellipse cx="50" cy="104" rx="33" ry="27" fill={shade(bg, 0.6)} />
      <ellipse cx="50" cy="104" rx="33" ry="27" fill="#000" opacity="0.12" />

      {/* neck */}
      <path d="M43 58 h14 v14 q-7 5 -14 0 Z" fill={shade(skin, 0.85)} />

      {/* ears */}
      <circle cx="28" cy="47" r="4.6" fill={skin} />
      <circle cx="72" cy="47" r="4.6" fill={skin} />

      {/* head */}
      <ellipse cx="50" cy="44" rx="21.5" ry="24" fill={skin} />

      <Facial style={spec.facial} color={hair} skin={skin} />

      {/* brows */}
      <rect x="35" y="37" width="12" height="2.6" rx="1.3" fill={shade(hair, 0.8)} />
      <rect x="53" y="37" width="12" height="2.6" rx="1.3" fill={shade(hair, 0.8)} />

      {/* eyes */}
      <ellipse cx="41" cy="44" rx="2.7" ry="3.2" fill="#22262b" />
      <ellipse cx="59" cy="44" rx="2.7" ry="3.2" fill="#22262b" />
      <circle cx="42" cy="43" r="0.9" fill="#fff" opacity="0.85" />
      <circle cx="60" cy="43" r="0.9" fill="#fff" opacity="0.85" />

      {/* nose and mouth */}
      <path d="M50 46 q-2.5 5 0 6.5" fill="none" stroke={shade(skin, 0.78)} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M44 59 q6 4.5 12 0" fill="none" stroke={shade(skin, 0.55)} strokeWidth="2" strokeLinecap="round" />

      <Hair style={spec.hair} color={hair} />
      <Accessory style={spec.accessory} accent={AVATAR_BG[(spec.bg + 3) % AVATAR_BG.length]} />
    </svg>
  )
}
