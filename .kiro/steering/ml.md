---
inclusion: fileMatch
fileMatchPattern: 'ml/**'
---

# ML guidance (workstreams A and B)

Applies when working in `ml/**` and the data `pipeline/**`. Grounded in
`docs/roles/ml.md`, `docs/contract.md`, `api/README.md`, `api/recognition.py`,
and `.kiro/specs/hound-around-completion/design.md`. ML owns embedding, voting,
OCR conflict resolution, confidence, and heading. Keep model loading at startup,
not per request. `locate()` must run in < 1 s on CPU (the Space may have no GPU).

## Embedding (A)

- Embed with **DINOv2-small** → **384-d, L2-normalized** vector.
- Use the **CLS token** as the global descriptor (design decision §2). It is
  DINOv2's purpose-built image-level descriptor and is directly comparable with
  cosine. Mean pooling is a 384-d ablation `eval.py` can run; it is not the
  shipped path.
- Both representations are 384-d, so no downstream shape changes.

## Voting and confidence (A)

1. Cosine similarity of the query vector against every index row (vectors are
   already normalized, so this is a dot product). Take the **top-k = 10**
   neighbors.
2. Vote by label; the winner is the top-voted spot.
3. **`confidence = winning_votes / 10`** (winning votes over k).
4. **`top3`** = the three highest-voted `{spot, votes}`, ordered by votes
   descending; break ties by higher cosine similarity.
5. **Floor** comes from the winning node (read from the graph).
6. **Heading** = the most common `labels.csv` heading among the winning spot's
   neighbors **if** that heading is a graph neighbor of the spot, else `null`.
   The API rejects a heading that is not a graph neighbor (`api/main.py`).

## OCR gating and floor override (A/B)

- EasyOCR reads 3-digit room numbers and floor numerals; it is the backup for
  the F1/F2 look-alike problem.
- **Gate OCR** to protect the < 1 s budget: run it only when the vote is
  uncertain — `confidence < 0.8` OR the top 3 span more than one floor. Skip OCR
  on the confident path.
- **Floor override:** if OCR reads a floor that disagrees with the winning vote,
  prefer the OCR floor, then pick the best-voted spot **on that floor** from the
  neighbors and **lower confidence** (vote and OCR disagreed). Interpretation:
  `2xx → F2`, `Bxx → B1`, otherwise `F1`.
- `ocr_room`/`ocr_floor` are `null` when nothing is read. The returned `spot`'s
  node floor must equal the returned `floor` (`api/main.py` rejects mismatches).

## Corrections (B)

- `POST /correct` stores the query vector under `true_spot` with
  `source="correction"`.
- **Weight correction votes higher** in the top-k vote (e.g. a correction vote
  counts as ~3 video votes) so one corrected exemplar can outvote the stale
  video cluster for a near-identical query. Ties break toward the correction.
- This guarantees the **one-correction-flip**: the next near-identical query is
  near rank-1 by cosine, so `true_spot` wins. Prove it with a synthetic test
  (tiny random index, apply one correction, re-query, assert the winner flipped
  and confidence reflects the corrected votes).
- Correction weighting lives entirely inside `ml/`. The API already applies
  corrections to the in-memory index instantly and offers one-level rollback, so
  no contract or API change is needed.

## Index format and building

- **`index.npz`**: `vecs` **float16 [N,384]** (L2-normalized), `labels` str
  `[N]`, `source` str `[N]` (`"video"` or `"correction"`). Only vectors and
  labels ship to the Space — never photos.
- `build_index.py`: `labels.csv` rows with `status == keep` → `index.npz` with
  `source="video"`.
- **Cap the index at ~60 frames per spot** (the basement walk over-represents
  B1).

## ML handoff interface (match `StubBackend` field-for-field)

The backend calls the factory `create_backend(data_dir)` once at startup
(`HOUND_ML_FACTORY=ml.backend:create_backend`). The returned object provides:

- `model_name: str`, `size: int`.
- `locate(image) -> dict`: the contract's `spot`, `floor`, `heading`,
  `confidence`, `top3`, `ocr_room`, `ocr_floor` **plus an internal `vector`**
  (384 finite, nonzero floats). The API strips `vector` and diagnostics.
- `prepare_correction(vector, label)`: allocate a replacement index tagging the
  new vector `source="correction"`, without mutating the live index.
- `apply_correction(prepared)`: swap to the prepared index.
- `snapshot()` / `restore(snapshot)`: independent state for failed writes and
  one-level rollback. Snapshots must not alias arrays that later mutate.

The API passes an EXIF-free RGB image ≤ 512 px on both sides and closes it
immediately. **ML must not retain the image.**

## Rules reminders

- New deps (`torch`, `transformers`, `easyocr`, `CLIP`, `huggingface_hub`,
  `hypothesis`) need team approval; list size and location in the design.
- Tests are **synthetic-only** (tiny random index, generated images), run
  without private data or a GPU. Never test on training-video frames.
- Never commit `data/`, images, `*.npz`, or weights. `index.npz` is vectors only
  and is the only thing that ships.
