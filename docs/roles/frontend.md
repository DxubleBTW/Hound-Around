# Front-end lead

You own the phone web app: four screens, fast and clear on a phone in a hallway. Design is 10 points, and you also
own the demo moment judges will hold in their hands.

## Stack

React + Vite + Tailwind on Vercel, or Lovable (there's a Best Use of Lovable prize; the workshop is at 1:15).
Build against the API in `docs/contract.md`. Backend will have a stub running before noon, so don't wait for the real model.

## The four screens

1. **Snap**: one big button. `<input type="file" accept="image/*" capture="environment">`. Resize to ~512 px wide
   on the phone and strip EXIF (canvas re-encode does both) before upload. If the image is blurry or blank, ask the
   user to step back and point down the hall or at a room number.
2. **Locate**: "Sending… Matching…" with a ~8 s timeout and retry. Never show a stale result. Show the spot name and floor.
   If `confidence < 0.6` or the top 3 span floors, show the **top-3 picker** instead of a single answer.
3. **Route**: a room picker (type "164" or "262"), an accessible-mode toggle (no stairs), and numbered turn-by-turn
   steps with meters and a time estimate. Show only the next steps: never a full building map.
4. **Confirm**: "Right spot?" Yes / No. No opens the top-3 picker (plus "none of these" with a spot list), which
   calls `POST /correct`. Show "Thanks, it learned that" with the new `index_size`.

## Design direction

- Near-black background, monochrome, one accent (BU red) only for "you are here" and the route.
- Fonts: Space Grotesk or Inter for the UI; Instrument Serif for huge room numbers.
- Numbered step pills: 1 Snap / 2 Locate / 3 Route / 4 Confirm.
- Big tap targets and readable at arm's length. Respect reduced motion. Accessible mode is easy to find, not buried.

## Timeline

- Before noon: sketch the 4 screens, set up the Vite (or Lovable) project and the Vercel deploy.
- 1:15: Lovable workshop.
- 12:15–3: wire the screens to the stub API, with mock JSON if the stub isn't up yet.
- 3–6: switch to the real Space URL, test on 2–3 real phones (iPhone Safari and Android Chrome) on event Wi-Fi and cellular.
- 6–8: polish, loading states, error states, empty states.
- Night: screenshots and a screen recording for the pitch video.

## Stretch (only after the core loop works on real phones)

A 3D cloud of blurred hallway thumbnails where the nearest matches fly forward when you snap, so the search is
visible. Use a 2D fallback on weak phones.

## Done means

- A stranger can go from photo to directions on their own phone without help, in under 30 s.
- The deployed Vercel link is in the README and on Devpost.

## Don'ts

- No GPS or location permission prompts, ever.
- Don't show floor plans, the graph, or a building map.
- Don't store photos in the browser after upload.
