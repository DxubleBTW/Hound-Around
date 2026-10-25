# Hound Around data contract

Agreed before anyone codes. Change it only with the whole team.

## Node IDs

`<FLOOR>_<name>`, floor is `B1`, `F1` or `F2` (the only floors the event can use). Lowercase, no spaces, exactly as on the walk sheets. Nodes found on video that aren't on the sheets: `F1_stair_east`, `F1_room164`, `F1_cafe_entry`, `F1_restrooms_w`.

## data/labels.csv (one row per frame)

```
file,video,t_sec,label,label_source,in_graph,sharpness,dup_of_prev,status,heading
F2_hall_e2__F2_east_run1_t041.5.jpg,F2_east_run1,41.5,F2_hall_e2,card,true,1840,false,keep,F2_hall_e3
```

`heading` = the next node in the direction of travel.
`status` is one of `keep`, `reject_blurry`, `reject_duplicate`, `review_not_in_graph`, `exclude_restricted`.

## data/graph.json

```json
{"building":"CDS",
 "nodes":[{"id":"F2_hall_e2","floor":2,"type":"hallway","label":"East hallway by 48-seat rooms","x":868,"y":576,"landmark":"red couches"}],
 "edges":[{"from":"F1_core_elev","to":"B1_core_elev","meters":0,"instruction":"Take a tower elevator down to LL","stairs":false,"vertical":true},
          {"from":"F1_podium_elev","to":"F2_podium_elev","meters":0,"instruction":"Take a podium elevator to 2","stairs":false,"vertical":true}],
 "rules":{"podium_elev_floors":["B1","F1","F2","F3","F4","F5"]}}
```

Node types: hallway, intersection, elevator, stairs, room, entrance. Edges are walkable both ways unless marked otherwise. Floor numbers: B1 = -1.

## data/rooms.json

```json
[{"room":"164","floor":1,"node":"F1_room164","name":"Room 164 · Opening & Closing Ceremony"},
 {"room":"B62","floor":-1,"node":"B1_class70","name":"B62"}]
```

The B62 mapping is a placeholder until someone checks the sign.

## API

```
POST /locate   (multipart: image, optional previous=<photo_id of the first photo>)
→ {"photo_id":"p_8f3a","spot":"F2_hall_e2","floor":2,"heading":"F2_hall_e3",
   "confidence":0.8,"top3":[{"spot":"F2_hall_e2","votes":8},{"spot":"F2_hall_e1","votes":2}],
   "ocr_room":"248","ocr_floor":2,"p_correct":0.74,"tier":"auto","ms":640}

GET /route?from=F2_hall_e2&to=164&accessible=true&heading=F2_hall_e3
→ {"steps":[{"instruction":"Turn around and walk toward the podium elevators","meters":22,"node":"F2_podium_elev"}],
   "total_meters":48,"est_seconds":45,
   "legs":[{"floor":2,"points":[[0.1,0.5],[0.9,0.5]],"start":"F2_hall_e2","end":"F2_podium_elev",
            "exit":{"mode":"elevator","to_floor":1}},
           {"floor":1,"points":[[0.1,0.1],[0.9,0.9]],"start":"F1_podium_elev","end":"F1_room164","exit":null}]}

POST /correct  {"photo_id":"p_8f3a","true_spot":"F2_hall_e1"}  → {"ok":true,"index_size":2214}

GET /health    → {"ok":true,"index_size":2213,"model":"dinov2-small"}
```

