# ML research scripts

Real-data experiments behind the numbers in the pitch. They read the private, face-blurred frames in `data/`
(never committed) and cache DINOv2 vectors and OCR reads in `data/cache/`. The shipped recognition code is `ml/`;
these scripts only measure it.

| Script | What it answers |
| --- | --- |
| `eval.py` | Backbone and method comparison (histogram, CLIP, DINOv2, k sweep, side crops, PIGEON-style distance-smoothed probe), with held-out videos via `--val-videos` |
| `analyze.py` | Leave-one-video-out per spot: coverage, learning curves (videos and frames per spot), index variants |
| `floor_report.py` | Per-floor success for plain voting, neighborhood voting and the OCR floor override |
| `backend_eval.py` | The shipped `ml.backend.Backend` on real footage: per-floor success, correction learn rate, correction hijack rate |

```bash
python ml/research/analyze.py --dataset data/dataset data/dataset_new data/dataset_f2
python ml/research/floor_report.py --dataset data/dataset data/dataset_new data/dataset_f2
python -m ml.research.backend_eval --dataset data/dataset data/dataset_new data/dataset_f2
```

Run `floor_report.py` once before `backend_eval.py`: it fills the OCR cache. EasyOCR on a CPU takes 2-3 s per frame.
