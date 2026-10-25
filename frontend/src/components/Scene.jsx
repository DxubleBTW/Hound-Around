// Photo backdrops for the section bars, seen through glass. Purely decorative.
// Stock photos from Unsplash's CDN (lib/stockPhotos.js).
import { stockPhoto } from '../lib/stockPhotos.js'

const flag = stockPhoto('classroom', 640)
const book = stockPhoto('bookshelf', 640)
const coffee = stockPhoto('food', 640)
const restroom = stockPhoto('washroom', 640)

const PHOTOS = { flag, book, coffee, restroom }

export default function Scene({ name, className = '' }) {
  const src = PHOTOS[name]
  if (!src) return null
  return (
    <img src={src} alt="" aria-hidden loading="lazy" decoding="async"
      className={`pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover [filter:blur(1.5px)_saturate(1.1)] ${className}`} />
  )
}