`legs` draws the route: one leg per floor, split at elevators/stairs (riding through a floor is one exit).
`points` are the path's nodes normalized to that leg's own bounding box (0–1, aspect kept, 10% padding), so no
building coordinates, floor plan or other nodes ever reach the client. The last leg's `exit` is null.
Each leg also has `nodes` (the path's node ids, aligned with `points`) and `branches`: per point, the openings
beside the path as unit directions only, e.g. `[{"dx":0,"dy":-1,"kind":"hall"}]` (`kind`: hall, door, stairs,
elevator, entrance). The app draws walls along the path with short faded stubs at openings; no length, name or
position of anything off the path is sent.

Each step has `passes`: landmarks beside the hallway while walking it, in order, at most 3, e.g.
`[{"name":"the restrooms","side":"left"}]` (empty for elevator/stairs steps). A floor change reads
`Take the elevator to 2, then head toward <where you step out to>`.

Route instructions start with one of: `Walk`, `Continue`, `Turn left and walk`, `Turn right and walk`,
`Turn around and walk`, `Take the elevator to`, `Take the stairs to`. A turn needs at least 45° (150° for
"Turn around"); smaller bends merge into the previous step. A destination door beside the corridor ends with
", on your left" / ", on your right" instead of a turn, and doors passed mid-route never count as turns.

Confidence sums weighted votes for the winner and same-floor spots within 8 walking
meters, divided by 10 (20 when combining two photos), capped at 1.
`ocr_room` / `ocr_floor` are null when nothing is read. When OCR identifies a floor
with indexed candidates, voting, confidence features and heading use retrieval
from that floor. Both-photo fusion respects the current photo's OCR floor.

`p_correct` is the calibrated chance the spot is right (within 10 m, right floor; `ml/calibration.py`), and `tier`
says what the app does next: `auto` (p ≥ 0.7 and the top 3 agree on the floor) goes straight to the route with a
"Not here?" link; `picker` (0.5 ≤ p < 0.7, or floors split) shows the top 3; `second` (p < 0.5) asks for one more
photo facing the other way. That photo is sent with `previous` = the first `photo_id`; the backend adds both
photos' votes and answers `tier: "picker"`, `p_correct: null` (never a third photo). An expired `previous` (photos
are cached 10 minutes) falls back to a single-photo answer. Only vectors and prediction
metadata are cached, never photos. Production confidence requires a private
`confidence.json` bound to the model, decision version and exact index/graph/rooms.
Without that artifact, the production matcher returns `p_correct: null, tier: "picker"`.
An incompatible artifact makes recognition unavailable. Legacy/custom backends may
return both fields null; the app then uses its previous confidence rule.

`/locate` admits one active upload/inference per process. Excess requests receive
503 and `Retry-After: 1` before upload buffering. Health and route requests remain
independent of inference; no success fields or endpoints are added.

`/correct` retries with an identical `{photo_id, true_spot}` return the original
successful receipt without learning twice, including after a restart with the same
correction context. The same corrected photo with a different `true_spot` returns
409. Unknown or expired photos still return 410. Rollback removes the receipt too.
Legacy durable records without a stored receipt return the current index size.
See [reliability rollout](recognition-reliability.md) for calibration and package setup.

### Unrecognized-photo error

When a validated similarity cutoff is configured, `/locate` can reject an unrelated
photo with HTTP 422 and the following error body. Successful response fields are unchanged:

```json
{"detail":{"code":"unrecognized_location","message":"Location not recognized. Take another hallway photo or choose a starting location."}}
```

The client uses the known code to offer retake/manual routing. It does not render
arbitrary server error text. Rejection does not issue `photo_id` or add a correction.
See [feature setup](navigation-features-proposal.md) for cutoff calibration and activation.

## index.npz and corrections.sqlite

```
index.npz:  vecs float16 [N,D] (L2-normalized), labels str [N], source str [N] ("video"|"correction")
            heading str [N], model_name scalar str, views_per_frame scalar int
            optional pca_mean float32 [D0], pca_components float32 [D,D0]
corrections(photo_id TEXT PRIMARY KEY, true_spot TEXT, predicted TEXT, confidence REAL, created_at TEXT)
```

Only vectors and labels ship to the Space, never photos.

D is 384 for DINOv2-small, 8448 for MegaLoc, or the stored PCA output width.
MegaLoc uses one square-resized whole-image view; DINOv2 uses three views.
Legacy indexes may omit heading and descriptor metadata. New indexes identify the
exact pinned descriptor, and the backend rejects a different configured identity.
