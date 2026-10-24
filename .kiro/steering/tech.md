# Tech stack and commands

Grounded in `CLAUDE.md`, `api/README.md`, `requirements*.txt`, `Dockerfile`,
and `frontend/package.json`. Describes the repo as it is today.

## Backend / ML / pipeline (Python 3.11)

- **FastAPI** backend (`api/main.py`) serving the four endpoints from
  `docs/contract.md`.
- **numpy** cosine similarity over an L2-normalized vector index; top-10 voting.
- **networkx** `DiGraph` routing (`api/routing.py`).
- **SQLite** for the corrections log (`corrections.sqlite`).
- Planned ML runtime (new `ml/` package, deps need team approval before install):
  - **DINOv2-small** (via `torch` CPU + `transformers`) → 384-d embeddings.
  - **EasyOCR** → room numbers and floor numerals.
  - **huggingface_hub** → download private data at Space startup.
  - **CLIP ViT-B/32** → experiments-only baseline (never shipped).
- Only backend packages are in `requirements.txt` today. ML owns its model deps
  and installs them separately when integrating.

## Frontend (JavaScript / JSX)

- **React 18 + Vite 5 + Tailwind 4**, deployed on Vercel.
- `frontend/src/api.js` runs on **mock data when `VITE_API_URL` is unset** and
  does real `fetch` otherwise. Shapes already match `docs/contract.md`.
- `frontend/src/lib/image.js` shrinks to 512 px and strips EXIF via canvas
  re-encode. `frontend/src/lib/spots.js` formats node ids to readable names.

## Tests

- **pytest** (`tests/test_backend.py`) with a synthetic graph and generated
  solid-color images via `FakeML(StubBackend)`. Tests use synthetic data only.
- The frontend has no test runner; its proof is `npm run build`.

## Container / deploy

- Root **`Dockerfile`** builds the backend on `python:3.11-slim`, exposes port
  **7860**, and runs as a non-root `app` user, for a Hugging Face Space.
- No data, model weights, or images enter the build context (`.dockerignore`
  allows only `requirements.txt` and `api/` today).

## Proof commands (every change must end with one)

```sh
# Backend (from repo root)
python -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q

# Run the API locally
.venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log

# Smoke the endpoints
curl -i http://127.0.0.1:8000/health
curl -F image=@/private/path/query.jpg http://127.0.0.1:8000/locate
curl --get --data-urlencode 'from=F1_entry_west' --data-urlencode 'to=164' --data-urlencode 'accessible=true' http://127.0.0.1:8000/route

# Frontend
cd frontend && npm ci && npm run build
```

On Windows use `.venv\Scripts\python.exe` for interpreter commands. Set
`PYTHONIOENCODING=utf-8` before running EasyOCR. No new dependencies without
team approval; list every new package with size and location in the design.
