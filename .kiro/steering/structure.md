# Project structure and ownership

Directory layout as it is today, plus where new Kiro work lands. Node ids come
only from `data/graph.json`; never invent them.

```
Hound-Around/
  CLAUDE.md                 hard rules + environment notes (law alongside contract)
  KIRO.md                   honest account of asked / Kiro-did / human-did
  README.md
  Dockerfile                python:3.11-slim, port 7860, non-root `app` user (HF Space)
  .dockerignore             allows only requirements.txt + api/ today
  .gitignore                keeps data/ and private files out (never loosen)
  requirements.txt          backend runtime deps only
  requirements-dev.txt      dev/test deps
  vercel.json

  api/                      FastAPI backend (Backend lead: David)
    main.py                 four endpoints + contract enforcement
    recognition.py          ML handoff boundary; StubBackend reference shape
    routing.py              networkx DiGraph router (authoritative instruction text)
    README.md

  ml/                       TO BE CREATED by Kiro (ML lead) — the only new runtime area
    embedder.py             DINOv2-small -> 384-d L2-normalized vector
    ocr.py                  EasyOCR room number + floor numeral, gated
    index.py                in-memory index: load/save index.npz, add, snapshot/restore
    build_index.py          labels.csv (keep) -> data/index.npz (python -m ml.build_index)
    backend.py              create_backend(data_dir) factory: locate()/correction interface
    eval.py                 splits, metrics, experiments (python -m ml.eval)

  pipeline/                 data tools, Windows (Data lead) — already built
    extract_frames.py       frames at 2 fps + whisper transcript
    label_frames.py         labels.csv + train/<spot>/ folders
    blur_faces.py           blur faces in place (before frames leave the laptop)
    README.md

  frontend/                 React 18 + Vite 5 + Tailwind 4 phone app (Front-end lead)
    src/api.js              mock when VITE_API_URL unset; real fetch otherwise
    src/lib/image.js        512 px resize + EXIF strip via canvas
    src/lib/spots.js        node id -> readable name (never invents nodes)
    src/screens/            Snap / Locating / Confirm / Route
    package.json, vite.config.js, vercel.json

  docs/
    contract.md             LAW: fields, types, nullability. Never edit without team approval.
    dataset.md
    roles/                  README + data/ml/backend/frontend/pitch role docs
    img/                    only committed images allowed (docs/img/*.png)

  tests/
    test_backend.py         synthetic graph + generated images; python -m pytest -q

  data/                     GITIGNORED, never committed (graph.json, rooms.json, labels.csv,
                            anchors.json, nodes.txt, index.npz, dataset/, videos/, test/)

  .kiro/                    Kiro config — MUST stay in the repo, never gitignored
    specs/hound-around-completion/   requirements.md, design.md, tasks.md
    steering/               product, tech, structure, hound-rules, ml, frontend, api
    hooks/                  tests-on-save, contract-guard, privacy-guard, frontend-build
```

## Ownership map (from docs/roles)

| Area | Owner | Notes |
| --- | --- | --- |
| `pipeline/`, `data/` | Data lead | frames, labels.csv, test photos; blurring |
| `ml/`, `index.npz`, `eval` | ML lead | locate(), experiments, model name for /health |
| `api/` | Backend lead (David) | endpoints, graph/rooms loading, contract enforcement |
| `frontend/` | Front-end lead | four screens, deploy, demo moment |
| pitch / submission | Pitch lead | interviews, timing, slides, Devpost |

## Flow between pieces

```
Data ──frames + labels.csv──▶ ML ──index.npz + locate()──▶ Backend ──/locate /route /correct──▶ Frontend
                               ▲                              ▲
       test photos (outsiders)─┘        graph.json + rooms.json (Backend)
```

Keep changes surgical: do not refactor working `api/`, `pipeline/`, or
`frontend/` code unless a task needs it.
