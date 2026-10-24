# Hound Around: team plan (Sat Oct 24 – Sun Oct 25)

Read this first, then your role file. Paste both into your AI tool (Claude Code, Kiro, Lovable) as context,
together with `CLAUDE.md` and `docs/contract.md`.

| Role | File | Owner |
| --- | --- | --- |
| Data lead | [data.md](data.md) | _name_ |
| ML lead | [ml.md](ml.md) | _name_ |
| Backend lead | [backend.md](backend.md) | David |
| Front-end lead | [frontend.md](frontend.md) | _name_ |
| Product and pitch lead | [pitch.md](pitch.md) | _name_ |

## The project in one breath

Snap a photo in the CDS building (665 Comm Ave). Hound Around recognizes the hallway spot and floor, then routes you
to your room, with an accessible mode that avoids stairs. If it's wrong, you tap the right spot and it learns.

Core loop, which nobody is allowed to break: **photo → spot → route → correction.**

## How the pieces connect

```
Data lead ──frames + labels.csv──▶ ML lead ──index.npz + locate()──▶ Backend ──/locate /route /correct──▶ Front end
    │                                 ▲                                  ▲
    └──test photos (outsiders)────────┘                                  └── graph.json + rooms.json (Backend)
Pitch lead: interviews, timing test, slides, video, Devpost. Pulls numbers from ML, screenshots from Front end.
```

`docs/contract.md` is law. If you need to change a field name or add an endpoint, ask the whole team first.

## Scope

- One building, floors **B1 (lower level), F1, F2** only. The event has no access to floor 3+.
- A phone web page, not a native app.
- Location comes only from the photo: no GPS, no Wi-Fi positioning, no tracking.

## Rubric (from the organizers' email)

| Criterion | Points | Who carries it |
| --- | --- | --- |
| Impact | 25 | Pitch (interviews, timing test), everyone |
| Data Science Application | 25 | ML (experiments, test-set accuracy). "Calling an API/LLM alone doesn't count." |
| Technical | 20 | Backend + ML (working deployed demo) |
| Design | 10 | Front end |
| Ethics | 10 | Backend (slide), Data (blurring), Pitch (Ethics Genius Bar) |
| Presentation | 10 | Pitch |

We're also targeting the $500 BU Libraries Data Ethics & Literacy prize, and Best Use of Lovable if the front end uses it.

## Timeline

| When | What | Where |
| --- | --- | --- |
| Sat 10:00–10:30 | Opening | Room 164 (F1) |
| 10:40–12:15 | Team formation. Data lead films F2 | |
| 11:15 | Workshops: Figma with AI, Kiro | |
| 12:15 | Lunch. Recruit outside test photographers | |
| 1:15 | Workshops: Lovable (front end), Vision AI (ML), RAG/MCP/Agents | |
| **3:00 PM** | **Go/no-go: at least 7 of 10 outsider photos right.** If not, lean on room-sign OCR | |
| 3–8 PM | Build. Dinner 6:30 | Hacking rooms 262–265, B62–B64 |
| 6:00 PM | Hackachusetts call (needs Kiro; deadline 8 PM) | |
| 7 PM | Building closes to the public; wristband needed after | |
| 8:15 PM | Evening session. Devpost project must exist by tonight | Room 164 |
| 10 PM | BU students can't re-enter after this. Sleeping rooms 262/263 | |
| Sun 10:00 AM | **Our submission deadline** (official: 11:00) | Devpost |
| Sun 11:30 | Presentations, 4-minute hard limit | |

Mentors, the Ethics Genius Bar and librarians are in the basement yellow space.

## Cut order if we're behind

Cut first: map snippet → "hallway changed" button → extra spots.
**Never cut:** the test-set accuracy number, the experiments table, and the live correction moment.

## Rules everyone follows

- All submitted work is made during the hackathon. AI tools are allowed.
- **The repo is public.** Never commit frames, video, floor plans, `graph.json`, `rooms.json` or anything under `data/`.
  Code and the vector index only. A full photo map of a building is a security risk.
- Faces are blurred before any frame leaves the laptop it was processed on.
- Never store user photos. The API deletes each image after embedding it.
- Unsure about an event rule? Ask hackbu@bu.edu or Discord. Don't guess.
