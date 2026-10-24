# Frontend ideas (draft, pick what fits the clock)

Scoring: Design 15%, Ethics 10%, and the live demo carries Technical Execution. Ideas are ranked by demo payoff per hour.

## Must-have polish (before 3 PM go/no-go)
1. **Hallway landmarks in the result.** "You're at the east hallway, by the red couches." graph.json already has `landmark`. Needs `label`/`landmark` in `/locate` (contract change, ask the team) or a public-safe label map served by the backend.
2. **Big-type step card with a turn arrow.** Parse the instruction for left/right/straight/elevator/stairs and show a large arrow icon. Readable at arm's length while walking.
3. **"Learned" moment that lands on stage.** After a correction, a short paw-print burst + "Index: 2,213 → 2,214 photos". Uses `index_size` from `/correct`. This is the line judges remember.
4. **Haptics.** `navigator.vibrate(30)` on step advance and arrival (Android; iOS ignores it harmlessly).

## Strong extras
5. **Re-snap mid-route to re-sync.** "Lost? Snap again" keeps the destination and reroutes from the new spot (wired already; could auto-advance to the matching step instead of restarting).
6. **Floor-change interstitial.** When a step has `vertical: true`, show a full screen "Take the tower elevator to LL" with the floor badge changing, since floor changes are where people get lost.
7. **Room-sign confirmation.** When `ocr_room` comes back, show "Saw sign: Room 248 ✓" as extra trust, and in the picker float the option whose floor matches `ocr_floor`.
8. **Accessible mode as a first-class theme.** Larger text, high-contrast, elevator icon in the header, and speak each step with `speechSynthesis` (screen-reader friendly, no extra dependency).
9. **Offline-friendly shell.** Cache the app shell so the page loads on weak event Wi-Fi; only `/locate` needs the network.

## Stretch (only if everything above works)
10. **3D photo cloud** (from the brief): a Three.js view of frame embeddings by spot for the pitch slide, not for users (it would leak the building layout).
11. **Live accuracy panel** for judges at `/stats`: top-1 / top-3 / floor accuracy from the test set plus latency, pulled from the accuracy script's JSON.
12. **QR code on the demo slide** that opens the Vercel link with `?to=164`, so a judge's phone lands straight on the camera with the destination pre-filled.

## Deliberately not doing (ethics)
- No floor-plan view or mini-map for users. The brief says users only see their next turn.
- No location history, no "recent places".
- No geolocation prompt, ever.

## Open questions for the team
- Do we want a human-readable `label` in `/locate` and route `steps`? Node ids like `F2_hall_e2` are formatted client-side for now.
- Room list for autocomplete: can the backend expose public room numbers only (not the graph)?
- Lovable prize: rebuild one screen in Lovable and link it, or skip?
