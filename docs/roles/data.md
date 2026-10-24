# Data lead

You own the footage, the labels and the test set. Everything the model knows comes through you.

## Where things stand (Sat 9:45 AM)

- Saturday-morning footage is processed: 1,696 kept frames across 33 spots (20 on B1, 13 on F1). Faces are blurred
  (463 faces in 226 frames). The frames are in the team's private Drive folder, never the repo.
- Thin spots: `F1_lobby` (5 frames), `F1_restrooms` (21), `F1_core_elev` (22).
- The review folder still needs a human: two clips with unclear callouts (IMG_2962, IMG_2977), plus room labels that
  aren't in the graph (`F1_room163`, `B1_restrooms_w`, `B1_roomB63`, B64A/B64B, a second B62 callout).
- **No footage of F2 yet.** That is the biggest gap.

## Your deliverables

1. **F2 footage**, before 12:15 if possible. Shoot one ~15 s clip per spot, plus the room signs for 262–265.
   Spots: `hall_w`, `hall_core`, `core_elev`, `core_e`, `hall_ne`, `hall_north`, `csbuilds`, `comm_stair`,
   `hall_stair`, `south_stair`, `open_study`, `hall_e1`–`hall_e4`, `class48a/b/c`, `class20`, `restrooms`, `podium_elev`.
2. **F1 gaps** (after lunch): `class24`, `class48`, `south_stair`, `cafe_entry`, `restrooms_w`, `stair_east`, and
   more of `F1_lobby`.
3. **Processed F2 frames**: run `extract_frames.py`, write the anchors from the transcripts, run `label_frames.py`,
   then `blur_faces.py`. See `pipeline/README.md`.
4. **Resolved review folder**: walk past each unclear spot and give each a graph label or exclude it. Confirm B62's
   real location and whether B64A/B64B are `B1_teal_a`/`B1_teal_b`. Tell the Backend lead, who owns `rooms.json`.
5. **Test set** (afternoon, critical): 50–100 still photos taken by people **outside the team**, named
   `TEST_<node>_NN.jpg`. Include a few deliberately plain or low-detail shots. Never use frames from the training
   videos as test photos.

## How to film a spot

- Landscape, regular 1x camera, chest height.
- **Say the spot name in words at the START**: "Floor two, hall east one". Whisper mishears short codes ("F1" comes out
  as "4-1"), so words beat codes.
- Stand on the spot and do a slow 360° turn over about 15 s.
- At room doors, point at the number sign for 2–3 s. OCR needs it.
- One spot per clip. If you mess up, stop and start a new clip.
- Skip restricted areas, and don't film people's faces up close.

## Hand-offs

- To ML: blurred frames plus an updated `labels.csv` for F2, ASAP. Then the test set by ~2:30 PM for the go/no-go.
- To Backend: room numbers and which node each door is next to, including room 164 (opening and closing ceremonies).
- To Pitch: 3–4 good blurred hallway photos for slides.

## Done means

- F2 has at least 20 labeled frames for every spot.
- There are at least 50 outsider test photos across B1, F1 and F2.
- Nothing unblurred has left your laptop.

## Don'ts

- Don't commit images, video or `data/` to the repo, because it's public.
- Don't include the Friday-night pre-event footage. It's excluded, and its demo folder is unblurred.
- Don't let teammates take test photos: the test only counts if outsiders take them.
