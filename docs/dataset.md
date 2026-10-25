# Dataset card

Hallway frames of BU's Center for Computing & Data Sciences (665 Commonwealth Ave), used to recognize where a phone photo was taken. **No images are published.** This card describes them.

## Current totals (Sun Oct 25, 2026)

The sections further down describe the first Saturday-morning session. Since then we added Saturday afternoon and
evening phone rounds (all three floors), an Insta360 pass of floor 1, and the Friday Oct 23 evening walk of public
areas. Totals across every labeled dataset:

| | |
| --- | ---: |
| Videos | 67 (60 phone, 7 Insta360) |
| Frames extracted at 2 fps | 13,000 |
| Kept and labeled | 8,537 (B1 2,442 · F1 3,534 · F2 2,561) |
| Not mapped to a graph spot (held for review) | 3,129 |
| Rejected: blurry | 1,245 |
| Rejected: near-duplicate | 59 |
| Excluded: restricted area | 30 |
| Spots with frames | 57 |
| Frames in the deployed search index (capped per spot) | 7,008 |

Evaluation is leave-one-video-out: each of the 1,758 at-spot queries behind the README's results comes from a video
whose frames were removed from the index. Outsider photos are a separate test split and are never used for tuning.

## Collection

| | |
| --- | --- |
| When | Saturday Oct 24, 2026, 8:09–8:25 AM, daylight, during the DS+X hackathon |
| Where | Event floors only: lower level (B1) and floor 1. Floor 2 pending. |
| How | Two iPhones, 1080p 30 fps SDR, chest height, walking. Spots named out loud. |
| Clips | 17 one-spot clips on floor 1 (12–22 s each), one 11-minute basement walk out and back, one 2-minute floor-1 east walk |
| Labels | Whisper transcripts of the spoken callouts, mapped by hand to walk-sheet node IDs |
| Privacy | Faces blurred (YuNet + MediaPipe) before any frame leaves the filming laptop. Service corridors and security rooms are excluded. |

Friday-evening test footage (4K HDR, night) was used only to develop the pipeline and is not in this dataset.

## Counts (2 fps)

| Status | Frames |
| --- | ---: |
| Kept and labeled | 1,696 |
| Needs review (room numbers and unclear callouts not yet mapped to nodes) | 216 |
| Rejected: blurry | 200 |
| Rejected: near-duplicate | 17 |
| **Total** | **2,129** |

Faces blurred: 463 boxes in 226 frames.

**33 spots kept:** 20 on B1 and 13 on floor 1. Most spots have 20–120 frames. Thin spots to re-film: F1 lobby (5). F1 restrooms (21) and F1 core elevator (22) are borderline.

## Known biases and limits

- **Imbalance:** the long basement walk gives some B1 spots over 100 frames, while one-spot clips give about 30. Cap each spot at about 60 frames when indexing.
- **One time of day:** all morning daylight. Afternoon test photos measure how well it generalizes.
- **Look-alike floors:** B1 and floor 1 differ (concrete vs wood slats). Floors 1 and 2 share finishes near the elevators, and the floor-numeral OCR backup covers that.
- **Label noise:** a frame takes the label of the last callout, so frames right after a walker leaves one spot and before they name the next can be mislabeled. One-spot clips avoid this.
- **People:** frames include people in public spaces with faces blurred. Very distant figures stay unblurred and are not identifiable at 720 px.

## Splits

- Train: Saturday-morning runs.
- Validation: one held-out run per floor.
- Test: still photos taken by people outside the team on Saturday afternoon, never frames from these videos.
