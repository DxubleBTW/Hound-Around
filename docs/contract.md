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
POST /locate   (multipart: image)
→ {"photo_id":"p_8f3a","spot":"F2_hall_e2","floor":2,"heading":"F2_hall_e3",
   "confidence":0.8,"top3":[{"spot":"F2_hall_e2","votes":8},{"spot":"F2_hall_e1","votes":2}],
   "ocr_room":"248","ocr_floor":2,"ms":640}

GET /route?from=F2_hall_e2&to=164&accessible=true&heading=F2_hall_e3
→ {"steps":[{"instruction":"Turn around and walk toward the podium elevators","meters":22,"node":"F2_podium_elev"}],
   "total_meters":48,"est_seconds":45}

POST /correct  {"photo_id":"p_8f3a","true_spot":"F2_hall_e1"}  → {"ok":true,"index_size":2214}

GET /health    → {"ok":true,"index_size":2213,"model":"dinov2-small"}
```

Confidence = winning votes / 10. Below ~0.6, or when the top 3 span floors, the app shows the top-3 picker. `ocr_room` / `ocr_floor` are null when nothing is read.

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
index.npz:  vecs float16 [N,384] (L2-normalized), labels str [N], source str [N] ("video"|"correction")
corrections(photo_id TEXT PRIMARY KEY, true_spot TEXT, predicted TEXT, confidence REAL, created_at TEXT)
```

Only vectors and labels ship to the Space, never photos.
