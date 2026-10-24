"""Download the private data files into HOUND_DATA_DIR before the API starts.

The repo and the Space are public; graph.json, rooms.json, index.npz and labels.csv are not.
They live in a PRIVATE Hugging Face dataset repo and are fetched at container start with the
HF_TOKEN Space secret (docs: .kiro/specs/hound-around-completion/design.md §6).

Env:
  HOUND_DATA_REPO  private dataset repo id, e.g. "your-team/hound-around-data". Unset = skip
                   (use files already mounted in HOUND_DATA_DIR, e.g. local docker run -v).
  HF_TOKEN         read token for that repo (Space secret). Never printed.
  HOUND_DATA_DIR   where api/ and ml/ read data (default /app/data).

Exits 0 even when files are missing: the API then starts and reports 503 on /health, which the
frontend shows as "can't reach / waking", instead of the Space crash-looping.
"""
import os
import sys
from pathlib import Path

REQUIRED = ('graph.json', 'rooms.json', 'index.npz')
OPTIONAL = ('labels.csv',)  # only used for route headings


def main():
    data_dir = Path(os.getenv('HOUND_DATA_DIR', 'data'))
    data_dir.mkdir(parents=True, exist_ok=True)
    repo = os.getenv('HOUND_DATA_REPO', '').strip()

    if repo:
        try:
            from huggingface_hub import snapshot_download  # lazy: only needed on the Space
            snapshot_download(repo_id=repo, repo_type='dataset', local_dir=data_dir,
                              allow_patterns=list(REQUIRED + OPTIONAL),
                              token=os.getenv('HF_TOKEN') or None)
            print(f'fetch_data: downloaded from dataset {repo}', flush=True)
        except Exception as exc:  # bad token, wrong repo id, network
            # Type only: exception text can echo request details.
            print(f'fetch_data: download failed ({type(exc).__name__}); check HOUND_DATA_REPO and HF_TOKEN',
                  file=sys.stderr, flush=True)
    else:
        print('fetch_data: HOUND_DATA_REPO not set, using files already in HOUND_DATA_DIR', flush=True)

    missing = [name for name in REQUIRED if not (data_dir / name).exists()]
    if missing:
        print(f'fetch_data: missing {", ".join(missing)}; /health will report not ready',
              file=sys.stderr, flush=True)
    else:
        print('fetch_data: data ready', flush=True)


if __name__ == '__main__':
    main()
