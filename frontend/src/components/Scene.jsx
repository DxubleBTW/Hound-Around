// Photo backdrops for the section bars, seen through liquid glass. Purely decorative.
// Stock photos from Unsplash (free under the Unsplash License, no attribution
// required), resized to 720px and bundled so nothing loads from the network:
//   flag     classroom  unsplash.com/photos/1580582932707-520aed937b7b
//   book     bookshelf  unsplash.com/photos/1507842217343-583bb7270b66
//   coffee   food       unsplash.com/photos/1504674900247-0877df9cc836
//   restroom washroom   unsplash.com/photos/1552321554-5fefe8c9ef14
import flag from '../assets/places/flag.jpg'
import book from '../assets/places/book.jpg'
import coffee from '../assets/places/coffee.jpg'
import restroom from '../assets/places/restroom.jpg'

const PHOTOS = { flag, book, coffee, restroom }

export default function Scene({ name, className = '' }) {
  const src = PHOTOS[name]
  if (!src) return null
  return (
    <img src={src} alt="" aria-hidden loading="lazy" decoding="async"
      className={`pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover [filter:blur(1.5px)_saturate(1.1)] ${className}`} />
  )
}
