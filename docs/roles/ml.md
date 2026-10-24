# ML lead

You own recognition (photo → spot + floor) and the experiments. "Data Science Application" is 25 points, and calling
a model isn't enough: **the evaluation and comparisons are what score.**

## The method

1. Gray out people in the photo (YOLO person masks; optional if time is short). Never mask room signs.
2. Embed the photo with DINOv2-small (384-d, L2-normalized). Use the GPU when available.
3. Cosine similarity against `index.npz`, take the top 10 neighbors, and vote by label.
4. Confidence = winning votes / 10. Return the top 3.
5. Backup: EasyOCR reads 3-digit room numbers (e.g. 2xx means F2, Bxx means B1) and sets `ocr_room` / `ocr_floor`.
   If OCR reads a floor and the top vote disagrees, prefer OCR's floor.
6. When indexing, cap the index at ~60 frames per spot. The basement walk over-represents B1.

## Your deliverables

1. `build_index.py`: `labels.csv` (status `keep`) → `index.npz` (`vecs` fp16 [N,384], `labels`, `source="video"`).
2. A `locate(image) -> dict` function matching the `/locate` fields in `docs/contract.md`. Backend imports it, so
   agree on the module path with them.
3. `eval.py` with a held-out split:
   - train = Saturday-morning runs; val = one held-out run per floor; test = outsider `TEST_*.jpg` photos. Never mix.
   - Report top-1 spot, top-3 spot, floor accuracy, median graph-distance error (m, uses `graph.json`), p50/p95 latency,
     and how often it correctly says it's unsure (confidence < 0.6).
4. The experiments table, which is the core of the DS score:
   - color-histogram baseline vs CLIP ViT-B/32 vs DINOv2-small
   - k = 1 / 5 / 10 / 20
   - OCR on vs off
   - learning curve: accuracy as corrections are added (simulate by moving test photos into the index one by one)
5. A confusion list: which spots get mixed up (e.g. the same hallway on F1 and F2). It feeds the pitch and the
   re-filming list.

## Timeline

- Now–noon: build the index from the B1 and F1 frames already processed, and get `eval.py` running on a val split.
- 1:15: Vision AI workshop if useful.
- **2:30–3:00: run on 10 outsider photos for the go/no-go (≥7/10 right).** If it fails, tune k, add masking, and lean on OCR.
- 3–6 PM: add F2, run the full experiments, hand Backend a final `index.npz`.
- Evening: turn the results into one table and one chart for Pitch.

## Hand-offs

- From Data: frames, `labels.csv`, test photos.
- To Backend: `locate()`, `index.npz`, and the model name for `/health`. Keep model loading at startup, not per request.
- To Pitch: the experiments table, the accuracy numbers and one chart. Real numbers only; say "n = 37" if that's what we have.

## Done means

- `python eval.py` prints the full metrics table on the outsider test set.
- `locate()` runs in < 1 s on CPU, since the HF Space may not have a GPU.

## Don'ts

- Don't test on frames from the training videos. That inflates accuracy and judges will ask.
- Don't add new dependencies without telling the team.
- Don't commit images or `data/`. `index.npz` is vectors only and is fine to ship to the Space.
